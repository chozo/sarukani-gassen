// 単純な戦略のボットで遊ばせ、配分が「臼を軸にしないと倒せない」になっているかを測る。
// カニは無敵にして、攻め方の違いだけを比べる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLogic } from './load-logic.mjs';

const L = loadLogic();
const C = L.CFG;
const DT = 1 / 60;

function goTo(w, x) { return { targetX: x, action: false }; }

// useUsu=false なら臼を無視する。noAllies=true なら蜂・栗を使わず、臼を猿の真下に仕掛けるだけ
function bot(w, opt) {
  const c = w.crab, m = w.monkey, u = w.usu;
  const armed = u && u.state === 'armed';
  if (c.held === 'usu') {
    const tx = opt.noAllies ? m.x : (m.x > 180 ? 90 : 270);
    if (Math.abs(c.x - tx) < 6) return { action: true };
    return goTo(w, tx);
  }
  if (c.held === 'chestnut' || c.held === 'bee') {
    let tx = m.x;
    if (armed) tx = L.clamp(m.x + Math.sign(m.x - u.x) * (c.held === 'bee' ? 60 : 40), 24, 336);
    if (Math.abs(c.x - tx) < 6) return { action: true };
    return goTo(w, tx);
  }
  // 拾いに行く
  const cands = w.items.filter((it) => (opt.useUsu || it.kind !== 'usu') && !(opt.noAllies && (it.kind === 'bee' || it.kind === 'chestnut'))).map((it) => it.x);
  if (opt.useUsu && u && u.state === 'grounded') cands.unshift(u.x);
  if (cands.length) {
    cands.sort((a, b) => Math.abs(a - c.x) - Math.abs(b - c.x));
    return goTo(w, cands[0]);
  }
  return goTo(w, m.x);
}

function play(seed, opt, limit = 240) {
  const w = L.createWorld(seed);
  w.crab.hp = 1e9;
  for (let i = 0; i < limit / DT; i++) {
    // 使わない仲間は、拾ってもその場で手放す（通り道で勝手に拾ってしまうため）
    if (!opt.useUsu && w.crab.held === 'usu') w.crab.held = null;
    if (opt.noAllies && (w.crab.held === 'bee' || w.crab.held === 'chestnut')) w.crab.held = null;
    L.stepWorld(w, DT, bot(w, opt));
    w.events.length = 0;
    if (w.phase !== 'play') break;
  }
  return { won: w.phase === 'win' || w.phase === 'done', t: w.t, hp: w.monkey.hp, hits: w.stats.usuHits, miss: w.stats.usuMiss };
}

test('臼を使わない戦略では、4分かけても倒せない（臼ゾーンで止まる）', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const r = play(seed, { useUsu: false });
    assert.equal(r.won, false, `seed ${seed}`);
    assert.equal(r.hp, C.MONKEY.guard, `seed ${seed}: hp=${r.hp}`);
  }
});

test('臼を仕掛けて蜂・栗で追い込む戦略なら、ほぼ毎回 3 分以内に倒せる', () => {
  const res = [];
  for (let seed = 1; seed <= 12; seed++) res.push(play(seed, { useUsu: true }, 180));
  const wins = res.filter((r) => r.won);
  const avg = wins.reduce((s, r) => s + r.t, 0) / Math.max(1, wins.length);
  console.log(`  追い込み: 勝ち ${wins.length}/12, 平均 ${avg.toFixed(1)}秒, 臼 命中 ${res.reduce((s, r) => s + r.hits, 0)} / 外れ ${res.reduce((s, r) => s + r.miss, 0)}`);
  assert.ok(wins.length >= 10, `勝ち ${wins.length}/12`);
});

test('蜂・栗で慌てさせず、臼を猿の真下に置くだけでは、ほとんど当たらない', () => {
  let driveHits = 0, naiveHits = 0;
  for (let seed = 1; seed <= 8; seed++) {
    driveHits += play(seed, { useUsu: true }, 90).hits;
    naiveHits += play(seed, { useUsu: true, noAllies: true }, 90).hits;
  }
  console.log(`  90秒での臼命中: 追い込み ${driveHits} / 臼だけ ${naiveHits}`);
  assert.ok(naiveHits * 4 <= driveHits, `追い込み ${driveHits} / 臼だけ ${naiveHits}`);
});

test('勝ち抜き：追い込むボットは次々に倒せるが、n 匹目ほど倒すのに時間がかかる', () => {
  const per = [];
  for (let seed = 1; seed <= 6; seed++) {
    const w = L.createWorld(seed);
    for (let i = 0; i < 480 / DT && w.phase !== 'done'; i++) {
      w.crab.hp = 1e9; // 倒すと体力が上限に戻るので毎回無敵にし直す
      L.stepWorld(w, DT, bot(w, { useUsu: true }));
      w.events.length = 0;
    }
    per.push(w.stats.killTimes);
  }
  const kills = per.map((k) => k.length);
  const avg = (i) => { const v = per.filter((k) => k.length > i).map((k) => k[i]); return v.reduce((a, b) => a + b, 0) / v.length; };
  console.log(`  8分で倒した数: ${kills.join(', ')} ／ 1匹目 平均 ${avg(0).toFixed(0)}秒, 5匹目 平均 ${avg(4).toFixed(0)}秒`);
  assert.ok(Math.min(...kills) >= 5, `倒した数 ${kills}`);
  assert.ok(avg(4) > avg(0) * 1.3, '後の猿ほど時間がかかる');
});

test('何もしないカニは、やがて青柿で倒れる', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const w = L.createWorld(seed);
    for (let i = 0; i < 90 / DT && w.phase === 'play'; i++) { L.stepWorld(w, DT, {}); w.events.length = 0; }
    assert.equal(w.phase, 'lose', `seed ${seed}`);
  }
});
