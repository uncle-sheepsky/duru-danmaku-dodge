/* 탄막 리메이크 값 파일 — 엔진(../danmaku_engine.js)은 무수정, 파라미터만 여기.
   처음 값(D=3.4 seed=8)은 틱 판정만 통과: 틱 사이 연속 최소 6.70px < R_HIT 12. 그래서 다시 고른 조합.
   D=3.8 seed=93 : tools/sweep.mjs 1800조합 중 틱·연속 무피격 261 · peak≥3000 111 중 선택(봄 직전 최근접).
   authored(고지 대상): 밀도 램프 · 시드 선택 · 봄 시각 · BOSS_THIN · BOSS_HP. 실계산: 탄 궤적 · 회피 · 충돌 · 명중. */
export const FPS = 30;
export const BPM = 180;                // 사용자 판정 2026-11-05: 210 은 너무 빠름
export const BAR_F = 40;               // 180BPM@30fps · 1마디 = 40f = 64,000샘플
export const BARS = 12;
export const TOTAL_F = 480;            // 12마디 = 16.000s

export const PARAMS = { D: 3.8, seed: 93, T_BOMB: 6.8667, BOSS_THIN: 0, CLEAR_TAIL: 1.1, BOSS_HP: 117 };   // 반격 구간 THIN=0(화면 최대 403발)도 틱·연속 무피격

/* 마디 표(화면·소리 공통). 시각은 영상 프레임 = 마디 × BAR_F */
export const BAR = { hookEnd: 2, itemZone: 3, slow: 4, bomb: 5, kill: 9, outro: 10, end: 12 };

/* 게임 시각 사상(구간 선형). 탄·기체는 닫힌형이라 어느 시각이든 계산된 값 그대로다.
   ⓐ 0→slow 마디 1배속 ⓑ slow 마디 = 최근접 구간 저속 ⓒ 봄 직전 복귀 ⓓ 봄→격파 ≈0.994배속(격파를 다운비트에) ⓔ 이후 1배속 */
export const GAME_SLOW_FROM = 6.6;     // 저속 시작(게임 시각)
export const GAME_SLOW_TO = 206 / 30;  // 저속 끝 = 틱 f206(엔진 peak 3490 을 잰 틱). 영상 V=205 에 놓아 봄 직전 화면 수 = peak

export const EXPECT = { peak: 3490, bossHP: 117, tBomb: 6.8667, tDie: 12.1667, contMinPx: 12.857, contMinAt: 6.8292, rHit: 12 };
