// ブラウザでの動作確認（playwright-core + インストール済み Chrome）
//   node tools/e2e.mjs          … 確認のみ
//   node tools/e2e.mjs --shots  … shots/ に場面ごとのスクリーンショットも保存
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const SHOTS = process.argv.includes('--shots');
const root = fileURLToPath(new URL('..', import.meta.url));
// 公開時と同じ並び（index.html と public/ の中身が同じ階層）で配る小さなサーバー
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const name = path === '/' ? 'index.html' : path.slice(1);
  const file = [root + name, root + 'public/' + name].find((f) => !name.includes('..') && existsSync(f));
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = process.env.E2E_URL || `http://127.0.0.1:${server.address().port}/`; // E2E_URL で公開先も確認できる
const outDir = root + 'shots/';
if (SHOTS) mkdirSync(outDir, { recursive: true });

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = CHROME_PATHS.find((p) => existsSync(p));

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  ✔ ' : '  ✘ ') + msg);
  if (!cond) failures++;
}

const browser = await chromium.launch({ executablePath, headless: true });

async function newPage(viewport, dpr = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, hasTouch: viewport.width < 600 });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__game);
  return page;
}
async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => window.__game.render());
  await page.screenshot({ path: outDir + name + '.png' });
}

// ページ内で使う補助（step はゲームの固定ステップ 1/60 秒単位）
const helpers = () => {
  const G = window.__game, C = window.SaruLogic.CFG;
  window.H = {
    sec: (s, inp) => G.step(Math.round(s * 60), inp),
    until(fn, maxSec = 10, inp) {
      for (let i = 0; i < maxSec * 60; i++) { G.step(1, inp); if (fn(G.world)) return true; }
      return false;
    },
    calmMonkey(x, tier) {
      const m = G.world.monkey;
      Object.assign(m, { x, tier, y: C.TIERS[tier].y, target: null, jump: null, state: 'calm', idleT: 99, throwT: 99, queue: [] });
    },
    quiet() { const w = G.world; w.spawnT = 999; w.items.length = 0; w.persimmons.length = 0; w.crab.hp = 3; },
  };
};

// ---------------------------------------------------------------- スマホ縦
console.log('■ スマホ 360×640');
{
  const page = await newPage({ width: 360, height: 640 });
  await page.evaluate(helpers);
  await page.waitForTimeout(300);
  check(await page.isVisible('#startScreen'), 'タイトル画面が出る');
  await shot(page, '01-title');

  // あそびかた → もどる
  await page.click('#howtoBtn');
  check(await page.isVisible('#howtoScreen') && !(await page.isVisible('#startScreen')), 'あそびかた画面が開く');
  check((await page.locator('#howtoScreen .ally').count()) === 5, 'あそびかたに仲間5種の説明');
  await page.waitForTimeout(200);
  await shot(page, '01b-howto');
  await page.click('#howBackBtn');
  check(await page.isVisible('#startScreen') && !(await page.isVisible('#howtoScreen')), 'もどる でタイトルへ');

  // 実際にボタンを押して開始
  await page.click('#startBtn', { force: true });
  check(await page.evaluate(() => window.__game.mode === 'play'), 'はじめる で開始');
  await page.evaluate(() => window.__game.manual(true));
  await page.evaluate(() => { window.__game.start(3); window.__game.manual(true); H.sec(3.2); });
  const firstItem = await page.evaluate(() => window.__game.world.items.map((i) => i.kind));
  check(firstItem[0] === 'usu', '最初の仲間は臼（' + firstItem.join(',') + '）');
  await shot(page, '02-play-start');

  // ドラッグでカニが動く
  const x0 = await page.evaluate(() => window.__game.world.crab.x);
  await page.evaluate(() => window.__game.manual(false));
  await page.mouse.move(180, 400); await page.mouse.down();
  await page.mouse.move(80, 400, { steps: 8 }); await page.waitForTimeout(400);
  await page.mouse.up();
  await page.evaluate(() => window.__game.manual(true));
  const x1 = await page.evaluate(() => window.__game.world.crab.x);
  check(x1 < x0 - 40, `ドラッグで左へ移動（${x0.toFixed(0)} → ${x1.toFixed(0)}）`);

  // ---- 臼を仕掛ける：幹を登って真上の枝で待つ ----
  const usuPath = await page.evaluate(() => {
    const G = window.__game; H.quiet(); H.calmMonkey(250, 1);
    G.world.crab.x = 90; G.give('usu');
    G.step(1, { action: true });
    const seen = [];
    H.until((w) => { if (w.usu && seen[seen.length - 1] !== w.usu.state) seen.push(w.usu.state); return w.usu && w.usu.state === 'climb' && w.usu.y < 380; }, 5);
    return seen;
  });
  await shot(page, '03-usu-climbing');
  await page.evaluate(() => H.until((w) => w.usu && w.usu.state === 'armed', 6));
  const usu = await page.evaluate(() => ({ x: window.__game.world.usu.x, state: window.__game.world.usu.state }));
  check(usuPath.join('>') === 'toTrunk>climb' && usu.state === 'armed' && usu.x === 90, `臼：転がる→登る→x=90 の真上で待機（${usuPath.join('>')}>${usu.state}）`);

  // ---- 落ち着いた猿は臼の下を避ける ----
  const avoid = await page.evaluate(() => {
    const G = window.__game; G.world.monkey.idleT = 0; G.world.monkey.target = { tier: 1, x: 40 };
    let minD = 999;
    H.until((w) => { minD = Math.min(minD, Math.abs(w.monkey.x - 90)); return w.monkey.state === 'notice' || w.monkey.state === 'sidestep'; }, 6);
    const st = G.world.monkey.state;
    return { minD, st, usu: G.world.usu.state };
  });
  await shot(page, '04-monkey-notices-usu');
  check(avoid.usu === 'armed' && avoid.minD >= 43, `落ち着いた猿は臼の列の手前で止まる（最接近 ${avoid.minD.toFixed(0)}px, ${avoid.st}）`);

  // ---- 栗で追い立てる：反対側で破裂 → 猿が臼の下へ → 命中 ----
  const drive = await page.evaluate(() => {
    const G = window.__game; H.calmMonkey(250, 1);
    G.world.crab.x = 300; G.give('chestnut'); G.render();
    return true;
  });
  await shot(page, '05-holding-chestnut-arrow');
  const flee = await page.evaluate(() => {
    const G = window.__game; G.step(1, { action: true });
    G.drainEvents();
    H.until((w) => w.monkey.state === 'startle', 4);
    const ev = G.drainEvents().find((e) => e.type === 'monkeyFlee');
    return ev ? { dir: ev.dir, tx: ev.tx } : null;
  });
  const burst = await page.evaluate(() => { H.until((w) => !w.chestnuts.length, 2); const e = window.__game.drainEvents().find((e) => e.type === 'chestnutBurst'); return e ? { hit: e.hit, dist: Math.round(e.dist) } : null; });
  await shot(page, '06-chestnut-blast-flee');
  check(burst && burst.hit, `栗は猿めがけて飛び、そばで破裂して当たる（${JSON.stringify(burst)}）`);
  check(flee && flee.dir === -1 && flee.tx < 110, `栗は右で破裂 → 猿は左（反対側）へ逃げる（逃げ先 x=${flee && flee.tx.toFixed(0)}）`);
  await page.evaluate(() => H.until((w) => w.usu && w.usu.state === 'fall', 4));
  await page.evaluate(() => H.sec(0.1));
  await shot(page, '07-usu-falling');
  const hit = await page.evaluate(() => {
    const G = window.__game;
    H.until((w) => !w.usu || w.usu.state === 'leave' || w.usu.state === 'grounded', 3);
    return { evs: G.drainEvents().map((e) => e.type), hp: G.world.monkey.hp };
  });
  await page.evaluate(() => window.__game.step(14));
  await shot(page, '08-usu-hit');
  check(hit.evs.includes('usuHit') && hit.hp === 100 - 45 - 0 || hit.hp <= 55, `臼が命中して猿の懲らしめゲージが 45 減る（残り ${hit.hp}）`);

  // ---- 外れ：猿が臼の手前で止まる ----
  const miss = await page.evaluate(() => {
    const G = window.__game; H.quiet();
    G.world.monkey.state = 'calm';
    G.world.usu = { state: 'armed', x: 100, y: 74, tx: 100, vy: 0, vx: 0, rot: 0, t: 0, armT: 0 };
    H.calmMonkey(220, 1);
    Object.assign(G.world.monkey, { state: 'flee', target: { tier: 1, x: 140 } });
    G.drainEvents();
    H.until((w) => w.usu && w.usu.state === 'grounded', 3);
    return G.drainEvents().find((e) => e.type === 'usuCross');
  });
  await page.evaluate(() => window.__game.step(10));
  await shot(page, '09-usu-miss');
  check(miss && miss.hit === false && Math.abs(miss.dx) > 26, `猿が手前で止まると外れ、ずれ ${miss && Math.abs(miss.dx).toFixed(0)}px を表示`);
  const pick = await page.evaluate(() => { const G = window.__game; G.world.crab.x = 100; G.step(2); return G.world.crab.held; });
  check(pick === 'usu', '外れた臼を拾い直せる');

  // ---- 蜂：追い回して投擲を止める ----
  const bee = await page.evaluate(() => {
    const G = window.__game; H.quiet(); G.world.crab.held = null; G.world.usu = null;
    H.calmMonkey(150, 1); G.world.monkey.throwT = 0.3;
    G.world.crab.x = 260; G.give('bee'); G.step(1, { action: true });
    G.drainEvents();
    H.sec(1.6);
    return { st: G.world.monkey.state };
  });
  await shot(page, '10-bee-chase');
  const beeAll = await page.evaluate(() => { const G = window.__game; H.sec(4.5); return G.drainEvents().map((e) => e.type); });
  check(bee.st === 'chased' && !beeAll.includes('throw'), `蜂がいる間、猿は逃げ回って投げない（状態 ${bee.st}, 投擲 ${beeAll.filter((e) => e === 'throw').length}回, 刺した ${beeAll.filter((e) => e === 'beeSting').length}回）`);

  // ---- 熟柿：おしい表示 ----
  const ripe = await page.evaluate(() => {
    const G = window.__game, C = window.SaruLogic.CFG; H.quiet(); G.world.bees.length = 0;
    H.calmMonkey(300, 0);
    G.world.crab.x = 150;
    G.world.persimmons.push({ kind: 'ripe', x: 150 + 21 + 3 + 11 + 6, y: 420, vx: 0, vy: C.RIPE_FALL, r: C.RIPE_R, ph: -1.2, t: 0 });
    G.world.persimmons.push({ kind: 'ripe', x: 60, y: 330, vx: 0, vy: C.RIPE_FALL, r: C.RIPE_R, ph: 0, t: 0 });
    G.drainEvents();
    H.until((w) => w.persimmons.length < 2, 4);
    return G.drainEvents().find((e) => e.type === 'ripeMiss' || e.type === 'ripeCatch');
  });
  await page.evaluate(() => window.__game.step(8));
  await shot(page, '11-ripe-near-miss');
  check(ripe && ripe.type === 'ripeMiss' && ripe.gap < 40, `熟柿の取り逃しに「あと ${ripe && Math.round(ripe.gap)}px」を出す`);

  // ---- 1匹目を倒す：とどめの臼 → 謝る → 2匹目が降ってくる → 負けて結果 ----
  await page.evaluate(() => {
    const G = window.__game; H.quiet(); G.world.monkey.hp = 20;
    G.world.usu = { state: 'armed', x: 120, y: 74, tx: 120, vy: 0, vx: 0, rot: 0, t: 0, armT: 0 };
    H.calmMonkey(122, 2); G.world.monkey.state = 'windup'; G.world.monkey.stateT = 9;
    H.until((w) => w.phase === 'win', 2);
    H.until((w) => w.monkey.landed, 3); H.sec(0.6);
  });
  await shot(page, '12-win-apology');
  check(await page.evaluate(() => document.getElementById('banner').classList.contains('show')), '倒すと「1匹目 こらしめた！」の帯');
  check(await page.evaluate(() => window.__game.world.stats.kills === 1), '倒した数が 1');
  const hearts = await page.evaluate(() => ({ n: document.querySelectorAll('#hearts .heart').length, max: window.__game.world.crab.maxHp }));
  check(hearts.n === 4 && hearts.max === 4, `倒すとハートが 4 個に増える（${JSON.stringify(hearts)}）`);
  await page.evaluate(() => H.until((w) => w.phase === 'enter', 5));
  await page.evaluate(() => window.__game.step(14));
  await shot(page, '13-next-monkey');
  await page.evaluate(() => H.until((w) => w.phase === 'play', 3));
  const w2 = await page.evaluate(() => ({ wave: window.__game.world.wave, hp: window.__game.world.monkey.hp, badge: document.getElementById('wave').textContent, label: document.getElementById('gaugeLabel').textContent, fill: document.getElementById('gaugeFill').style.width }));
  check(w2.wave === 2 && w2.hp === 130 && w2.badge === '2匹目' && w2.fill === '100%', `2匹目が出てゲージが満タン（${JSON.stringify(w2)}）`);
  await page.evaluate(() => H.sec(1.5));
  await shot(page, '13b-wave2-play');
  await page.evaluate(() => {
    const G = window.__game, C = window.SaruLogic.CFG; H.quiet();
    G.world.crab.hp = 1; G.world.crab.invuln = 0;
    G.world.persimmons.push({ kind: 'green', x: G.world.crab.x, y: 500, vx: 0, vy: 300, r: C.GREEN_R, t: 0, rot: 0, landX: G.world.crab.x });
    H.until((w) => w.phase === 'done', 6);
  });
  await page.waitForTimeout(100);
  check(await page.isVisible('#resultScreen'), '倒れると結果画面');
  check((await page.textContent('#resTitle')).includes('1匹こらしめた'), '結果の見出し: ' + (await page.textContent('#resTitle')));
  check((await page.textContent('#resRank')) === '一人前のカニ', '称号: ' + (await page.textContent('#resRank')));
  check((await page.textContent('#resNext')).includes('あと 1匹'), '次の称号: ' + (await page.textContent('#resNext')));
  await shot(page, '14-result-1kill');

  // ---- もう一度 → すぐ負け ----
  // 結果画面のボタンが効くまでの間はゲーム内の時間で数えるので、手動進行を切って実時間で待つ
  await page.evaluate(() => window.__game.manual(false));
  await page.waitForTimeout(700);
  await page.click('#retryBtn');
  check(await page.evaluate(() => window.__game.mode === 'play'), 'もう一度 で再開');
  check(await page.evaluate(() => document.getElementById('wave').textContent === '1匹目'), 'もう一度で 1匹目に戻る');
  await page.evaluate(() => {
    const G = window.__game, C = window.SaruLogic.CFG; G.manual(true); H.quiet();
    G.world.crab.hp = 1; G.world.crab.invuln = 0;
    G.world.persimmons.push({ kind: 'green', x: G.world.crab.x, y: 500, vx: 0, vy: 300, r: C.GREEN_R, t: 0, rot: 0, landX: G.world.crab.x });
    H.until((w) => w.phase === 'lose', 2); H.sec(0.8);
  });
  await shot(page, '14-lose');
  await page.evaluate(() => H.until((w) => w.phase === 'done', 4));
  await page.waitForTimeout(100);
  check((await page.textContent('#resTitle')).includes('やられた'), '0匹で負けると「やられた」');
  await shot(page, '15-result-lose');
  await page.waitForTimeout(700);
  await page.click('#titleBtn');
  check(await page.isVisible('#startScreen'), 'タイトルへ戻れる');
  check((await page.textContent('#bestNote')).includes('1匹'), 'タイトルに最高記録: ' + (await page.textContent('#bestNote')));

  // ---- 通しプレイ（ボット・カニは普通に被弾する）----
  const full = await page.evaluate(() => {
    const G = window.__game; G.manual(true); G.start(11);
    const res = { wins: 0 };
    for (let k = 0; k < 2000 * 60; k++) {
      const w = G.world, c = w.crab, m = w.monkey, u = w.usu;
      let inp = { targetX: null, moveX: 0, action: false };
      // 青柿の着弾点から逃げる
      const danger = w.persimmons.find((p) => p.kind === 'green' && Math.abs(p.landX - c.x) < 34);
      const armed = u && u.state === 'armed';
      if (danger) inp.targetX = c.x + (danger.landX > c.x ? -60 : 60);
      else if (c.held === 'usu') { const tx = m.x > 180 ? 90 : 270; if (Math.abs(c.x - tx) < 6) inp.action = true; else inp.targetX = tx; }
      else if (c.held) { const tx = armed ? Math.max(24, Math.min(336, m.x + Math.sign(m.x - u.x) * 50)) : m.x; if (Math.abs(c.x - tx) < 6) inp.action = true; else inp.targetX = tx; }
      else {
        const r = w.persimmons.find((p) => p.kind === 'ripe');
        const cands = w.items.map((i) => i.x); if (u && u.state === 'grounded') cands.unshift(u.x);
        if (r) inp.targetX = r.x; else if (cands.length) inp.targetX = cands.sort((a, b) => Math.abs(a - c.x) - Math.abs(b - c.x))[0];
      }
      G.step(1, inp);
      if (w.phase === 'done') return { result: w.result, t: w.t.toFixed(1), kills: w.stats.kills, wave: w.wave, maxHp: c.maxHp, monkeyHp: m.hp, usuHits: w.stats.usuHits, ripe: w.stats.ripe };
    }
    return { result: 'timeout', kills: G.world.stats.kills, wave: G.world.wave, hp: G.world.crab.hp, maxHp: G.world.crab.maxHp, times: G.world.stats.killTimes.map((t) => Math.round(t)).join(',') };
  });
  check((full.result === 'lose' || full.result === 'timeout') && full.kills >= 2, `通しプレイで猿を次々に倒して進む（${JSON.stringify(full)}）`);
  check(page.errors.length === 0, 'コンソールエラーなし' + (page.errors.length ? ': ' + page.errors.join(' / ') : ''));
  await page.context().close();
}

// ---------------------------------------------------------------- 実時間で動かす（RAF ループ）
console.log('■ 実時間ループ（PC 1280×800）');
{
  const page = await newPage({ width: 1280, height: 800 }, 1);
  await page.click('#startBtn', { force: true });
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500); await page.keyboard.up('ArrowLeft');
  const st = await page.evaluate(() => ({ t: window.__game.world.t, x: window.__game.world.crab.x }));
  check(st.t > 0.3 && st.x < 140, `キーボードで移動・時間が進む（t=${st.t.toFixed(2)}, x=${st.x.toFixed(0)}）`);
  const box = await page.locator('#stage').boundingBox();
  check(Math.abs(box.height - 800) < 2 && Math.abs(box.width / box.height - 9 / 16) < 0.01, `9:16 で画面に収まる（${box.width.toFixed(0)}×${box.height.toFixed(0)}）`);
  await page.evaluate(() => { window.__game.setSpeed(3); });
  await page.waitForTimeout(3000);
  const st2 = await page.evaluate(() => ({ t: window.__game.world.t, items: window.__game.world.items.length + (window.__game.world.crab.held ? 1 : 0) }));
  check(st2.t > 6, `早送りでも進行（t=${st2.t.toFixed(1)}）`);
  await page.evaluate(() => window.__game.setSpeed(1));
  await page.keyboard.press('Space');
  await shot(page, '20-pc');
  check(page.errors.length === 0, 'コンソールエラーなし' + (page.errors.length ? ': ' + page.errors.join(' / ') : ''));
  await page.context().close();
}

// ---------------------------------------------------------------- 横長スマホ・小さい画面
for (const vp of [{ width: 320, height: 568 }, { width: 412, height: 915 }]) {
  const page = await newPage(vp);
  const box = await page.locator('#stage').boundingBox();
  const inside = (b) => b && b.y >= box.y - 1 && b.y + b.height <= box.y + box.height + 1 && b.x >= box.x - 1 && b.x + b.width <= box.x + box.width + 1;
  const logo = await page.locator('.tLogo').boundingBox(), btn = await page.locator('#howtoBtn').boundingBox();
  check(inside(logo) && inside(btn), `${vp.width}×${vp.height}: タイトルのロゴとボタンが画面に収まる`);
  if (vp.width === 320) await shot(page, '21-title-320');
  await page.click('#howtoBtn');
  const hp = await page.locator('.howPanel').boundingBox(), hb = await page.locator('#howBackBtn').boundingBox();
  check(inside(hp) && inside(hb), `${vp.width}×${vp.height}: あそびかたのパネルが画面に収まる`);
  if (vp.width === 320) await shot(page, '22-howto-320');
  await page.context().close();
}

{
  console.log('■ ファビコンと OGP');
  const fav = await fetch(url + 'favicon.svg');
  check(fav.ok && (await fav.text()).includes('<svg'), 'favicon.svg が取得できる');
  const ogp = await fetch(url + 'ogp.png');
  const buf = Buffer.from(await ogp.arrayBuffer());
  check(ogp.ok && buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, 'ogp.png が 1200×630');
  const html = readFileSync(root + 'index.html', 'utf8');
  check(/rel="icon" href="\.\/favicon\.svg"/.test(html) && /og:image" content="https:\/\/[^"]+\/ogp\.png"/.test(html), 'index.html にファビコンと og:image（絶対 URL）');
}
await browser.close();
server.close();
console.log(failures ? `\n✘ ${failures} 件の確認に失敗` : '\n✔ すべての確認に成功');
process.exit(failures ? 1 : 0);
