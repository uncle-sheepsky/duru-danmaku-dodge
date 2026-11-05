// 시간표 — 영상 프레임 V ↔ 게임 시각 t, 두루 칸 선택. 전부 순수 함수.
import { BAR_F, BAR, GAME_SLOW_FROM, GAME_SLOW_TO, FPS, PARAMS } from './config.js';

export const VF = {
  hookEnd: BAR.hookEnd * BAR_F,
  slow: BAR.slow * BAR_F,
  bomb: BAR.bomb * BAR_F,
  kill: BAR.kill * BAR_F,
  outro: BAR.outro * BAR_F,
  end: BAR.end * BAR_F,
};

/** 화면 탄 수는 엔진 틱에서 센 값만 보여 준다(틱 사이 값 3,494 같은 peak 밖 숫자 방지). */
export const hudTick = (t, tBomb) => { const k = Math.floor(t * FPS + 1e-6) / FPS; return (t >= tBomb && k < tBomb) ? t : k; };

export function makeMap(tDie) {
  const tBomb = PARAMS.T_BOMB;
  const g0 = GAME_SLOW_FROM - VF.slow / FPS;
  // 저속 끝 = 봄 앞 마지막 영상 프레임(peak 틱이 화면에 찍히게)
  const knots = [
    [0, g0],
    [VF.slow, GAME_SLOW_FROM],
    [Math.ceil(VF.bomb) - 1, GAME_SLOW_TO],
    [VF.bomb, tBomb],
    [VF.kill, tDie],
  ];
  const toGame = V => {
    if (V >= VF.kill) return tDie + (V - VF.kill) / FPS;
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ga] = knots[i], [b, gb] = knots[i + 1];
      if (V <= b) return ga + (gb - ga) * (V - a) / (b - a);
    }
    return tDie;
  };
  const toV = t => {
    if (t >= tDie) return VF.kill + (t - tDie) * FPS;
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ga] = knots[i], [b, gb] = knots[i + 1];
      if (t <= gb) return a + (b - a) * (t - ga) / (gb - ga);
    }
    return VF.kill;
  };
  return { g0, toGame, toV, knots };
}

/** 조종석 칸 표: 프레임마다 [동작, cel] 한 번만 계산해 둔다(히스테리시스 = 순서 의존이라 표로 굳힘). */
export function cockpitTable(S, map, totalF) {
  const out = new Array(totalF);
  const grazeV = S.GRZ_EVT.filter(g => g[0] <= S.tDie && g[0] < S.tBomb).map(g => map.toV(g[0]));
  const BEAT = BAR_F / 4;
  let lean = 'C', leanSince = 0, grazeAt = -1e9;
  const G_DUR = [2, 3, 5, 4, 5]; // graze 칸 길이
  const GT = G_DUR.reduce((a, b) => a + b, 0);
  let gi = 0;
  for (let V = 0; V < totalF; V++) {
    let a, c;
    while (gi < grazeV.length && grazeV[gi] <= V) { if (V - grazeAt > 4) grazeAt = V; gi++; }
    if (V < VF.hookEnd) {
      a = 'stick_idle'; c = 1 + Math.floor(V / BEAT) % 6;
    } else if (V < VF.slow) {
      // 탄 회피: 기체 이동 방향 그대로 몸 쏠림
      const t = map.toGame(V), dx = S.player(t + 1 / FPS).x - S.player(t).x;
      const want = dx > 6 ? 'R' : dx < -6 ? 'L' : 'C';
      if (want !== lean && V - leanSince >= 5) { lean = want; leanSince = V; }
      const held = V - leanSince;
      if (lean === 'L') { a = 'stick_lean'; c = held < 5 ? 2 : 3; }
      else if (lean === 'R') { a = 'stick_lean'; c = held < 5 ? 5 : 6; }
      else { a = 'stick_lean'; c = Math.floor(V / (BEAT * 2)) % 2 ? 4 : 1; }
      const since = V - grazeAt;
      if (since >= 0 && since < GT) {
        let k = since, n = 0; while (k >= G_DUR[n]) { k -= G_DUR[n]; n++; }
        a = 'stick_graze'; c = n + 1;
      }
    } else if (V < VF.bomb) {
      // 저속 마디: 놀람 → 움찔 → 봄 준비
      const k = (V - VF.slow) / (VF.bomb - VF.slow);
      if (k < 0.4) { a = 'stick_graze'; c = 1; }
      else if (k < 0.78) { a = 'stick_graze'; c = 2; }
      else if (k < 0.9) { a = 'stick_graze'; c = 3; }
      else { a = 'stick_bomb'; c = 2; }
    } else if (V < VF.kill) {
      const k = V - VF.bomb;
      if (k < 6) { a = 'stick_bomb'; c = 3; }
      else if (k < 15) { a = 'stick_bomb'; c = 4; }
      else if (k < 24) { a = 'stick_bomb'; c = 5; }
      else if (k < 32) { a = 'stick_bomb'; c = 6; }
      else { a = 'stick_mash'; c = 1 + Math.floor((V - VF.bomb) / (BEAT / 2)) % 4; }
    } else if (V < VF.outro) {
      a = 'stick_bomb'; c = (V - VF.kill) < 17 ? 4 : 5;
    } else {
      const k = V - VF.outro;
      if (k < 6) { a = 'stick_down'; c = 1; }
      else if (k < 14) { a = 'stick_down'; c = 2; }
      else if (k < 24) { a = 'stick_down'; c = 3; }
      else if (k < 36) { a = 'stick_down'; c = 4; }
      else if (k < 48) { a = 'stick_down'; c = 5; }
      else { a = 'stick_down'; c = 6; }
    }
    out[V] = `${a}_cel${String(c).padStart(2, '0')}`;
  }
  return out;
}

/** 기체 표정 칸. */
export function shipTable(S, map, totalF) {
  const out = new Array(totalF);
  const grazeV = S.GRZ_EVT.filter(g => g[0] <= S.tDie && g[0] < S.tBomb).map(g => map.toV(g[0]));
  for (let V = 0; V < totalF; V++) {
    let c = V < VF.hookEnd ? (Math.floor(V / 30) % 4 === 3 ? 2 : 1) : 4;
    if (V >= VF.slow && V < VF.bomb) c = 3;
    else if (V < VF.slow && grazeV.some(g => V >= g && V < g + 7)) c = 3;
    if (V >= VF.kill) c = 1;
    out[V] = `ship_cel${String(c).padStart(2, '0')}`;
  }
  return out;
}
