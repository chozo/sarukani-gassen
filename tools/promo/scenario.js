// 告知動画の台本（サルカニ合戦 やられる前にヤレ）。
// カニの操作は、ゲームの window に置いたボット（window.__promoBot）が毎ステップ決める。
// ボットは tests/balance.test.mjs の「臼を仕掛けて蜂・栗で追い込む」戦略と同じ。
// 称号は動画に出さない（「称号ゲット！」の帯は隠す。結果画面は映さない）。

const SEED = 27; // 1匹目を 28 秒ほどで倒す展開（tests の同じボットで探した）

export const config = {
  slug: 'sarukani-gassen',
  url: 'https://game.chozo.net/sarukani-gassen/',
  orientation: 'portrait',
  game: { width: 405, height: 720 },
  serveDir: 'dist',
  gamePath: '/sarukani-gassen/',
  music: { file: 'tools/promo/bgm.wav', volume: 0.04 }, // 効果音（約 -31 LUFS）より 12 dB ほど小さく
};

// ゲームの window で実行する準備：ボットを置き、称号の帯を隠す
function setup(arg, win) {
  const L = win.SaruLogic;
  win.__promoBot = function (w) {
    const c = w.crab, m = w.monkey, u = w.usu;
    // 動画の途中で倒れないよう、体力が 1 になったら戻す
    if (c.hp <= 1) c.hp = c.maxHp;
    const go = (x) => ({ targetX: L.clamp(x, 24, 336), action: false });
    const armed = u && u.state === 'armed';
    if (c.held === 'usu') {
      const tx = m.x > 180 ? 90 : 270;
      return Math.abs(c.x - tx) < 6 ? { action: true } : go(tx);
    }
    if (c.held === 'chestnut' || c.held === 'bee') {
      let tx = m.x;
      if (armed) tx = L.clamp(m.x + Math.sign(m.x - u.x) * (c.held === 'bee' ? 60 : 40), 24, 336);
      return Math.abs(c.x - tx) < 6 ? { action: true } : go(tx);
    }
    const cands = w.items.map((it) => it.x);
    if (u && u.state === 'grounded') cands.unshift(u.x);
    if (cands.length) { cands.sort((a, b) => Math.abs(a - c.x) - Math.abs(b - c.x)); return go(cands[0]); }
    return go(m.x);
  };
  if (!win.document.getElementById('promoStyle')) {
    const st = win.document.createElement('style');
    st.id = 'promoStyle';
    st.textContent = '#banner.title{display:none!important}';
    win.document.head.appendChild(st);
  }
}

export default async function scenario(p) {
  await p.seed(1);
  await p.call('start', SEED);
  await p.eval(setup);

  // 下見：1匹目を倒す臼の命中がゲーム内の何秒かを測る（撮らない）
  await p.until((s, ev) => ev.some((e) => e.type === 'win'), { max: 150, record: false });
  const hitT = (await p.state()).t;

  // ---- 0〜2.6秒 つかみ：臼が猿に落ちる瞬間をスローで ----
  await p.call('start', SEED);
  await p.eval(setup);
  p.zoom(1.3, 0.01, { x: 0.5, y: 0.3 });
  await p.until((s) => s.t >= hitT - 0.75, { max: 150, record: false });
  p.speed(0.5, { badge: false });
  p.on('usuHit', () => { p.fx('ドスーン！', { y: 0.5, size: 90, dur: 1.2 }); p.flash({ dur: 0.3 }); p.shake(16, 0.5); });
  await p.until((s, ev) => ev.some((e) => e.type === 'usuHit'), { max: 4 });
  await p.wait(0.9);
  p.speed(1);
  p.zoom(1, 0.3);
  p.off('usuHit');

  // ---- タイトル ----
  p.title({ title: 'サルカニ合戦', sub: 'やられる前にヤレ', logo: '/sarukani-gassen/favicon.svg', dur: 2.6 });
  await p.wait(3.1);

  // ---- 本編：最初から ----
  await p.call('start', SEED);
  await p.eval(setup);
  p.on('monkeyChased', () => p.fx('ブーン！', { y: 0.3, size: 60, dur: 0.8 }));
  p.on('chestnutBurst', (e) => { if (e.hit) { p.fx('パーン！', { y: 0.3, size: 66, dur: 0.8 }); p.shake(8, 0.25); } });
  p.on('usuMiss', () => p.caption('おしい！', { y: 0.16, dur: 1.1 }));
  p.on('usuHit', () => { p.fx('ドスーン！', { y: 0.46, size: 80, dur: 1 }); p.flash({ dur: 0.25 }); p.shake(14, 0.4); });

  p.caption('柿をよけて\n仲間をひろえ！', { y: 0.16, dur: 2.4 });
  await p.wait(3);
  p.caption('蜂・栗で\n猿を追いこめ！', { y: 0.16, dur: 2.2 });
  p.speed(3);
  await p.until((s) => s.t >= hitT - 1.6, { max: 12 });
  p.speed(1);
  await p.until((s, ev) => ev.some((e) => e.type === 'win'), { max: 4 });
  await p.wait(0.4);
  p.caption('こらしめた！', { y: 0.16, dur: 1.5, size: 60 });
  await p.wait(1.6);
  p.speed(1.5, { badge: false });
  p.caption('次の猿は\nもっと強い！', { y: 0.16, dur: 2.2 });
  await p.until((s) => s.phase === 'play', { max: 5 });
  await p.wait(0.6);

  // ---- クライマックス：何匹こらしめられる？ ----
  p.off('monkeyChased'); p.off('chestnutBurst');
  p.speed(3);
  p.caption('何匹\nこらしめられる？', { y: 0.16, dur: 2.4, size: 54 });
  await p.wait(3);
  p.speed(1);

  // ---- エンドカード ----
  for (const ev of ['usuMiss', 'usuHit']) p.off(ev);
  p.endCard({ title: 'サルカニ合戦', sub: 'やられる前にヤレ', logo: '/sarukani-gassen/favicon.svg', cta: '今すぐ遊べる！', dur: 3.5 });
  await p.wait(3.5);
}
