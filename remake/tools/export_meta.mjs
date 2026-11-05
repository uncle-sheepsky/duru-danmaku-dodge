// 엔진을 돌려 화면·글자·소리가 함께 읽는 사실 값을 data/meta.json 으로 뽑고, 연속 판정까지 게이트한다. 어긋나면 멈춤.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(HERE, '..');
const E = await import(pathToFileURL(path.resolve(R, '../danmaku_engine.js')).href);
const C = await import(pathToFileURL(path.join(R, 'config.js')).href);
const T = await import(pathToFileURL(path.join(R, 'timeline.js')).href);

const S = E.build({ ...C.PARAMS });
const fail = m => { console.error('FAIL', m); process.exit(1); };
if (!S.ok) fail('엔진 ' + S.reason);
// S.everHit 는 격파 뒤 가상 구간까지 포함한 값이다(격파 뒤 탄은 제거돼 화면에 없음). 격파 전 피격은 엔진이 ok=false 로 거르고, 아래 연속 측정이 다시 잰다.
if (S.peak !== C.EXPECT.peak) fail(`peak ${S.peak}`);
if (S.BOSS_HP !== C.EXPECT.bossHP) fail(`hp ${S.BOSS_HP}`);
if (Math.abs(S.tDie - C.EXPECT.tDie) > 1e-6) fail(`tDie ${S.tDie}`);

// 연속 판정 1/960s
const STEP = 1 / 960, arr = S.bullets, L = S.C.LIFE;
let lo = 0, hi = 0, m = 1e9, mt = 0, mq = null;
for (let t = 0; t <= S.tDie; t += STEP) {
  while (hi < arr.length && arr[hi].t0 <= t) hi++;
  while (lo < hi && arr[lo].t0 <= t - L) lo++;
  const p = S.player(t);
  for (let i = lo; i < hi; i++) {
    const b = arr[i]; if (t >= b.tEnd) continue;
    const q = E.bpos(b, t); if (!q) continue;
    const dy = q.y - p.y; if (dy > 80 || dy < -80) continue;
    const d = Math.hypot(q.x - p.x, dy);
    if (d < m) { m = d; mt = t; mq = i; }
  }
}
if (m < S.C.R_HIT) fail(`연속 최소 ${m.toFixed(3)} < ${S.C.R_HIT}`);
if (Math.abs(m - C.EXPECT.contMinPx) > 0.01) fail(`연속 최소 ${m.toFixed(3)} ≠ 계약 ${C.EXPECT.contMinPx}`);

const map = T.makeMap(S.tDie);
const dens = []; let hudMax = 0;
for (let V = 0; V < C.TOTAL_F; V++) { const n = E.densityAt(S, T.hudTick(map.toGame(V), S.tBomb)); dens.push(n); if (n > hudMax) hudMax = n; }
if (hudMax !== S.peak) fail(`화면 최대 ${hudMax} ≠ peak ${S.peak}`);
const grazes = S.GRZ_EVT.filter(g => g[0] <= S.tDie).map(g => g[0]);
const preBomb = grazes.filter(t => t < S.tBomb).map(t => +map.toV(t).toFixed(2));

const meta = {
  params: C.PARAMS, peak: S.peak, hudMax, hp: S.BOSS_HP, tBomb: S.tBomb, tDie: S.tDie, g0: +map.g0.toFixed(5),
  hitBeforeKill: false, rHit: S.C.R_HIT, contMinPx: +m.toFixed(3), marginPx: +(m - S.C.R_HIT).toFixed(2), contMinAt: +mt.toFixed(4), contMinV: +map.toV(mt).toFixed(2),
  grazeTotal: grazes.length, grazePreBombV: preBomb, cleared: S.bombCleared, spellBreak: S.spellBreak,
  item: S.item, itemV: +map.toV(S.item.t0).toFixed(2), slowV: T.VF.slow, bombV: T.VF.bomb, killV: T.VF.kill, outroV: T.VF.outro,
  hits: S.impacts.filter(t => t <= S.tDie).map(t => +map.toV(t).toFixed(2)),
  milestones: Object.fromEntries([1000, 2000, 3000].map(th => [th, dens.findIndex(n => n >= th)])),
  totalF: C.TOTAL_F, barF: C.BAR_F, bpm: C.BPM,
};
fs.mkdirSync(path.join(R, 'data'), { recursive: true });
fs.writeFileSync(path.join(R, 'data/meta.json'), JSON.stringify(meta, null, 1));
const { hits, ...rest } = meta;
console.log(JSON.stringify(rest, null, 0));
console.log('hits', hits.length, 'HUD최대', hudMax, 'peak', S.peak);
