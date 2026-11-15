import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLogic } from './load-logic.mjs';

const L = loadLogic();
const C = L.CFG;
const DT = 1 / 60;

// ---- 補助 ----
function world(seed = 1) {
  const w = L.createWorld(seed);
  w.crab.hp = 9999;          // シナリオ検証ではカニを倒れなくする
  w.spawnT = 9999;           // アイテムの自然出現を止める
  return w;
}
function run(w, sec, input = {}, onStep) {
  const evs = [];
  for (let i = 0; i < Math.round(sec / DT); i++) {
    L.stepWorld(w, DT, input);
    const stop = onStep && onStep(w) === false;
    for (const e of w.events.splice(0)) evs.push(e);
    if (stop) break;
    if (w.phase === 'done') break;
  }
  return evs;
}
function placeMonkey(w, x, tier = 1) {
  const m = w.monkey;
  m.x = x; m.tier = tier; m.y = C.TIERS[tier].y; m.target = null; m.jump = null;
  m.state = 'calm'; m.idleT = 0.5; m.throwT = 99;
}
function armUsu(w, x) {
  w.usu = { state: 'armed', x, y: C.RAIL.y - C.USU.half, tx: x, vy: 0, vx: 0, rot: 0, life: 0, crossed: false, t: 0, armT: 0 };
}
function blastAt(w, x) {
  w.chestnuts.push({ x, y: C.GROUND_Y - 9, state: 'fuse', t: 0.0001, vy: 0, hit: false });
}

// ================= 乱数・難易度 =================
test('乱数は seed で再現できる', () => {
  const a = L.makeRng(42), b = L.makeRng(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('投擲間隔は時間とともに短くなり、怒ると更に短い', () => {
  let prev = Infinity;
  for (let t = 0; t <= 120; t += 10) {
    const iv = L.throwInterval(t, 1);
    assert.ok(iv <= prev);
    prev = iv;
  }
  assert.equal(L.throwInterval(0, 1), C.THROW.intervalStart);
  assert.equal(L.throwInterval(200, 1), C.THROW.intervalEnd);
  assert.ok(L.throwInterval(50, 0.4) < L.throwInterval(50, 0.9));
});

test('序盤は単発、後半は2連投・3連投が出る', () => {
  assert.equal(L.throwCount(10, 1, 0.0), 1);
  assert.equal(L.throwCount(40, 1, 0.1), 2);
  assert.equal(L.throwCount(40, 1, 0.9), 1);
  assert.equal(L.throwCount(80, 1, 0.05), 3);
});

// ================= 投擲（先読み） =================
test('青柿は先読みした位置に、飛行時間ちょうどで届く', () => {
  const T = 0.9, ox = 100, oy = 200;
  const a = L.aimThrow(ox, oy, 180, 100, T);
  assert.ok(Math.abs(a.tx - (180 + 100 * T * C.THROW.lead)) < 1e-9, '速度×時間×lead だけ先を狙う');
  const x = ox + a.vx * T, y = oy + a.vy * T + 0.5 * C.THROW.gravity * T * T;
  assert.ok(Math.abs(x - a.tx) < 1e-6);
  assert.ok(Math.abs(y - C.THROW.targetY) < 1e-6);
  // 止まっているカニには真っすぐ
  assert.equal(L.aimThrow(ox, oy, 180, 0, T).tx, 180);
});

// ================= ダメージ =================
test('ダメージ配分：針2・蜂1・栗18・臼45', () => {
  assert.deepEqual([C.DMG.needle, C.DMG.bee, C.DMG.chestnut, C.DMG.usu], [2, 1, 18, 45]);
  assert.equal(L.applyDamage(100, 'chestnut').hp, 82);
  assert.equal(L.applyDamage(100, 'usu').hp, 55);
});

test('針・蜂・栗では「臼ゾーン」より下に削れない。臼なら削れる', () => {
  let hp = 100;
  for (let i = 0; i < 200; i++) hp = L.applyDamage(hp, ['needle', 'bee', 'chestnut'][i % 3]).hp;
  assert.equal(hp, C.MONKEY.guard);
  const r = L.applyDamage(hp, 'chestnut');
  assert.equal(r.dealt, 0);
  assert.equal(r.blocked, true);
  assert.equal(L.applyDamage(hp, 'usu').hp, 0);
  // ゾーンをまたぐ chip は境目で止まる
  const r2 = L.applyDamage(30, 'chestnut');
  assert.equal(r2.hp, C.MONKEY.guard);
  assert.equal(r2.dealt, 30 - C.MONKEY.guard);
  assert.equal(r2.blocked, true);
});

test('臼を軸にしないと倒し切れない：臼2回＋少しの chip で倒せる', () => {
  let hp = 100;
  hp = L.applyDamage(hp, 'usu').hp;                 // 55
  hp = L.applyDamage(hp, 'chestnut').hp;            // 37
  hp = L.applyDamage(hp, 'usu').hp;                 // 0
  assert.equal(hp, 0);
});

// ================= 当たり判定 =================
test('臼の命中判定は横 ±26px の境界で切り替わる', () => {
  const U = C.USU;
  assert.equal(L.usuHitTest(100, 200, 100 + U.hitHalfW, 200), true);
  assert.equal(L.usuHitTest(100, 200, 100 + U.hitHalfW + 0.01, 200), false);
  assert.equal(L.usuHitTest(100, 200, 100, 200 + U.hitHalfH), true);
  assert.equal(L.usuHitTest(100, 200, 100, 200 + U.hitHalfH + 0.01), false);
});

test('熟柿キャッチの境界：カニの判定幅 + 柿の半径まで', () => {
  const edge = C.CRAB.halfW + 3 + C.RIPE_R;
  assert.equal(L.catchTest(200 + edge, C.CRAB.y, 200), true);
  assert.equal(L.catchTest(200 + edge + 0.5, C.CRAB.y, 200), false);
  assert.equal(L.catchTest(200, C.CRAB.y - 4 - C.CRAB.halfH - 8 - C.RIPE_R, 200), true);
});

test('青柿の当たり判定は見た目より少し小さい（理不尽に当てない）', () => {
  const edge = C.CRAB.halfW - 2 + C.GREEN_R;
  assert.equal(L.crabHitTest(200 + edge, C.CRAB.y, 200), true);
  assert.equal(L.crabHitTest(200 + edge + 0.5, C.CRAB.y, 200), false);
});

// ================= 臼の落下タイミング =================
test('臼は「着いた瞬間に猿がいる位置」が真下 ±12px なら落ちる（止まっている猿）', () => {
  const w = world();
  armUsu(w, 150);
  placeMonkey(w, 150 + C.USU.dropWindow, 1);
  w.monkey.state = 'windup'; w.monkey.stateT = 5;
  assert.equal(L.shouldDropUsu(w.usu, w.monkey, C), true);
  w.monkey.x = 150 + C.USU.dropWindow + 0.5;
  assert.equal(L.shouldDropUsu(w.usu, w.monkey, C), false);
});

test('走ってくる猿には、落下時間ぶん手前で落ちる（先読み）', () => {
  const w = world();
  armUsu(w, 100);
  const m = w.monkey;
  placeMonkey(w, 300, 2);
  m.state = 'flee'; m.target = { tier: 2, x: 30 };
  const dy = (C.TIERS[2].y - C.MONKEY.bodyOff) - w.usu.y;
  const tf = L.fallTime(dy, C.USU.gravity);
  let dropX = null;
  run(w, 3, {}, (ww) => { if (ww.usu && ww.usu.state === 'fall' && dropX == null) dropX = ww.monkey.x; });
  assert.ok(dropX != null, '落ちた');
  const lead = dropX - 100;
  assert.ok(Math.abs(lead - C.MONKEY.fleeSpeed * tf) <= C.USU.dropWindow + 4, `手前 ${lead.toFixed(1)}px で落下（理論 ${(C.MONKEY.fleeSpeed * tf).toFixed(1)}px）`);
});

test('走っていた猿が臼の手前で止まると、臼は外れ、そのずれが記録される', () => {
  const w = world();
  armUsu(w, 100);
  placeMonkey(w, 220, 1);
  w.monkey.state = 'flee'; w.monkey.target = { tier: 1, x: 140 };
  const evs = run(w, 2);
  const cross = evs.find((e) => e.type === 'usuCross');
  assert.ok(evs.some((e) => e.type === 'usuDrop'), '走る猿を見て落ちる');
  assert.ok(cross && cross.hit === false, '外れ');
  assert.ok(Math.abs(cross.dx) > C.USU.hitHalfW, `ずれ ${cross.dx}`);
  assert.ok(evs.some((e) => e.type === 'usuMiss'));
  assert.equal(w.usu.state, 'grounded');
});

test('臼は仕掛けると幹まで転がり、登り、仕掛けた位置の真上で待つ', () => {
  const w2 = world();
  placeMonkey(w2, 300, 0);
  w2.crab.x = 70; w2.crab.held = 'usu';
  L.stepWorld(w2, DT, { action: true });
  const seen = [];
  run(w2, 6, {}, (ww) => { if (ww.usu && seen[seen.length - 1] !== ww.usu.state) seen.push(ww.usu.state); });
  assert.deepEqual(seen.slice(0, 4), ['toTrunk', 'climb', 'rail', 'armed']);
  assert.equal(w2.usu.x, 70);
  assert.equal(w2.usu.y, C.RAIL.y - C.USU.half);
  assert.equal(w2.crab.held, null);
});

test('臼を持っている間はカニが遅い', () => {
  const a = world(), b = world();
  b.crab.held = 'usu';
  run(a, 0.3, { moveX: 1 }); run(b, 0.3, { moveX: 1 });
  const da = a.crab.x - 180, db = b.crab.x - 180;
  assert.ok(Math.abs(db / da - C.CRAB.usuSpeedMul) < 0.02);
});

test('外れた臼は地面に残り、拾って仕掛け直せる', () => {
  const w = world();
  armUsu(w, 100);
  w.usu.state = 'fall'; w.usu.vy = 0;
  placeMonkey(w, 300, 1);
  const evs = run(w, 1.5);
  assert.ok(evs.some((e) => e.type === 'usuMiss'));
  assert.equal(w.usu.state, 'grounded');
  w.crab.x = 100;
  L.stepWorld(w, DT, {});
  assert.equal(w.crab.held, 'usu');
  assert.equal(w.usu, null);
});

// ================= 猿の AI =================
test('落ち着いた猿は臼の列を避ける（何もしなければ臼は当たらない）', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const w = world(seed);
    armUsu(w, 120);
    placeMonkey(w, 260, 1);
    w.monkey.throwT = 1;
    let minD = Infinity;
    const evs = run(w, 30, {}, (ww) => { minD = Math.min(minD, Math.abs(ww.monkey.x - 120)); });
    assert.equal(evs.filter((e) => e.type === 'usuHit').length, 0, `seed ${seed}`);
    assert.ok(minD >= C.MONKEY.avoidHalf - 1, `seed ${seed}: 最接近 ${minD.toFixed(1)}`);
  }
});

test('臼が真上に来たら、落ち着いた猿は気づいて横へよける', () => {
  const w = world();
  placeMonkey(w, 150, 1);
  w.usu = { state: 'rail', x: 180, y: C.RAIL.y - C.USU.half, tx: 150, vy: 0, vx: 0, rot: 0, t: 0 };
  const evs = run(w, 2);
  assert.ok(evs.some((e) => e.type === 'monkeyNotice'));
  assert.ok(Math.abs(w.monkey.x - 150) >= C.MONKEY.avoidHalf);
  assert.equal(evs.filter((e) => e.type === 'usuHit').length, 0);
});

test('栗の破裂：猿は爆発と反対側（枝の端）へ逃げる', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = L.makeRng(seed);
    const right = L.fleeTarget(200, 1, 260, rng);   // 爆発が右 → 左へ
    assert.equal(right.dir, -1);
    assert.ok(right.x <= C.TIERS[right.tier].x0 + 46, `x=${right.x}`);
    const left = L.fleeTarget(200, 1, 120, rng);    // 爆発が左 → 右へ
    assert.equal(left.dir, 1);
    assert.ok(left.x >= C.TIERS[left.tier].x1 - 46, `x=${left.x}`);
  }
});

test('栗の破裂で、猿は実際に爆発の反対側へ移動する（シミュレーション）', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const w = world(seed);
    placeMonkey(w, 200, 1);
    blastAt(w, 240);
    let endX = null, endTier = null, prev = 'calm';
    const evs = run(w, 3, {}, (ww) => {
      if (prev === 'flee' && ww.monkey.state !== 'flee' && endX == null) { endX = ww.monkey.x; endTier = ww.monkey.tier; }
      prev = ww.monkey.state;
    });
    assert.ok(evs.some((e) => e.type === 'blast'));
    assert.ok(evs.some((e) => e.type === 'monkeyFlee' && e.dir === -1));
    assert.ok(endX != null && endX <= C.TIERS[endTier].x0 + 46, `seed ${seed}: 逃げ終わり x=${endX}`);
  }
});

test('栗は猿めがけて飛び、猿の高さで破裂する：横に離れていても届く範囲なら当たる', () => {
  for (const off of [0, 60, -60, 110, -110]) {
    const w = world();
    placeMonkey(w, 180, 1);
    blastAt(w, 180 + off);
    const evs = run(w, 1);
    const b = evs.find((e) => e.type === 'chestnutBurst');
    assert.ok(b, `off=${off}`);
    assert.ok(Math.abs(b.y - (C.TIERS[1].y - C.MONKEY.bodyOff)) < 1, '破裂は猿の体の高さ');
    assert.equal(b.hit, true, `off=${off}: dist=${b.dist}`);
    assert.equal(w.monkey.hp, 100 - C.DMG.chestnut, `off=${off}`);
  }
});

test('栗が届く範囲の外（横に aimMax + burstR より遠い）なら外れ、距離を返す', () => {
  const reach = C.CHESTNUT.aimMax + C.CHESTNUT.burstR;
  const w = world();
  placeMonkey(w, 300, 1);
  blastAt(w, 300 - reach - 20);
  const evs = run(w, 1);
  const b = evs.find((e) => e.type === 'chestnutBurst');
  assert.equal(b.hit, false);
  assert.ok(b.dist > C.CHESTNUT.burstR);
  assert.equal(w.monkey.hp, 100);
  assert.ok(evs.some((e) => e.type === 'monkeyFlee'), '外れても猿は驚いて逃げる');
});

test('栗の狙いと破裂判定（境界）', () => {
  const K = C.CHESTNUT;
  const a = L.chestnutAim(100, 563, 400, 210);
  assert.equal(a.tx, 100 + K.aimMax);
  assert.equal(a.ty, 210);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - K.speed) < 1e-6);
  assert.equal(L.chestnutAim(100, 563, 130, 210).tx, 130);
  // 半径ちょうどは当たり、それより外は外れ（ゲームでは chestnutBurst の hit で確認）
  const w1 = world(); placeMonkey(w1, 100 + K.aimMax + K.burstR, 1); blastAt(w1, 100);
  assert.equal(run(w1, 1).find((e) => e.type === 'chestnutBurst').hit, true);
  const w2 = world(); placeMonkey(w2, 100 + K.aimMax + K.burstR + 2, 1); blastAt(w2, 100);
  assert.equal(run(w2, 1).find((e) => e.type === 'chestnutBurst').hit, false);
});

test('真下の栗は、猿が驚いて止まっている間に当たる', () => {
  const w = world();
  placeMonkey(w, 200, 2);
  blastAt(w, 205);
  const evs = run(w, 1);
  assert.ok(evs.some((e) => e.type === 'chestnutHit'));
  assert.equal(w.monkey.hp, 100 - C.DMG.chestnut);
});

test('蜂がいる間、猿は投げずに逃げ回り、カニと反対側へ行く', () => {
  const w = world(3);
  placeMonkey(w, 180, 1);
  w.monkey.throwT = 0.2;
  w.crab.x = 260; w.crab.held = 'bee';
  L.stepWorld(w, DT, { action: true });
  let chasedFrames = 0, frames = 0, x1 = null;
  const evs = run(w, C.BEE.life - 0.2, {}, (ww) => {
    frames++;
    if (frames === 60) x1 = ww.monkey.x;
    if (ww.monkey.state === 'chased') chasedFrames++;
  });
  assert.ok(x1 < 180 - 60, `1秒後 x=${x1}（カニは右にいるので左へ逃げる）`);
  assert.equal(evs.filter((e) => e.type === 'throw').length, 0, '蜂がいる間は投擲なし');
  assert.ok(chasedFrames / frames > 0.9);
  assert.ok(evs.some((e) => e.type === 'beeSting'));
  const stings = evs.filter((e) => e.type === 'beeSting').length;
  assert.ok(stings >= 1 && stings <= Math.ceil(C.BEE.life / C.BEE.stingCd));
});

test('蜂が刺すと、ときどき熟柿が落ちる', () => {
  let ripe = 0, stings = 0;
  for (let seed = 1; seed <= 15; seed++) {
    const w = world(seed);
    placeMonkey(w, 180, 1);
    w.crab.held = 'bee'; w.crab.x = 300;
    L.stepWorld(w, DT, { action: true });
    const evs = run(w, C.BEE.life);
    stings += evs.filter((e) => e.type === 'beeSting').length;
    ripe += evs.filter((e) => e.type === 'ripeDrop').length;
  }
  assert.ok(stings > 20);
  assert.ok(ripe > 0 && ripe < stings);
});

// ================= 追い込み（核） =================
test('核：臼の反対側で栗を破裂させると、猿は臼の下へ逃げ込み、臼が当たる', () => {
  let hits = 0;
  const N = 30;
  for (let seed = 1; seed <= N; seed++) {
    const w = world(seed);
    armUsu(w, 100);
    placeMonkey(w, 230, seed % 3);
    blastAt(w, 290);
    const evs = run(w, 4);
    if (evs.some((e) => e.type === 'usuHit')) hits++;
  }
  assert.ok(hits / N >= 0.8, `命中率 ${hits}/${N}`);
});

test('核：同じ側で栗を破裂させても（猿が臼から遠ざかる）臼は当たらない', () => {
  for (let seed = 1; seed <= 15; seed++) {
    const w = world(seed);
    armUsu(w, 100);
    placeMonkey(w, 230, 1);
    blastAt(w, 180);           // 猿の左で破裂 → 右へ逃げる
    const evs = run(w, 4);
    assert.equal(evs.filter((e) => e.type === 'usuHit').length, 0, `seed ${seed}`);
  }
});

test('核：蜂で追い立てると、猿は臼の下を通り、臼が当たることが多い', () => {
  let hits = 0;
  const N = 20;
  for (let seed = 1; seed <= N; seed++) {
    const w = world(seed);
    armUsu(w, 90);
    placeMonkey(w, 240, 1);
    w.crab.x = 320; w.crab.held = 'bee';
    L.stepWorld(w, DT, { action: true });
    const evs = run(w, C.BEE.life);
    if (evs.some((e) => e.type === 'usuHit')) hits++;
  }
  assert.ok(hits / N >= 0.6, `命中率 ${hits}/${N}`);
});

// ================= 出現抽選 =================
test('出現抽選：臼が場にあるときは臼を出さない／しばらく無ければ臼を出す', () => {
  const rng = L.makeRng(7);
  for (let i = 0; i < 300; i++) {
    const s = L.pickSpawn({ crabX: 180, monkeyX: 180, items: [], usuInWorld: true, sinceUsuGone: 0 }, rng);
    assert.notEqual(s.kind, 'usu');
  }
  const s = L.pickSpawn({ crabX: 180, monkeyX: 180, items: [], usuInWorld: false, sinceUsuGone: C.ITEM.usuPity }, rng);
  assert.equal(s.kind, 'usu');
  const f = L.pickSpawn({ crabX: 180, monkeyX: 180, items: [], usuInWorld: true, sinceUsuGone: 0, forceKind: 'usu' }, rng);
  assert.notEqual(f.kind, 'usu');
});

test('出現位置：カニから離れ、半分以上は猿の真下付近（取りに行くこと自体がリスク）', () => {
  const rng = L.makeRng(11);
  let near = 0;
  const N = 400;
  const counts = { needle: 0, bee: 0, chestnut: 0, usu: 0 };
  for (let i = 0; i < N; i++) {
    const crabX = 30 + rng() * 300, monkeyX = 30 + rng() * 300;
    const s = L.pickSpawn({ crabX, monkeyX, items: [{ kind: 'bee', x: 60 }], usuInWorld: false, sinceUsuGone: 0 }, rng);
    counts[s.kind]++;
    assert.ok(s.x >= C.ITEM.xMin && s.x <= C.ITEM.xMax);
    assert.ok(Math.abs(s.x - crabX) >= C.ITEM.minDistFromCrab || s.x === C.ITEM.xMin || s.x === C.ITEM.xMax);
    if (Math.abs(s.x - monkeyX) <= 40) near++;
  }
  assert.ok(near / N > 0.3, `猿の真下付近 ${near}/${N}`);
  for (const k of Object.keys(counts)) assert.ok(counts[k] > N * 0.12, `${k}: ${counts[k]}`);
});

test('最初の3つは 臼 → 栗 → 蜂 の順で出る（チュートリアル）', () => {
  const w = L.createWorld(5);
  w.crab.hp = 9999;
  const kinds = [];
  run(w, 20, {}, (ww) => { for (const e of ww.events) if (e.type === 'spawnItem') kinds.push(e.kind); });
  assert.deepEqual(kinds.slice(0, 3), ['usu', 'chestnut', 'bee']);
});

test('針は拾うと即発動し、真上に連射する（手持ちは埋まらない）', () => {
  const w = world();
  placeMonkey(w, 180, 2);
  w.monkey.state = 'windup'; w.monkey.stateT = 99;
  w.crab.held = 'chestnut';
  w.items.push({ kind: 'needle', x: 180, life: 5, t: 0 });
  const evs = run(w, C.NEEDLE.duration + 0.5);
  assert.equal(w.crab.held, 'chestnut');
  const fires = evs.filter((e) => e.type === 'needleFire').length;
  assert.ok(Math.abs(fires - C.NEEDLE.duration / C.NEEDLE.interval) <= 1.5, `fires=${fires}`);
  const hits = evs.filter((e) => e.type === 'needleHit').length;
  assert.ok(hits > 10);
  assert.equal(w.monkey.hp, 100 - hits * C.DMG.needle);
});

// ================= スコア =================
test('スコア：ダメージ・熟柿・臼命中・倒した猿のボーナス', () => {
  const r = L.computeScore({ damage: 100, ripe: 4, usuHits: 2, kills: 2, killBonus: 2500 });
  assert.equal(r.damage, 1000);
  assert.equal(r.ripe, 400);
  assert.equal(r.usu, 600);
  assert.equal(r.kills, 2500);
  assert.equal(r.total, 1000 + 400 + 600 + 2500);
  assert.equal(r.rank, '猿こらしめ係');
  const zero = L.computeScore({ damage: 50, ripe: 1, usuHits: 0, kills: 0, killBonus: 0 });
  assert.equal(zero.kills, 0);
  assert.equal(zero.rank, 'まだまだ子ガニ');
});

test('倒したボーナス：n 匹目ほど多く、速く倒すほど多い（60 秒以降は速さ 0）', () => {
  assert.equal(L.killBonus(1, 30), 500 + 30 * 20);
  assert.equal(L.killBonus(3, 30), 1500 + 30 * 20);
  assert.equal(L.killBonus(2, 60), 1000);
  assert.equal(L.killBonus(2, 200), 1000);
});

// ================= 勝ち抜き =================
test('ハート：猿を倒すたびに最大数 +1、7 個で止まる。体力も +1', () => {
  let hp = 3, mx = 3;
  const seq = [];
  for (let i = 0; i < 8; i++) { const r = L.growHearts(hp, mx); hp = r.hp; mx = r.maxHp; seq.push(mx); }
  assert.deepEqual(seq, [4, 5, 6, 7, 7, 7, 7, 7]);
  assert.equal(hp, 7);
  assert.deepEqual({ ...L.growHearts(1, 5) }, { hp: 2, maxHp: 6 });
  assert.deepEqual({ ...L.growHearts(2, 7) }, { hp: 3, maxHp: 7 });
  assert.deepEqual({ ...L.growHearts(7, 7) }, { hp: 7, maxHp: 7 });
});

test('熟柿の回復は、増えたハートの最大数まで', () => {
  const w = world();
  w.crab.maxHp = 5; w.crab.hp = 4;
  w.persimmons.push({ kind: 'ripe', x: w.crab.x, y: C.CRAB.y - 30, vx: 0, vy: C.RIPE_FALL, r: C.RIPE_R, ph: 0, t: 0 });
  run(w, 1);
  assert.equal(w.crab.hp, 5);
  w.persimmons.push({ kind: 'ripe', x: w.crab.x, y: C.CRAB.y - 30, vx: 0, vy: C.RIPE_FALL, r: C.RIPE_R, ph: 0, t: 0 });
  run(w, 1);
  assert.equal(w.crab.hp, 5);
});

test('称号：倒した数のしきい値ちょうどで上がり、次の称号まであと何匹かが分かる', () => {
  assert.equal(L.titleFor(0).name, 'まだまだ子ガニ');
  assert.equal(L.titleFor(1).name, '一人前のカニ');
  assert.equal(L.titleFor(4).name, '柿の木の番人');
  assert.equal(L.titleFor(5).name, 'カニ名人');
  assert.deepEqual({ ...L.titleFor(4).next }, { at: 5, name: 'カニ名人', left: 1 });
  assert.equal(L.titleFor(20).next, null);
  assert.equal(L.titleFor(99).name, 'カニ神さま');
  // しきい値は昇順
  const at = [...C.TITLES].map((t) => t.at);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('猿の強さ：n 匹目ほど体力が多く、投げる間隔が短い（上限・下限あり）', () => {
  let prev = L.waveStats(1);
  assert.equal(prev.maxHp, 100);
  assert.equal(prev.guard, 20);
  for (let n = 2; n <= 12; n++) {
    const s = L.waveStats(n);
    assert.ok(s.maxHp >= prev.maxHp && s.maxHp <= C.WAVE.hpMax, `n=${n}`);
    assert.equal(s.guard, Math.round(s.maxHp * 0.2));
    assert.ok(L.throwInterval(0, 1, C, n) < L.throwInterval(0, 1, C, n - 1) || L.throwInterval(0, 1, C, n) === C.WAVE.intervalFloor, `n=${n}`);
    prev = s;
  }
  assert.equal(L.waveStats(2).maxHp, 130);
  assert.equal(L.waveStats(50).maxHp, C.WAVE.hpMax);
  assert.ok(L.throwInterval(500, 1, C, 30) >= C.WAVE.intervalFloor);
  // 1 匹目は従来どおり
  assert.equal(L.throwInterval(0, 1, C, 1), C.THROW.intervalStart);
});

test('臼ゾーンは猿ごとの体力の 20%：針・蜂・栗では guard 未満に削れない', () => {
  const s = L.waveStats(4); // 体力 190, guard 38
  let hp = s.maxHp;
  for (let i = 0; i < 300; i++) hp = L.applyDamage(hp, ['needle', 'bee', 'chestnut'][i % 3], C, s.guard).hp;
  assert.equal(hp, s.guard);
  assert.equal(L.applyDamage(hp, 'usu', C, s.guard).hp, 0);
});

test('猿を倒すと、謝ったあと次の猿が降ってきて戦いが続く（体力 +1・強くなる）', () => {
  const w = world();
  w.crab.hp = 1;
  w.monkey.hp = 10; w.monkey.guard = 0;
  placeMonkey(w, 120);
  const evs = [];
  L.stepWorld(w, DT, {});
  // 臼を真上から当てる代わりに、直接ダメージ処理を通す
  w.monkey.hp = C.DMG.usu;
  w.usu = { state: 'fall', x: w.monkey.x, tx: w.monkey.x, y: w.monkey.y - 80, vy: 600, t: 0, hit: false };
  evs.push(...run(w, 0.5));
  assert.ok(evs.some((e) => e.type === 'win'), '倒した');
  assert.equal(w.phase, 'win');
  assert.equal(w.stats.kills, 1);
  assert.equal(w.crab.hp, 2, '体力 +1');
  assert.equal(w.crab.maxHp, 4, 'ハートの最大数 +1');
  assert.ok(evs.some((e) => e.type === 'title' && e.name === '一人前のカニ'));
  evs.push(...run(w, C.WAVE.outro + 2));
  assert.ok(evs.some((e) => e.type === 'nextMonkey' && e.wave === 2));
  assert.ok(evs.some((e) => e.type === 'monkeyEnter'));
  assert.equal(w.phase, 'play');
  assert.equal(w.wave, 2);
  assert.equal(w.monkey.hp, 130);
  assert.equal(w.monkey.maxHp, 130);
  assert.equal(w.monkey.guard, 26);
  assert.equal(w.monkey.state === 'defeated', false);
  assert.ok(w.stats.killBonus > 500);
});

test('勝ち抜きでも、ゲームが終わるのはカニが倒れたときだけ', () => {
  const w = L.createWorld(3);
  for (let i = 0; i < 300 / DT && w.phase !== 'done'; i++) { L.stepWorld(w, DT, {}); w.events.length = 0; }
  assert.equal(w.phase, 'done');
  assert.equal(w.result, 'lose');
});
