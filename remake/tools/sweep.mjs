// 조합 탐색 — 엔진 무수정. 틱(1/30초) 판정 무피격 + 틱 사이(1/240초 표본)까지 판정 반경 밖인 조합을 센다.
// 근거: 옛 값 D=3.4 seed=8 은 틱에서만 통과(틱 사이 최소 6.79px < 판정 12px). verify.mjs 가 이 반례를 다시 잰다.
// 사용: node sweep.mjs --part i/n [--seeds 1:200] [--d 3.0,3.1,...] [--thin 0] [--span 5.3333] → out/sweep_<i>.jsonl
//       node sweep.mjs --summary
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(path.resolve(HERE, '../../danmaku_engine.js')).href);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const outDir = path.join(HERE, 'out', 'final');
fs.mkdirSync(outDir, { recursive: true });

if (process.argv.includes('--summary')) {
  const rows = fs.readdirSync(outDir).filter(f => f.startsWith('sweep_')).flatMap(f => fs.readFileSync(path.join(outDir, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const tick = rows.filter(r => r.ok), cont = tick.filter(r => r.contMin >= r.rHit), big = cont.filter(r => r.peak >= 3000);
  const mine = rows.find(r => r.D === 3.8 && r.seed === 93);
  const s = { combos: rows.length, tickNoHit: tick.length, contNoHit: cont.length, contNoHitPeak3000: big.length, chosen: mine };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(s, null, 1));
  console.log(JSON.stringify(s));
  process.exit(0);
}

const [pi, pn] = arg('--part', '0/1').split('/').map(Number);
const [s0, s1] = arg('--seeds', '1:200').split(':').map(Number);
const DS = arg('--d', '3.0,3.1,3.2,3.3,3.4,3.5,3.6,3.7,3.8').split(',').map(Number);
const THIN = +arg('--thin', 0), SPAN = +arg('--span', 5.3333), T_BOMB = 6.8667, STEP = 1 / 240;
const out = path.join(outDir, `sweep_${pi}.jsonl`);
fs.writeFileSync(out, '');

function contMin(S, t1) {
  const arr = S.bullets, L = S.C.LIFE; let m = Infinity, mt = 0, lo = 0, hi = 0;
  for (let t = 0; t <= t1; t += STEP) {
    while (hi < arr.length && arr[hi].t0 <= t) hi++;
    while (lo < hi && arr[lo].t0 <= t - L) lo++;
    const p = S.player(t);
    for (let i = lo; i < hi; i++) {
      const b = arr[i]; if (t >= b.tEnd) continue;
      const q = E.bpos(b, t); if (!q) continue;
      const dy = q.y - p.y; if (dy > 80 || dy < -80) continue;
      const d = Math.hypot(q.x - p.x, dy);
      if (d < m) { m = d; mt = t; }
    }
  }
  return { m, mt };
}

let k = 0;
for (const D of DS) for (let seed = s0; seed <= s1; seed++) {
  if ((k++) % pn !== pi) continue;
  const S = E.build({ D, seed, T_BOMB, BOSS_THIN: THIN, CLEAR_TAIL: 1.1, TARGET_DIE: T_BOMB + SPAN });
  const row = { D, seed, ok: !!S.ok, reason: S.reason || null, peak: S.peak, rHit: S.C.R_HIT };
  if (S.ok) { const c = contMin(S, S.tDie); Object.assign(row, { hp: S.BOSS_HP, tDie: S.tDie, contMin: +c.m.toFixed(2), contAt: +c.mt.toFixed(4) }); }
  fs.appendFileSync(out, JSON.stringify(row) + '\n');
}
