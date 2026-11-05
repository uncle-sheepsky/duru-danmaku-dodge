/* 탄막 리메이크 렌더 — 프레임 V의 순수 함수.
   CSS 애니메이션·rAF·Math.random·Date.now·blur·shadowBlur·런타임 글꼴 금지. 이징 = gsap.parseEase. 방사형 빛줄기 금지(동심원만). */
import * as E from '../danmaku_engine.js';
import { PARAMS, TOTAL_F, FPS, BAR_F, EXPECT } from './config.js';
import { VF, makeMap, cockpitTable, shipTable, hudTick } from './timeline.js';

const cv = document.getElementById('cv');
const g = cv.getContext('2d', { willReadFrequently: true });
const W = 1080, H = 1920;
const ease = (() => { const c = {}; return n => c[n] || (c[n] = gsap.parseEase(n)); })();
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (V, a, b, n = 'none') => ease(n)(clamp((V - a) / (b - a)));
// 결정론 해시(시드 고정)
const hash = i => { let x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ── 배치 ── */
const FX = 108, FY = 110, FS = 0.8, FW = 864, FH = 1536, FR = 30;
const CK0 = { x: 28, y: 100, w: 372, h: 319 }, CK1 = { x: 160, y: 390, w: 760, h: 651 };
const HUD = { x: 640, y: 100, w: 412, h: 190 };
const INK = '#2a0f08', HONEY = '#ffc84c', TEAL = '#06ECD2', NAVY = '#0c0b24';
const BOSS_W = 230;

/* ── 자산 ── */
const IM = {};
function toCanvas(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); return c; }
const load = (key, url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => { IM[key] = toCanvas(i); res(); }; i.onerror = () => rej(new Error('load ' + url)); i.src = url; });

const S = E.build({ ...PARAMS });
if (!S.ok || S.peak !== EXPECT.peak) throw new Error('엔진 값 불일치');
const map = makeMap(S.tDie);
const CK = cockpitTable(S, map, TOTAL_F), SH = shipTable(S, map, TOTAL_F);
const META = await (await fetch('data/meta.json')).json();
const TX = await (await fetch('data/text.json')).json();
const BPAL = [...new Set(S.bullets.map(b => b.color))];

const jobs = [];
for (const n of new Set(CK)) { jobs.push(load(n + '__s', `assets/cels/${n}__s.png`), load(n + '__l', `assets/cels/${n}__l.png`)); }
for (let i = 1; i <= 4; i++) { jobs.push(load(`ship${i}s`, `assets/cels/ship_cel0${i}__s.png`), load(`ship${i}l`, `assets/cels/ship_cel0${i}__l.png`), load(`cut${i}`, `assets/cels/cutin_face_cel0${i}.png`)); }
for (let i = 1; i <= 3; i++) jobs.push(load(`boss${i}`, `assets/cels/boss_melon_cel0${i}__s.png`));
jobs.push(load('f0', 'assets/f0/g_a_squeeze.png'));   // 사용자 선택 2026-11-05 · 첫 프레임 = 썸네일
jobs.push(load('items', 'assets/cels/item_bomb_cel01__s.png'), load('iteml', 'assets/cels/item_bomb_cel01__l.png'));
for (const n of ['bg_field', 'cockpit', 'turret', 'chunk_a', 'chunk_b', 'chunk_c']) jobs.push(load(n, `assets/prep/${n}.png`));
for (const k of Object.keys(TX)) jobs.push(load('t_' + k, `assets/text/${k}.png`));
await Promise.all(jobs);

/* 보스 번쩍임 = 흰 실루엣 캔버스(filter 금지) */
const white = {};
for (let i = 1; i <= 3; i++) { const s = IM[`boss${i}`], c = document.createElement('canvas'); c.width = s.width; c.height = s.height; const x = c.getContext('2d'); x.drawImage(s, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); white[i] = c; }

/* 탄 스프라이트: 1배·3.4배(확대용) — 초콜릿 외곽 + 색 + 흰 심 */
const BR = 7.5 * FS;
function bulletSprite(col, k) {
  const r = BR * k, pad = 3 * k, s = Math.ceil((r * 1.3 + pad) * 2), c = document.createElement('canvas'); c.width = c.height = s;
  const x = c.getContext('2d'), m = s / 2;
  x.fillStyle = INK; x.beginPath(); x.arc(m, m, r * 1.26, 0, 6.2832); x.fill();
  x.fillStyle = col; x.beginPath(); x.arc(m, m, r, 0, 6.2832); x.fill();
  x.fillStyle = '#fffdf5'; x.beginPath(); x.arc(m, m, r * 0.38, 0, 6.2832); x.fill();
  return { c, s, k };
}
const SP1 = {}, SP3 = {};
for (const col of BPAL) { SP1[col] = bulletSprite(col, 1); SP3[col] = bulletSprite(col, 3); }

/* 봄·격파 순간 사라지는 탄 위치(펑 효과) */
const popBomb = [], popKill = [];
for (const b of S.bullets) {
  if (b.tEnd === S.tBomb) { const p = E.bpos(b, S.tBomb - 1e-4); if (p && p.x > -30 && p.x < 1110 && p.y > -30 && p.y < 1950) popBomb.push({ x: p.x, y: p.y, c: b.color }); }
  else if (b.tEnd === S.tDie) { const p = E.bpos(b, S.tDie - 1e-4); if (p && p.x > -30 && p.x < 1110 && p.y > -30 && p.y < 1950) popKill.push({ x: p.x, y: p.y, c: b.color }); }
}
/* 격파 조각: 닫힌형 포물선 */
const CHUNKS = [...Array(14).keys()].map(i => {
  const a = 6.2832 * (i + hash(i) * 0.6) / 14, sp = 620 + hash(i + 40) * 760;
  return { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 260, rot: (hash(i + 80) - 0.5) * 14, s: 44 + hash(i + 120) * 58, n: ['chunk_a', 'chunk_b', 'chunk_c'][i % 3], ph: hash(i + 160) * 6.28 };
});

/* ── 그리기 도우미 ── */
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function sprite(key, cx, cy, sc = 1, alpha = 1, rot = 0) {
  const s = IM[key]; if (!s || alpha <= 0) return;
  g.save(); g.globalAlpha = alpha; g.translate(cx, cy); if (rot) g.rotate(rot); g.scale(sc, sc); g.drawImage(s, -s.width / 2, -s.height / 2); g.restore();
}
const fx = x => FX + x * FS, fy = y => FY + y * FS;
function digits(str, rightX, topY, set, sc = 1) {
  let x = rightX;
  for (let i = str.length - 1; i >= 0; i--) {
    const key = `d${set}_${str[i] === ',' ? 'c' : str[i]}`, m = TX[key], w = m.w * sc;
    x -= w - 3; g.drawImage(IM['t_' + key], x, topY, w, m.h * sc);
  }
  return x;
}
function ring(x, y, r, lw, col, alpha) { if (alpha <= 0 || r <= 0) return; g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke(); g.globalAlpha = 1; }

/* ── 카메라(저속 마디 확대) ── */
function camera(V, shipX, shipY) {
  const inK = seg(V, VF.slow - 3, VF.slow + 12, 'power3.out');
  const outK = seg(V, VF.bomb - 1, VF.bomb + 1, 'power2.in');
  const k = inK * (1 - outK);
  const z = lerp(1, 3.0, k);
  const tx = lerp(shipX, 540, k), ty = lerp(shipY, 960, k);
  return { z, k, tx, ty, fx0: shipX, fy0: shipY };
}

/* ── 게임 필드 ── */
function field(V, t, cam) {
  g.save();
  rrect(g, FX, FY, FW, FH, FR); g.clip();
  g.fillStyle = '#04040f'; g.fillRect(FX, FY, FW, FH);
  // 카메라 + 격파 흔들림
  let shx = 0, shy = 0;
  const sh = 1 - seg(V, VF.kill, VF.kill + 16);
  if (V >= VF.kill && sh > 0) { shx = Math.sin(V * 2.1) * 13 * sh; shy = Math.cos(V * 2.7) * 13 * sh; }
  g.translate(cam.tx + shx, cam.ty + shy); g.scale(cam.z, cam.z); g.translate(-cam.fx0, -cam.fy0);
  g.drawImage(IM.bg_field, FX, FY - 60 * (V / TOTAL_F), FW, FH + 60);

  const tb = S.tBomb, afterBomb = t >= tb;
  // 포탑(씨앗): 봄에 사라짐
  const tf = clamp((tb + 0.2 - t) / 0.2) * clamp(t / 0.3);
  if (tf > 0) for (const tu of S.turrets) sprite('turret', fx(tu.x), fy(tu.y), 66 / IM.turret.width, tf);

  // 아이템: 위에서 내려와 기체 자리에서 멈춤(습득 시각·자리는 엔진 값)
  if (t >= S.item.t0 && t < tb) {
    const k = ease('power2.out')(clamp((t - S.item.t0) / 0.75));
    const iy = fy(S.item.y) - (1 - k) * 330;
    const z = cam.z > 1.3;
    const pulse = 1 + 0.08 * Math.sin((V) * 0.75);
    ring(fx(S.item.x), iy, 44 + 8 * Math.sin(V * 0.75), 3.5, HONEY, 0.7);
    sprite(z ? 'iteml' : 'items', fx(S.item.x), iy, (z ? 62 / 170 : 1) * pulse);
  }

  // 보스
  if (V < VF.kill + 10) {
    const o = S.bossPos(Math.min(t, S.tDie));
    const cel = V >= VF.kill ? 3 : (V >= META.itemV ? 2 : 1);
    let lastHit = -1e9;
    for (const h of META.hits) { if (h <= V) lastHit = h; else break; }
    const hk = clamp(1 - (V - lastHit) / 3);
    const ox = hk * 3 * Math.sin(V * 2.3);
    sprite(`boss${cel}`, fx(o.x) + ox, fy(o.y) + 6 * Math.sin(V * 0.13));
    const fl = V >= VF.kill ? 0.85 * (1 - seg(V, VF.kill, VF.kill + 10)) : hk * 0.3;
    if (fl > 0) { g.globalAlpha = fl; const w = white[cel]; g.drawImage(w, fx(o.x) + ox - w.width / 2, fy(o.y) + 6 * Math.sin(V * 0.13) - w.height / 2); g.globalAlpha = 1; }
    // HP 막대(보스 아래)
    const hp = (S.hpKey.filter(k => k[0] <= t).pop() || [0, S.BOSS_HP])[1] / S.BOSS_HP;
    if (V < VF.kill) {
      const bw = 200, bx = fx(o.x) - bw / 2, by = fy(o.y) + 126;
      g.fillStyle = INK; rrect(g, bx - 4, by - 4, bw + 8, 22, 8); g.fill();
      g.fillStyle = hp < 0.25 && Math.floor(V / 3) % 2 ? '#fff' : '#ff5d7a'; rrect(g, bx, by, Math.max(2, bw * hp), 14, 5); g.fill();
    }
  }

  // 아군탄
  g.lineCap = 'round';
  for (const s of S.pshots) {
    const d = t - s.t0; if (d < 0 || d > s.life) continue;
    const x = fx(s.ox + s.vx * d), y = fy(s.oy + s.vy * d), tx = x - s.vx * 0.024 * FS, ty = y - s.vy * 0.024 * FS;
    g.strokeStyle = INK; g.lineWidth = 12; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
    g.strokeStyle = '#fff3b0'; g.lineWidth = 6.5; g.beginPath(); g.moveTo(x, y); g.lineTo(tx, ty); g.stroke();
  }
  // 명중 고리
  if (V < VF.kill + 1) {
    for (const s of S.pshots) {
      if (s.impact === null || s.impact > S.tDie) continue;
      const a = t - s.impact; if (a < 0 || a > 0.17) continue;
      const k = a / 0.17; ring(fx(s.ox + s.vx * s.life), fy(s.oy + s.vy * s.life), 6 + 18 * k, 4 * (1 - k) + 0.5, '#fff3b0', 1 - k);
    }
  }

  // 기체
  const p = S.player(t), dx = S.player(t + 2 / FPS).x - S.player(t - 2 / FPS).x;
  const tilt = clamp(dx / 90, -1, 1) * 0.2;
  const big = cam.z > 1.3, idx = +SH[V].slice(-1);
  sprite(`ship${idx}${big ? 'l' : 's'}`, fx(p.x), fy(p.y) - 8, big ? 116 / 348 : 1, 1, tilt);
  // 적탄
  const SP = cam.z > 1.3 ? SP3 : SP1;
  for (const b of S.bullets) {
    if (t < b.t0 || t >= b.tEnd) continue;
    const p = E.bpos(b, t); if (!p || p.x < -30 || p.x > 1110 || p.y < -30 || p.y > 1950) continue;
    const s = SP[b.color], d = s.s / s.k;
    g.drawImage(s.c, fx(p.x) - d / 2, fy(p.y) - d / 2, d, d);
  }
  // 봄·격파 때 탄이 터져 사라짐
  const pop = (list, V0, dur) => {
    const k = (V - V0) / dur; if (k < 0 || k >= 1) return;
    const a = 1 - k, sc = 1 + 1.3 * ease('power2.out')(k);
    g.globalAlpha = a;
    for (const q of list) { const s = SP1[q.c], d = s.s * sc; g.drawImage(s.c, fx(q.x) - d / 2, fy(q.y) - d / 2, d, d); }
    g.globalAlpha = 1;
  };
  pop(popBomb, VF.bomb, 16); pop(popKill, VF.kill, 12);

  // 판정점: 항상 표시(반경 = 엔진 R_HIT)
  const hr = S.C.R_HIT * FS;
  g.fillStyle = 'rgba(6,236,210,0.28)'; g.beginPath(); g.arc(fx(p.x), fy(p.y), hr, 0, 6.2832); g.fill();
  g.strokeStyle = INK; g.lineWidth = 4 / cam.z; g.beginPath(); g.arc(fx(p.x), fy(p.y), hr + 1 / cam.z, 0, 6.2832); g.stroke();
  g.strokeStyle = TEAL; g.lineWidth = 2.4 / cam.z; g.beginPath(); g.arc(fx(p.x), fy(p.y), hr, 0, 6.2832); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(fx(p.x), fy(p.y), 2.4, 0, 6.2832); g.fill();

  // 최근접 탄 표시(저속 마디): 엔진 탄 중 실제 최단 거리 탄의 심과 판정점을 잇는다
  if (V >= VF.slow && V < VF.bomb) {
    let m = 1e9, q = null;
    for (const b of S.bullets) {
      if (t < b.t0 || t >= b.tEnd) continue;
      const c = E.bpos(b, t); if (!c) continue;
      const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < m) { m = d; q = c; }
    }
    if (q && m < 80) {
      g.strokeStyle = '#fff'; g.lineWidth = 1.2 / cam.z * 1.6;
      g.beginPath(); g.moveTo(fx(p.x), fy(p.y)); g.lineTo(fx(q.x), fy(q.y)); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 2 / cam.z; g.beginPath(); g.arc(fx(q.x), fy(q.y), BR * 1.5, 0, 6.2832); g.stroke();
    }
  }

  // 동심원: 봄(기체) · 격파(보스)
  for (let i = 0; i < 3; i++) {
    const k = seg(V, VF.bomb + i * 4, VF.bomb + i * 4 + 26, 'power2.out');
    if (V >= VF.bomb + i * 4 && k < 1) ring(fx(S.item.x), fy(S.item.y), 40 + k * 1500, 26 * (1 - k) + 2, i % 2 ? '#fff3b0' : HONEY, 1 - k);
  }
  const ko = S.bossPos(S.tDie);
  for (let i = 0; i < 4; i++) {
    const k = seg(V, VF.kill + i * 3, VF.kill + i * 3 + 30, 'power2.out');
    if (V >= VF.kill + i * 3 && k < 1) ring(fx(ko.x), fy(ko.y), 60 + k * 1400, 30 * (1 - k) + 2, i % 2 ? '#ffffff' : HONEY, 1 - k);
  }
  // 격파 조각
  if (V >= VF.kill + 8) {
    const d = (V - VF.kill - 8) / FPS;
    for (const c of CHUNKS) {
      const x = fx(ko.x) + c.vx * d * FS, y = fy(ko.y) + (c.vy * d + 900 * d * d) * FS;
      if (y > FY + FH + 80) continue;
      const s = IM[c.n], sc = c.s / s.width;
      g.save(); g.translate(x, y); g.rotate(c.ph + c.rot * d); g.scale(sc, sc); g.drawImage(s, -s.width / 2, -s.height / 2); g.restore();
    }
  }
  g.restore();

  // 봄 첫 프레임 밝힘(필드 안)
  const fl = 1 - seg(V, VF.bomb, VF.bomb + 5);
  if (V >= VF.bomb && fl > 0) { g.save(); rrect(g, FX, FY, FW, FH, FR); g.clip(); g.globalAlpha = fl * 0.55; g.fillStyle = '#fff6d8'; g.fillRect(FX, FY, FW, FH); g.restore(); }

  // 필드 테두리
  g.strokeStyle = INK; g.lineWidth = 12; rrect(g, FX, FY, FW, FH, FR); g.stroke();
  g.strokeStyle = 'rgba(255,200,76,0.75)'; g.lineWidth = 3; rrect(g, FX + 1, FY + 1, FW - 2, FH - 2, FR); g.stroke();
}

/* ── 조종석 창 ── */
function cockpit(V) {
  const k = seg(V, VF.outro, VF.outro + 12, 'power3.inOut');
  const x = lerp(CK0.x, CK1.x, k), y = lerp(CK0.y, CK1.y, k), w = lerp(CK0.w, CK1.w, k), h = lerp(CK0.h, CK1.h, k);
  const bump = V >= VF.bomb && V < VF.bomb + 8 ? 1 + 0.05 * (1 - (V - VF.bomb) / 8) : 1;
  g.save();
  g.translate(x + w / 2, y + h / 2); g.scale(bump, bump); g.translate(-(x + w / 2), -(y + h / 2));
  g.fillStyle = INK; rrect(g, x - 7, y - 7, w + 14, h + 14, 30); g.fill();
  g.save(); rrect(g, x, y, w, h, 24); g.clip();
  g.drawImage(IM.cockpit, x, y, w, h);
  g.fillStyle = 'rgba(16,6,28,0.28)'; g.fillRect(x, y, w, h);
  const big = w > CK0.w + 1, c = IM[CK[V] + (big ? '__l' : '__s')];
  g.drawImage(c, x, y, w, h);
  // 앞 계기판: 옷단을 가린다
  const cy = y + h * 0.905;
  g.fillStyle = INK; g.fillRect(x, cy - h * 0.012, w, h);
  g.fillStyle = '#5a2340'; g.fillRect(x, cy, w, h);
  for (let i = 0; i < 5; i++) { const lx = x + w * (0.12 + i * 0.19), on = Math.floor(V / (BAR_F / 2) + i) % 3 === 0; g.fillStyle = on ? HONEY : '#7a4a5a'; g.beginPath(); g.arc(lx, cy + h * 0.045, h * 0.016, 0, 6.2832); g.fill(); }
  g.restore();
  g.strokeStyle = HONEY; g.lineWidth = 5; rrect(g, x, y, w, h, 24); g.stroke();
  g.restore();
}

/* ── 수치 판 ── */
function hud(V, t) {
  const a = 1 - seg(V, VF.outro, VF.outro + 8);
  if (a <= 0) return;
  g.save(); g.globalAlpha = a;
  const { x, y, w, h } = HUD;
  g.fillStyle = INK; rrect(g, x - 6, y - 6, w + 12, h + 12, 26); g.fill();
  g.fillStyle = NAVY; rrect(g, x, y, w, h, 20); g.fill();
  g.drawImage(IM.t_lab_bullets, x + 22, y + 12);
  const n = E.densityAt(S, hudTick(t, S.tBomb));
  let pop = 0;
  for (const th of Object.values(META.milestones)) if (V >= th && V < th + 8) pop = 1 - (V - th) / 8;
  const sc = 1 + 0.16 * pop, set = n >= 3000 ? 'h' : 'w';
  g.save(); g.translate(x + w - 14, y + 96); g.scale(sc, sc); digits(n.toLocaleString('en-US'), 0, -58, set); g.restore();
  g.drawImage(IM.t_lab_hit, x + 22, y + 142);
  digits('0', x + 22 + TX.lab_hit.w + 54, y + 122, 't');
  g.restore();
}

/* ── 글자 ── */
function hook(V) {
  const a = 1 - seg(V, VF.hookEnd - 3, VF.hookEnd);
  if (a <= 0) return;
  const s1 = lerp(1.1, 1, seg(V, 0, 6, 'back.out(2)'));
  sprite('t_hook1', 540, 800, s1, a);
  sprite('t_hook2', 540, 930, 1, a * seg(V, BAR_F / 2, BAR_F / 2 + 3));
}
function nearLabel(V) {
  const a = seg(V, META.contMinV - 8, META.contMinV - 4) * (V < VF.bomb ? 1 : 0);
  if (a <= 0) return;
  const m = TX.near;
  g.save(); g.globalAlpha = a * 0.86; g.fillStyle = INK; rrect(g, 540 - m.w / 2 - 22, 700 - m.h / 2 - 12, m.w + 44, m.h + 24, 26); g.fill(); g.restore();
  sprite('t_near', 540, 700, 1, a);
}
function cutin(V) {
  const V0 = VF.bomb, dur = 34;
  if (V < V0 || V >= V0 + dur) return;
  const inK = seg(V, V0, V0 + 6, 'power3.out'), outK = seg(V, V0 + dur - 6, V0 + dur, 'power3.in');
  const off = (1 - inK) * -1100 + outK * 1100;
  const by = 640, bh = 590;
  g.save(); g.translate(off, 0);
  g.fillStyle = INK; g.fillRect(-20, by - 12, W + 40, bh + 24);
  g.fillStyle = HONEY; g.fillRect(-20, by, W + 40, bh);
  g.fillStyle = 'rgba(255,255,255,0.32)';
  for (let i = 0; i < 9; i++) { const yy = by + 26 + i * 62, xx = ((V * (26 + i * 5) + hash(i) * 900) % (W + 500)) - 400; g.fillRect(xx, yy, 300 + hash(i + 9) * 240, 12); }
  const k = V - V0, cel = k < 6 ? 1 : k < 12 ? 2 : k < 18 ? 3 : 4;
  const c = IM[`cut${cel}`];
  g.drawImage(c, 40, by + bh - c.height);
  g.restore();
  sprite('t_bomb', 540 + off, by + bh - 30, lerp(1.25, 1, seg(V, V0 + 4, V0 + 9, 'back.out(2)')), seg(V, V0 + 3, V0 + 5));
}
function killText(V) {
  if (V < VF.kill + 3 || V >= VF.outro + 6) return;
  const s = lerp(1.5, 1, seg(V, VF.kill + 3, VF.kill + 10, 'back.out(2.5)')), a = 1 - seg(V, VF.outro, VF.outro + 6);
  sprite('t_kill', 540, 900, s, a);
}
function outro(V) {
  if (V < VF.outro) return;
  const a = seg(V, VF.outro, VF.outro + 10);
  g.globalAlpha = a * 0.72; g.fillStyle = '#05041a'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
}
function stats(V) {
  if (V < VF.outro) return;
  const a1 = seg(V, VF.outro, VF.outro + 3), s1 = lerp(1.35, 1, seg(V, VF.outro, VF.outro + 6, 'back.out(2)'));
  sprite('t_stat1', 540, 1160, s1, a1);
  const V2 = VF.outro + BAR_F / 2;
  const a2 = seg(V, V2, V2 + 4), s2 = lerp(1.35, 1, seg(V, V2, V2 + 6, 'back.out(2)'));
  sprite('t_stat2', 540, 1320, s2, a2);
}

function draw(V) {
  if (V === 0) { g.globalAlpha = 1; g.drawImage(IM.f0, 0, 0, W, H); return; }
  const t = map.toGame(V);
  // 필드 밖 배경
  g.globalAlpha = 1; g.fillStyle = NAVY; g.fillRect(0, 0, W, H);
  g.drawImage(IM.bg_field, 0, 0, W, H);
  g.fillStyle = 'rgba(4,3,18,0.62)'; g.fillRect(0, 0, W, H);
  const p = S.player(t), cam = camera(V, fx(p.x), fy(p.y));
  field(V, t, cam);
  hud(V, t);
  outro(V);
  cockpit(V);
  hook(V);
  nearLabel(V);
  cutin(V);
  killText(V);
  stats(V);
}

/* 썸네일 재료: 엔진 peak 틱의 실제 탄 화면(수치판·조종석 없음 · 확대 없음) */
window.__barePeak = () => {
  const t = 206 / FPS, V = 158;
  g.globalAlpha = 1; g.fillStyle = NAVY; g.fillRect(0, 0, W, H);
  g.drawImage(IM.bg_field, 0, 0, W, H);
  g.fillStyle = 'rgba(4,3,18,0.62)'; g.fillRect(0, 0, W, H);
  const p = S.player(t), x = fx(p.x), y = fy(p.y);
  field(V, t, { z: 1, k: 0, tx: x, ty: y, fx0: x, fy0: y });
};
window.__seekF = async f => { draw(Math.max(0, Math.min(TOTAL_F - 1, f))); };
window.__meta = META;
window.__ready = true;
