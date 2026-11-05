/* ep7 DANMAKU DODGE — 엔진 (렌더 무결합 ESM 모듈)
   duru ep37 buildTimeline.js 이식 + hyak 개작 3건:
     (A) 창발 피격  — 충돌 판정·목숨 신설. 밀도 램프는 authored, 피격 발생/시각은 시뮬 결과.
                      첫 피격이 봄(화면소거)을 촉발 = 인과 역전(원본은 고정 __BOMBS 시각표).
     (B) 실사격     — killAt 역산 발사 폐기. 보스 HP = 실제 명중 누적. tDie = 창발값.
     (C) 슬라이딩 윈도 — 탄 수명 LIFE 고정 → t0 정렬 후 활성 구간만 스캔(억→천만 연산).

   결정론: Date/Math.random/rAF 없음. 시드 PRNG(mulberry32) 초기화 1회.
   탄환 위치 bpos(b,t) = 닫힌형(직선 / 등각속도 호). 해석적 모션블러 가능(bake 불요).

   authored(연출) = 밀도 램프 곡선 · BOSS_HP 상수 · 시드 선택 · 포탑 배치.
   실계산        = 탄 궤적 · 회피 경로 · 충돌 판정 · 보스 HP 감소 · t_hit · tDie.
*/

export const DEFAULTS = {
  W: 1080, H: 1920, FPS: 30,
  DODGE_Y: 1566,        // 720×1280의 1044 → ×1.5. 세이프존 하한 1600 이내
  PMARGIN: 84, LANES: 46, STEP: 33,   // 그리디 회피: 레인 수·프레임당 최대 이동
  DANGER: 69,           // 위험 반발 반경(회피 판단용) — 실제 히트박스와 무관
  LOOK: [0, 0.08, 0.16],// 룩어헤드 샘플(저속 탄에 맞춰 창 확대)
  LIFE: 9.0,            // 탄 수명(초). ★저속·고밀도 설계: 탄이 화면에 오래 남아야 "벽"이 된다.
                        // 커튼 250px/s가 y=-30 → 1950 통과에 ≈7.9s. 화면 동시 탄수 ∝ 발사율 × 체류시간.
  DANGER_BAND: 250,     // 위협 밀도 = |y - DODGE_Y| < 이 값 안의 탄 수(시청자가 지각하는 위협)
  R_HIT: 12,            // ★실제 히트박스(장르 관습: 극소 판정점): 탄 중심 ~ 플레이어 중심 거리
  D: 1.0,               // ★밀도 스케일(스윕 축)
  seed: 1,              // ★시드(스윕 축)
  T_RUSH_MAX: 12.0,     // 개막 barrage 생성 상한(초)
  BOSS_DELAY: 1.0,      // (미사용·호환 유지) 구 피격→보스 지연
  BOSS_HP: null,        // null = TARGET_DIE에 가장 가까운 명중을 골라 HP 결정(authored 선택, 고지)
  TARGET_DIE: null,     // 목표 격파 시각(초). null이면 BOSS_HP 상수 사용
  // ★봄 = 아이템 습득 인센티브(피격 트리거 폐기). T_BOMB(다운비트)에 습득→화면소거.
  T_BOMB: null,         // 봄 아이템 습득/발동 시각(초, 로컬). null이면 개막 barrage만.
  ITEM_LEAD: 1.20,      // 아이템 등장 = 습득 ITEM_LEAD초 전(수집 이동이 보이게)
  ITEM_R: 46,           // 습득 판정 반경(체리가 아이템 칸 도달)
  ITEM_PULL: 240,       // 아이템 습득창에서 회피 점수에 더할 유인(가장 안전칸 대신 수집 이동 유도)
  BOSS_THIN: 0,         // 봄후 보스 패턴 완화(0=원밀도, 1=완화 — 무피격 위해 후반 회피성 확보)
  PSHOT_S: 2400,        // 아군 탄속(px/s)
  FIRE_DT: 0.10,        // 아군 발사 주기(초)
  BOSS_CAP: 16.0,       // 보스 패턴 생성 상한(초)
  CLEAR_TAIL: 1.2,      // 격파 후 여운
  LIVES: 3,
};

const TAU = Math.PI * 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 탄환 위치 = 닫힌형 순수함수. 직선 or 등각속도 호. 살아있지 않으면 null. */
export function bpos(b, t) {
  const dt = t - b.t0;
  if (dt < 0 || t >= b.tEnd) return null;
  if (b.omega) {
    const a = b.ang0 + b.omega * dt;
    return { x: b.ox + (b.s / b.omega) * (Math.sin(a) - Math.sin(b.ang0)),
             y: b.oy - (b.s / b.omega) * (Math.cos(a) - Math.cos(b.ang0)) };
  }
  return { x: b.ox + b.vx * dt, y: b.oy + b.vy * dt };
}

/** t0 정렬 배열에서 시각 t에 활성일 수 있는 구간 [lo,hi) 를 이분탐색. (C) 슬라이딩 윈도 */
function activeRange(sorted, t, LIFE) {
  // t0 <= t 인 마지막 +1 = hi ; t0 > t-LIFE 인 첫 = lo
  let lo = 0, hi = sorted.length;
  { let a = 0, b = sorted.length;
    while (a < b) { const m = (a + b) >> 1; if (sorted[m].t0 <= t) a = m + 1; else b = m; }
    hi = a; }
  { let a = 0, b = hi;
    while (a < b) { const m = (a + b) >> 1; if (sorted[m].t0 <= t - LIFE) a = m + 1; else b = m; }
    lo = a; }
  return [lo, hi];
}

export function build(P = {}) {
  const C = { ...DEFAULTS, ...P };
  const { W, H, FPS, DODGE_Y, LIFE, R_HIT, D } = C;
  const rnd = mulberry32(C.seed);
  const dt = 1 / FPS;

  // ★봄 = 아이템 습득(피격 트리거 폐기). 개막 barrage는 T_BOMB까지만(봄에 소거·후퇴), 봄후 = 보스패턴만.
  const T_BOMB = C.T_BOMB;
  const barrageEnd = (T_BOMB !== null && T_BOMB !== undefined) ? T_BOMB : C.T_RUSH_MAX;

  const bullets = [];   // 적탄
  const pshots = [];    // 아군탄
  const events = [];    // 서사 이벤트(피격·봄·격파…)
  const PAL = ['#ff5d7a', '#7fd0ff', '#ffe86b', '#ff9d4d', '#b98cff', '#46e08a'];

  const badd = (t0, ox, oy, vx, vy, color, omega, ang0, s) =>
    bullets.push({ t0, ox, oy, vx, vy, tEnd: t0 + LIFE, color, omega: omega || 0, ang0: ang0 || 0, s: s || 0 });
  const ring = (t, ox, oy, N, sp, ph, c) => { for (let i = 0; i < N; i++) { const a = TAU * i / N + ph; badd(t, ox, oy, sp * Math.cos(a), sp * Math.sin(a), c); } };
  const spread = (t, ox, oy, aim, N, arc, sp, c) => { for (let i = 0; i < N; i++) { const a = aim - arc / 2 + arc * (N <= 1 ? 0.5 : i / (N - 1)); badd(t, ox, oy, sp * Math.cos(a), sp * Math.sin(a), c); } };
  const curvering = (t, ox, oy, N, sp, om, c) => { for (let i = 0; i < N; i++) badd(t, ox, oy, 0, 0, c, om, TAU * i / N, sp); };
  /** ★커튼: 화면 상단 밖에서 균일 간격 낙하. 링은 밀도 ∝ 1/r 이라 플레이어 라인이 비지만,
      커튼은 거리와 무관하게 밀도를 유지한다 = 실제 위협·시각적 벽. 지그재그 위상으로 틈을 만든다. */
  let cSeq = 0;
  const curtain = (t, N, sp, c) => {
    const k = cSeq++;
    for (let i = 0; i < N; i++) {
      const jit = rnd() * 0.7 - 0.35;                          // 결정론 지터(시드 PRNG)
      const x = (W + 120) * ((i + 0.5) / N) - 60 + jit * (W / N);
      const ang = Math.PI / 2 + 0.16 * Math.sin(k * 0.9 + i * 0.55);   // 완만한 사인 편향 = 틈이 흐른다
      badd(t, x, -30, sp * Math.cos(ang), sp * Math.sin(ang), c);
    }
  };

  // ── 베이스 위빙: 적 aimed는 이 궤적을 조준(회피 경로는 아직 미정 = 순환 참조 회피).
  //    authored: 적의 조준 대상이 "위빙 베이스라인"이라는 점. 회피 성패는 밀도가 결정한다.
  const basePlayer = t => ({ x: W / 2 + 300 * Math.sin(TAU * 0.32 * t) + 82 * Math.sin(TAU * 0.13 * t + 1), y: DODGE_Y });
  const aimed = (t, ox, oy, sp, c) => { const p = basePlayer(t); const a = Math.atan2(p.y - oy, p.x - ox); badd(t, ox, oy, sp * Math.cos(a), sp * Math.sin(a), c); };

  // ═══ RUSH: 5기 포탑, 밀도 램프(authored) ═══
  // 발사 주기 ↓, 링 발수 ↑. D가 전체 강도를 스케일.
  const turrets = [];
  for (let i = 0; i < 5; i++) turrets.push({ x: 180 + i * (W - 360) / 4, y: 315 + (i % 2) * 111, c: PAL[i % PAL.length], ph: rnd() * TAU });

  const period = t => Math.max(0.13, 0.60 - 0.036 * t * D);     // 포탑 발사 간격(초)
  const ringN = t => Math.round(8 + 1.05 * t * D);              // 링 발수(상단 개화)
  const speed = t => 205 + 5.5 * t * D;                          // 탄속(px/s) — 저속 = 체류 ↑ = 벽

  for (let i = 0; i < turrets.length; i++) {
    const tu = turrets[i];
    let t = 0.15 + i * 0.09;
    while (t < barrageEnd) {
      const sp = speed(t);
      if (i % 3 === 0) { ring(t, tu.x, tu.y, ringN(t), sp, tu.ph + 0.37 * t, tu.c); }
      else if (i % 3 === 1) { spread(t, tu.x, tu.y, Math.PI / 2, Math.max(3, (ringN(t) / 2) | 0), 1.15, sp * 1.05, tu.c); }
      else { aimed(t, tu.x, tu.y, sp * 1.18, tu.c); if (t > 3) curvering(t, tu.x, tu.y, Math.max(6, (ringN(t) * 0.7) | 0), sp * 0.85, 1.55, tu.c); }
      t += period(t);
    }
  }
  // ★커튼 램프: 플레이어 라인의 실제 위협. 간격 ↓, 발수 ↑.
  const cPeriod = t => Math.max(0.11, 0.50 - 0.031 * t * D);
  const cN = t => Math.round(8 + 1.15 * t * D);
  for (let t = 0.4, k = 0; t < barrageEnd; t += cPeriod(t), k++)
    curtain(t, cN(t), 240 + 8 * t * D, PAL[k % PAL.length]);
  bullets.sort((a, b) => a.t0 - b.t0);

  // ═══ 회피 시뮬 + 충돌 판정 (프레임 루프, 슬라이딩 윈도) ═══
  const homeOf = t => W / 2 + 248 * Math.sin(TAU * 0.21 * t) + 68 * Math.sin(TAU * 0.083 * t + 1);
  const PKF = [];              // [t, x, y] 회피 경로 키프레임
  const GRZ_KEY = [[0, 0]];    // 그레이즈 누적(카운트)
  const GRZ_EVT = [];          // [t, gx, gy] 스침 위치(시각화 — 아슬아슬함 증거)
  const grazed = new Set();
  let px = homeOf(0), graze = 0, peak = 0, peakDanger = 0, minClear = Infinity;
  let tHit = null;

  function dodgeStep(t, arr, itemX) {
    const [lo, hi] = activeRange(arr, t, LIFE);
    const near = [];
    for (let i = lo; i < hi; i++) {
      const b = arr[i];
      for (const la of C.LOOK) { const p = bpos(b, t + la); if (p && Math.abs(p.y - DODGE_Y) < 200) near.push(p); }
    }
    const home = homeOf(t);
    let bestX = px, bestS = -Infinity;
    for (let c = 0; c < C.LANES; c++) {
      const cx = C.PMARGIN + c * (W - 2 * C.PMARGIN) / (C.LANES - 1);
      let mind = Infinity;
      for (const p of near) { const d = Math.hypot(p.x - cx, p.y - DODGE_Y); if (d < mind) mind = d; }
      const danger = mind < C.DANGER ? (C.DANGER - mind) * 12 : 0;
      // ★아이템 습득창: 안전을 지키되 아이템 칸으로 유인(수집 이동이 보이게). 위험칸엔 유인 안 감(무피격 우선).
      const pull = (itemX !== undefined && itemX !== null && mind > C.DANGER)
        ? C.ITEM_PULL * (1 - Math.min(1, Math.abs(cx - itemX) / (W * 0.5))) : 0;
      const s = -danger + Math.min(mind, 180) - Math.abs(cx - home) * 0.14 - Math.abs(cx - px) * 0.12 + pull;
      if (s > bestS) { bestS = s; bestX = cx; }
    }
    px += Math.max(-C.STEP, Math.min(C.STEP, bestX - px));
    PKF.push([+t.toFixed(4), +px.toFixed(2), DODGE_Y]);
  }

  /** 프레임 t에서 실제 충돌 여부 + 밀도/그레이즈/최소거리 갱신 */
  function scanHit(t, arr) {
    const [lo, hi] = activeRange(arr, t, LIFE);
    let n = 0, nd = 0, hit = false;
    for (let i = lo; i < hi; i++) {
      const b = arr[i], p = bpos(b, t);
      if (!p) continue;
      const onScreen = p.x > -30 && p.x < W + 30 && p.y > -30 && p.y < H + 30;
      if (onScreen) { n++; if (Math.abs(p.y - DODGE_Y) < C.DANGER_BAND) nd++; }
      const d = Math.hypot(p.x - px, p.y - DODGE_Y);
      if (d < minClear) minClear = d;
      if (d < R_HIT) hit = true;
      if (d < 70 && !grazed.has(b)) {           // 그레이즈 = 판정점 근접(70px). 위치 수집 = 스침 스파크
        grazed.add(b); graze++;
        GRZ_EVT.push([+t.toFixed(4), +p.x.toFixed(1), +p.y.toFixed(1)]);
      }
    }
    if (n > peak) peak = n;
    if (nd > peakDanger) peakDanger = nd;    // ★시청자가 지각하는 위협(플레이어 라인 ±250px)
    return hit;
  }

  // ═══ 멜론(보스) 상주: t=0부터 화면에. 개막 barrage(위 포탑·커튼) = 멜론이 뿌리는 탄막 ═══
  const tBoss = 0;
  const bossPos = t => ({ x: W / 2 + 275 * Math.sin(TAU * 0.23 * t), y: 520 });
  const BR = 92;   // 보스 히트 반경

  // ═══ 봄 = 아이템 습득(피격 트리거 폐기). T_BOMB(다운비트)에 습득 → 화면소거 ═══
  if (T_BOMB === null || T_BOMB === undefined)
    return { ok: false, reason: 'no-bomb-time', C, peak, peakDanger, minClear, graze, bulletsTotal: bullets.length };
  const ITEM_T0 = +(T_BOMB - C.ITEM_LEAD).toFixed(4);            // 아이템 등장(습득 ITEM_LEAD초 전)
  const item = { t0: ITEM_T0, tGot: T_BOMB, x: W / 2, y: DODGE_Y };  // x는 회피 후 체리 봄시점 위치로 확정

  // ── 봄 이후 = 멜론 직접 패턴(발광) 국면(개막은 커튼 barrage). 봄 전엔 멜론 패턴 없음(무피격 여지). ──
  {
    const bring = (t, N, sp, ph, c) => { const o = bossPos(t); for (let i = 0; i < N; i++) { const a = TAU * i / N + ph; badd(t, o.x, o.y, sp * Math.cos(a), sp * Math.sin(a), c); } };
    const bcurve = (t, N, sp, om, c) => { const o = bossPos(t); for (let i = 0; i < N; i++) badd(t, o.x, o.y, 0, 0, c, om, TAU * i / N, sp); };
    // 봄후 = 멜론 발광이되 회피 가능(무피격 목표). HP 감소분에 비례해 완화(BOSS_THIN).
    const thin = C.BOSS_THIN;   // 0=원밀도, 1=최대완화
    for (let k = 0; ; k++) {
      const t = T_BOMB + 0.30 + (0.105 + 0.05 * thin) * k;
      if (t >= T_BOMB + C.BOSS_CAP) break;
      const sa = 0.34 * (k + 1);
      const o = bossPos(t);
      const arms = 4 - Math.round(thin);                       // 4→3
      for (let arm = 0; arm < arms; arm++) badd(t, o.x, o.y, 250 * Math.cos(sa + arm * TAU / arms), 250 * Math.sin(sa + arm * TAU / arms), '#ff9d4d');
      if (k % (5 + 2 * Math.round(thin)) === 0) bcurve(t, 18 - 6 * Math.round(thin), 215, 1.6, '#b98cff');
      if (k % 3 === 0) bring(t, 3, 340, sa, '#ff5d7a');
      if (k % (4 + 3 * Math.round(thin)) === 0) curtain(t, 8 - 2 * Math.round(thin), 255, '#7fd0ff');
    }
  }
  bullets.sort((a, b) => a.t0 - b.t0);

  // ═══ 연속 회피(무피격) + 아이템 습득 봄 + ★반격은 처음부터(멜론 상시 피격, HP로 격파 타이밍 조율) ═══
  let nextFire = 0.15;
  const hitTimes = [];
  const T_CAP = T_BOMB + C.BOSS_CAP;
  let bombed = false, cleared = 0, everHit = false, firstHit = null;

  for (let f = 0; ; f++) {
    const t = f * dt;
    if (t > T_CAP) break;
    // 봄 발동(아이템 습득 = T_BOMB): 살아있는 개막 탄 전부 소거(화면소거). 봄 이후 멜론 패턴은 유지.
    if (!bombed && t >= T_BOMB) {
      bombed = true;
      events.push({ t: item.t0, type: 'ITEM', x: item.x, y: item.y });
      events.push({ t: T_BOMB, type: 'BOMB' });
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (b.t0 > T_BOMB) continue;
        if (b.tEnd > T_BOMB) { b.tEnd = T_BOMB; cleared++; }
      }
    }
    // 회피 = 순수(다이버전 없음). 아이템은 체리의 봄시점 실제 위치에 배치(수집 일치, 후처리).
    dodgeStep(t, bullets);
    if (scanHit(t, bullets)) { if (!everHit) { everHit = true; firstHit = +t.toFixed(4); } hitTimes.push(+t.toFixed(4)); }
    if (graze !== GRZ_KEY[GRZ_KEY.length - 1][1]) GRZ_KEY.push([+t.toFixed(4), graze]);

    // (B) 반격 실사격 = ★S5 처음부터 상시(멜론을 계속 공격 = 난이도 체감). 요격 예측(lead).
    {
      while (nextFire <= t) {
        const ox = px, oy = DODGE_Y - 30;
        let s = Math.hypot(bossPos(nextFire).x - ox, bossPos(nextFire).y - oy) / C.PSHOT_S;
        for (let k = 0; k < 4; k++) { const o = bossPos(nextFire + s); s = Math.hypot(o.x - ox, o.y - oy) / C.PSHOT_S; }
        const aimPt = bossPos(nextFire + s);
        const a = Math.atan2(aimPt.y - oy, aimPt.x - ox);
        const sh = { t0: nextFire, ox, oy, vx: Math.cos(a) * C.PSHOT_S, vy: Math.sin(a) * C.PSHOT_S };
        let tImp = null;
        for (let u = 0; u <= 0.5; u += 1 / 240) {
          const bp = bossPos(nextFire + u);
          const sx = sh.ox + sh.vx * u, sy = sh.oy + sh.vy * u;
          if (Math.hypot(sx - bp.x, sy - bp.y) < BR) { tImp = +(nextFire + u).toFixed(4); break; }
          if (sy < -40) break;
        }
        sh.life = tImp !== null ? tImp - nextFire : 0.5;
        sh.impact = tImp;
        pshots.push(sh);
        nextFire += C.FIRE_DT;
      }
    }
  }

  // ★아이템 = 체리의 봄시점 실제 위치에 배치(수집 = 회피 경로와 일치, 창작 없음)
  item.x = +interp3(PKF, T_BOMB).x.toFixed(2);

  // ── HP 결정: 명중 시각에서 TARGET_DIE 최근접(authored 고지 = "몇 번째 명중에 격파") ──
  const impacts = pshots.filter(p => p.impact !== null).map(p => p.impact).sort((a, b) => a - b);
  let HP;
  if (C.TARGET_DIE !== null && C.TARGET_DIE !== undefined) {
    if (!impacts.length) return { ok: false, reason: 'no-impact', C, peak, minClear, graze, bulletsTotal: bullets.length };
    let best = 0, bd = Infinity;
    impacts.forEach((ti, i) => { const d = Math.abs(ti - C.TARGET_DIE); if (d < bd) { bd = d; best = i; } });
    HP = best + 1;
  } else HP = C.BOSS_HP;
  if (!HP || impacts.length < HP) {
    return { ok: false, reason: 'boss-survived', C, peak, peakDanger, minClear, graze,
             impactsAvail: impacts.length, bulletsTotal: bullets.length };
  }
  const tDie = impacts[HP - 1];

  // ★무피격 보장: 격파 전 실제 피격(R_HIT 접촉)이 있으면 = 회피 실패 → 스윕 기각(봄 전/후 무관, 완전 회피)
  if (everHit && firstHit <= tDie) {
    return { ok: false, reason: 'got-hit', C, firstHit, tBomb: T_BOMB, tDieWouldBe: tDie,
             peak, peakDanger, minClear, graze, bulletsTotal: bullets.length };
  }

  const hpKey = [[tBoss, HP]];
  for (let i = 0; i < HP; i++) hpKey.push([impacts[i], HP - 1 - i]);
  events.push({ t: tDie, type: 'BOSS_DIE' });

  // 스펠 브레이크: 격파 시 살아있는 탄 소거(게임 규칙 — 실계산)
  let spellBreak = 0;
  for (const b of bullets) if (b.t0 <= tDie && b.tEnd > tDie) { b.tEnd = tDie; spellBreak++; }
  for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].t0 > tDie) bullets.splice(i, 1);
  for (let i = pshots.length - 1; i >= 0; i--) if (pshots[i].t0 > tDie) pshots.splice(i, 1);

  const T_GAME = +(tDie + C.CLEAR_TAIL).toFixed(4);
  PKF.length = Math.min(PKF.length, Math.round(T_GAME * FPS) + 1);
  // 클리어 여운 구간도 회피 경로를 이어 붙여(홈 수렴) seek 연속성 확보
  for (let f = PKF.length; f * dt <= T_GAME; f++) dodgeStep(f * dt, bullets);

  const player = t => interp3(PKF, t);

  return {
    ok: true, C, seed: C.seed, D, BOSS_HP: HP,
    tBomb: T_BOMB, item, tBoss, tDie, T_GAME, everHit,
    bullets, pshots, turrets, bossPos, BR, hpKey, events, impacts,
    PKF, player, bpos, GRZ_KEY, GRZ_EVT,
    peak, peakDanger, minClear: +minClear.toFixed(2), graze,
    bulletsTotal: bullets.length, pshotsTotal: pshots.length,
    bombCleared: cleared, spellBreak,
    hitsLanded: pshots.filter(s => s.impact !== null).length,
    accuracy: +(pshots.filter(s => s.impact !== null).length / Math.max(1, pshots.length)).toFixed(3),
  };
}

export function interp3(K, t) {
  if (!K.length) return { x: 0, y: 0 };
  if (t <= K[0][0]) return { x: K[0][1], y: K[0][2] };
  let a = 0, b = K.length - 1;
  while (a < b) { const m = (a + b) >> 1; if (K[m][0] < t) a = m + 1; else b = m; }
  if (a === 0) return { x: K[0][1], y: K[0][2] };
  const p = K[a - 1], q = K[a];
  const k = (t - p[0]) / Math.max(1e-6, q[0] - p[0]);
  return { x: p[1] + (q[1] - p[1]) * k, y: p[2] + (q[2] - p[2]) * k };
}

/** ★회피 판단의 재현 — S3 HOW 컷 전용(창작 좌표 금지, 캐넌 §3).
    build() 안의 dodgeStep과 **동일한 수식**으로 레인 점수를 다시 계산한다.
    px는 확정된 회피 경로(PKF)에서 읽으므로 순수함수. */
export function dodgeField(sim, t) {
  const C = sim.C, px = sim.player(t).x;
  const [lo, hi] = activeRange(sim.bullets, t, C.LIFE);
  const near = [];
  for (let i = lo; i < hi; i++) {
    const b = sim.bullets[i];
    for (const la of C.LOOK) { const p = bpos(b, t + la); if (p && Math.abs(p.y - C.DODGE_Y) < 200) near.push(p); }
  }
  const home = C.W / 2 + 248 * Math.sin(TAU * 0.21 * t) + 68 * Math.sin(TAU * 0.083 * t + 1);
  const lanes = [];
  let bestX = px, bestS = -Infinity;
  for (let c = 0; c < C.LANES; c++) {
    const cx = C.PMARGIN + c * (C.W - 2 * C.PMARGIN) / (C.LANES - 1);
    let mind = Infinity;
    for (const p of near) { const d = Math.hypot(p.x - cx, p.y - C.DODGE_Y); if (d < mind) mind = d; }
    const danger = mind < C.DANGER ? (C.DANGER - mind) * 12 : 0;
    const s = -danger + Math.min(mind, 180) - Math.abs(cx - home) * 0.14 - Math.abs(cx - px) * 0.12;
    lanes.push({ x: cx, mind, danger, score: s });
    if (s > bestS) { bestS = s; bestX = cx; }
  }
  return { lanes, bestX, bestS, px, home, nearCount: near.length, y: C.DODGE_Y };
}

/** 위협 밴드 밀도: 플레이어 라인 ±DANGER_BAND 안의 탄 수 */
export function dangerAt(sim, t) {
  const [lo, hi] = activeRange(sim.bullets, t, sim.C.LIFE);
  let n = 0;
  for (let i = lo; i < hi; i++) {
    const p = bpos(sim.bullets[i], t);
    if (p && p.x > -30 && p.x < sim.C.W + 30 && Math.abs(p.y - sim.C.DODGE_Y) < sim.C.DANGER_BAND) n++;
  }
  return n;
}

/** 프레임 t의 화면 내 적탄 수(밀도) — 렌더/검증 공용 */
export function densityAt(sim, t) {
  const [lo, hi] = activeRange(sim.bullets, t, sim.C.LIFE);
  let n = 0;
  for (let i = lo; i < hi; i++) {
    const p = bpos(sim.bullets[i], t);
    if (p && p.x > -30 && p.x < sim.C.W + 30 && p.y > -30 && p.y < sim.C.H + 30) n++;
  }
  return n;
}
