// OGP 画像（public/ogp.png、1200×630）を作る。  npm run ogp
//   1. ゲームを開き、確認用の入口 window.__game で場面を進めてゲーム画面を撮る
//   2. その画面写真・ロゴ・カニのイラスト（public/favicon.svg）を 1200×630 に並べて撮る
// 乱数の種と進めるコマ数を固定しているので、毎回同じ絵になる。
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const OUT = root + 'public/ogp.png';
const SLUG = 'sarukani-gassen';
const PUBLIC_URL = `game.chozo.net/${SLUG}/`;

const executablePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });

// ---- 1. ゲーム画面 ----
const gctx = await browser.newContext({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2 });
const gp = await gctx.newPage();
await gp.goto(pathToFileURL(root + 'index.html').href);
await gp.waitForFunction(() => !!window.__game);
await gp.evaluate(() => {
  const G = window.__game;
  G.manual(true);
  G.start(7);
  const w = () => G.world;
  // 臼を猿の右側に仕掛け、蜂を放って猿を追い立てる
  G.give('usu');
  G.step(1, { targetX: 250 });
  for (let i = 0; i < 400 && Math.abs(w().crab.x - 250) > 4; i++) G.step(1, { targetX: 250 });
  G.step(1, { action: true });
  for (let i = 0; i < 600 && !(w().usu && w().usu.state === 'armed'); i++) G.step(1, { targetX: 150 });
  G.give('bee');
  G.step(1, { action: true });
  G.step(70, { targetX: 120 });
  G.give('chestnut');
  G.drainEvents();
  G.render();
  document.querySelectorAll('.show').forEach((e) => { if (e.id === 'hint') e.classList.remove('show'); });
});
const gameShot = await gp.locator('#stage').screenshot({ type: 'png' });
await gctx.close();

// ---- 2. 組み合わせ ----
const crabSvg = readFileSync(root + 'public/favicon.svg', 'utf8');
const toData = (buf, type) => `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", sans-serif; font-weight: 900;
    background: radial-gradient(circle at 34% 46%, #fff3b8 0, #ffd65a 38%, #ffab3d 100%); }
  .rays { position: absolute; left: 34%; top: 46%; width: 2400px; height: 2400px; margin: -1200px 0 0 -1200px;
    background: repeating-conic-gradient(rgba(255,255,255,.28) 0 7deg, transparent 7deg 18deg); }
  .dots { position: absolute; inset: 0;
    background-image: radial-gradient(rgba(255,255,255,.55) 3px, transparent 4px); background-size: 34px 34px; opacity: .45; }
  .ground { position: absolute; left: 0; right: 0; bottom: 0; height: 70px; background: #6fbf4a; border-top: 8px solid #4f9a34; }
  .ground::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 30px; background: #8a5a34; }
  .left { position: absolute; left: 60px; top: 62px; width: 690px; text-align: center; }
  .ribbon { display: inline-block; background: #3d7a2a; color: #fff; font-size: 30px; letter-spacing: .14em; padding: 8px 30px 10px;
    border-radius: 10px; transform: rotate(-3deg); box-shadow: 0 6px 0 #24501a; }
  .logo span { display: block; line-height: 1; paint-order: stroke fill; }
  .l1 { font-size: 108px; margin-top: 24px; white-space: nowrap; color: #ffd34d; -webkit-text-stroke: 16px #8a2a12;
    filter: drop-shadow(0 10px 0 #5a1a08); letter-spacing: .02em; }
  .l2 { font-size: 76px; margin-top: 18px; white-space: nowrap; color: #e8301c; -webkit-text-stroke: 13px #fff;
    filter: drop-shadow(0 8px 0 #5a1a08); transform: rotate(-4deg); }
  .bubble { display: inline-block; margin-top: 34px; background: #fff; border: 5px solid #8a2a12; border-radius: 40px;
    padding: 12px 34px 14px; font-size: 34px; color: #8a2a12; box-shadow: 0 7px 0 rgba(90,26,8,.35); }
  .bubble b { color: #e8301c; }
  .url { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: #2b2118; color: #fff;
    font-size: 26px; padding: 8px 26px 10px; border-radius: 30px; letter-spacing: .03em; white-space: nowrap; }
  .phone { position: absolute; right: 70px; top: 24px; width: 318px; height: 566px; border-radius: 30px; overflow: hidden;
    border: 9px solid #fff; transform: rotate(5deg); box-shadow: 0 16px 0 rgba(90,26,8,.3), 0 0 0 4px #8a2a12; background: #a9dcf2; }
  .phone img { width: 100%; height: 100%; display: block; object-fit: cover; }
  .crab { position: absolute; left: 732px; top: 404px; width: 210px; height: 210px; transform: rotate(-10deg);
    filter: drop-shadow(0 8px 0 rgba(90,26,8,.35)); }
  .crab svg { width: 100%; height: 100%; }
  .kaki { position: absolute; width: 58px; height: 58px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #ffa14a, #f07a1a 60%, #d55e10);
    box-shadow: 0 5px 0 rgba(90,26,8,.25); }
  .kaki::before { content: ""; position: absolute; left: 50%; top: -8px; width: 30px; height: 16px; margin-left: -15px;
    background: #3d7a2a; clip-path: polygon(0 100%, 20% 0, 50% 60%, 80% 0, 100% 100%); }
  .pop { position: absolute; font-size: 44px; color: #fff; -webkit-text-stroke: 8px #e8301c; paint-order: stroke fill; transform: rotate(12deg); }
</style></head><body>
  <div class="rays"></div><div class="dots"></div><div class="ground"></div>
  <div class="kaki" style="left:36px; top:330px; transform: rotate(-15deg)"></div>
  <div class="kaki" style="left:690px; top:40px; transform: rotate(12deg) scale(.8)"></div>
  <div class="kaki" style="left:640px; top:470px; transform: scale(.7)"></div>
  <div class="phone"><img src="${toData(gameShot, 'image/png')}"></div>
  <div class="left">
    <div class="ribbon">昔話アクション</div>
    <h1 class="logo" style="margin:0"><span class="l1">さるかに合戦</span><span class="l2">やられる前にヤレ</span></h1>
    <div class="bubble">強くなる猿を <b>何匹こらしめられる？</b></div>
  </div>
  <div class="crab">${crabSvg}</div>
  <div class="url" style="left:420px">${PUBLIC_URL}</div>
</body></html>`;
const cctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const cp = await cctx.newPage();
await cp.setContent(html);
await cp.evaluate(() => document.fonts.ready);
mkdirSync(root + 'public', { recursive: true });
writeFileSync(OUT, await cp.screenshot({ type: 'png' }));
await browser.close();
console.log('wrote', OUT);
