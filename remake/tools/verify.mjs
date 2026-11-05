// 검증 8종 — 영상의 숫자가 정말 엔진에서 나오는지 다시 잰다. 실패하면 exit 1.
// 사용: node remake/tools/verify.mjs
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(HERE, '..');
const E = await import(pathToFileURL(path.resolve(R, '../danmaku_engine.js')).href);
const C = await import(pathToFileURL(path.join(R, 'config.js')).href);
const T = await import(pathToFileURL(path.join(R, 'timeline.js')).href);

let fails = 0;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${info}`); if (!ok) fails++; };

function digest(S) {
  const h = createHash('sha256');
  for (const b of S.bullets) h.update(`${b.t0},${b.ox},${b.oy},${b.vx},${b.vy},${b.tEnd},${b.omega},${b.ang0},${b.s};`);
  for (const k of S.PKF) h.update(k.join(',') + ';');
  return h.digest('hex');
}

/** 판정점과 탄 중심의 최소 거리. step = 재는 간격(초). */
function minDist(S, step, t1) {
  const arr = S.bullets, L = S.C.LIFE;
  let lo = 0, hi = 0, m = Infinity, mt = 0;
  for (let t = 0; t <= t1 + 1e-9; t += step) {
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

const S = E.build({ ...C.PARAMS });
const S2 = E.build({ ...C.PARAMS });

// 1 같은 입력 = 같은 탄·같은 경로
check('V1 결정론', digest(S) === digest(S2), digest(S).slice(0, 16));

// 2 시간을 거꾸로 짚어도 같은 값
const ts = [...Array(40).keys()].map(i => i * 0.3);
const fw = ts.map(t => { const p = S.player(t); const b = S.bullets[1000]; return [p.x, E.bpos(b, t)?.x]; });
const bw = ts.slice().reverse().map(t => { const p = S.player(t); const b = S.bullets[1000]; return [p.x, E.bpos(b, t)?.x]; }).reverse();
check('V2 시크 왕복', JSON.stringify(fw) === JSON.stringify(bw), `${ts.length}지점`);

// 3 화면 위 최대 탄 수
check('V3 peak', S.ok && S.peak === C.EXPECT.peak, `${S.peak}발`);

// 4 격파 전 1/30초 틱 무피격
const tick = minDist(S, 1 / C.FPS, S.tDie);
check('V4 틱 판정 무피격', tick.m >= S.C.R_HIT, `틱 최소 ${tick.m.toFixed(2)}px ≥ 판정 ${S.C.R_HIT}px`);

// 5 틱 사이까지 무피격(저속 장면에서 보이는 값)
const cont = minDist(S, 1 / 960, S.tDie);
check('V5 연속 판정 무피격', cont.m >= S.C.R_HIT && Math.abs(cont.m - C.EXPECT.contMinPx) < 0.01, `최소 ${cont.m.toFixed(3)}px · 여유 ${(cont.m - S.C.R_HIT).toFixed(2)}px · t=${cont.mt.toFixed(4)}s`);

// 6 반례: 옛 값은 틱에서만 통과한다(이 검사가 왜 필요한지의 증거)
const O = E.build({ D: 3.4, seed: 8, T_BOMB: 6.8667, BOSS_THIN: 1, CLEAR_TAIL: 1.1, BOSS_HP: 110 });
const ot = minDist(O, 1 / C.FPS, O.tDie), oc = minDist(O, 1 / 960, O.tDie);
check('V6 옛 값 반례', ot.m >= O.C.R_HIT && oc.m < O.C.R_HIT, `틱 ${ot.m.toFixed(2)}px 통과 · 틱 사이 ${oc.m.toFixed(2)}px < ${O.C.R_HIT}px`);

// 7 격파 = 실제 명중 누적
const hits = S.impacts.filter(t => t <= S.tDie).length;
check('V7 격파', S.BOSS_HP === C.EXPECT.bossHP && hits === S.BOSS_HP && Math.abs(S.tDie - C.EXPECT.tDie) < 1e-6, `명중 ${hits}번째 · t=${S.tDie}s`);

// 8 화면 시간표: 봄 앞 마지막 프레임 = peak · 봄 프레임 = 0 · 16.000초 = 12마디
const map = T.makeMap(S.tDie);
const V0 = Math.ceil(T.VF.bomb) - 1;
const nPre = E.densityAt(S, T.hudTick(map.toGame(V0), S.tBomb)), nBomb = E.densityAt(S, T.hudTick(map.toGame(Math.ceil(T.VF.bomb)), S.tBomb));
check('V8 화면 시간표', nPre === S.peak && nBomb === 0 && C.TOTAL_F === C.BARS * C.BAR_F && C.TOTAL_F / C.FPS === 16, `V${V0}=${nPre}발 · V${V0 + 1}=${nBomb}발 · ${C.BARS}마디 ${C.TOTAL_F}f`);

console.log(fails ? `\n실패 ${fails}개` : '\n8/8 통과');
process.exit(fails ? 1 : 0);
