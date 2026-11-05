"""탄막 리메이크 BGM — 신작 1곡(2026-11-05). 12마디@180 = 16.000s = 768,000샘플 = 480f@30fps(1마디 = 40f = 64,000샘플).

v1(210BPM 14마디)은 사용자 판정 「bpm이 너무 빠름」 → 180으로 내리고 화면 길이는 유지.
v2(180)는 사용자 판정 「음이 너무 높아」 — 실측 1~2.5kHz 35% · 무게중심 1245Hz(기준곡 13% · 747Hz) → v3 = 선율·폭포·벽을 한 옥타브 낮추고 폭포를 마림바로.
마디 뜻은 화면과 같다(remake/config.js BAR): 0–1 훅 · 2 탄 벽 · 3 아이템 · 4 저속 · 5 봄(드롭) · 5–8 반격 · 9 격파(슬램) · 10–11 결말.
엔진 = band.py 저수준만 import(샘플러·보이싱·마스터). 화성·선율·편곡·합성 음색은 여기서 새로 쓴다(빌더 포크·화성 이식 금지 캐넌).

생각 = 위로만 올라가는 곡. 탄이 쌓일수록 몰리고, 폭탄에서 나란한 장조로 터진 뒤, 선율 윗줄이 C–E–F–A♭–B♭ 한 칸씩 올라가 격파에서 C6으로 닿는다.
지문(유사성-지문-스키마 §3):
- 축1 = BUILD i–♭VI–iv–♭VII [−4,−3,+5,+2] · DROP I–III7–vi–♭VI–♭VII [+4,+5,−1,+2,+2] · 결말 IV–iv–I
- 축2 = 지그재그 Tₖ(훅: 마디 0·2 = T+5) ↔ 계단 상승 콜 + 16분 하강 폭포 리스폰스. 코드톤 아치 회피
- 축3 = DODGE16: 킥{0,7,10} · 스네어{4,12} · 16분 노이즈(엇8분 강세) · 스트레이트

역할(마디마다 한 명): 선율 = 칩 펄스 · 대답 = 마림바 폭포 · 화음 = 얇은 톱니 벽(엇8분 게이트) · 저음 = 삼각파 · 타악 = 합성 킥·스네어·노이즈 · 강세 = 팀파니·크래시(슬램 한 박)
사용: python remake/bgm/build_bgm.py [--tag v2] [--bpm 180]
산출: bgm/out/<tag>/{mix.wav · stems/ · report.json}
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.signal import sosfilt

HERE = Path(__file__).resolve().parent


sys.path.insert(0, str(HERE))
import band  # noqa: E402
from band import SR, Song, bass_note, h01, line, m2f, sos, voice  # noqa: E402

TAG = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else "v3"
BPM = int(sys.argv[sys.argv.index("--bpm") + 1]) if "--bpm" in sys.argv else 180
BARS = 12
TOTAL_N = round(BARS * 4 * 60 / BPM * SR)
LUFS_BED = -15.5


def B(bar, beat=0.0):
    return bar * 4 + beat


# ── 화성(마디, 박, 코드) ───────────────────────────────────────────────────────────────────
CH = [
    (0, 0, "Dm"), (1, 0, "Bb"), (2, 0, "Gm"), (3, 0, "C"),         # BUILD
    (4, 0, "C7sus4"), (4, 2, "C7"),                                # 저속
    (5, 0, "F"), (6, 0, "A7"), (7, 0, "Dm"),                       # DROP
    (8, 0, "Db"), (8, 2, "Eb"), (9, 0, "F"),                       # 마침 → 격파
    (10, 0, "Bb"), (10, 2, "Bbm"), (11, 0, "F"),                   # 결말
]
SPANS = [(B(b, t), B(*CH[i + 1][:2]) if i + 1 < len(CH) else B(BARS), s) for i, (b, t, s) in enumerate(CH)]


def spans_in(bar):
    return [(a, b, s) for a, b, s in SPANS if B(bar) <= a < B(bar + 1)]


# ── 합성 음색(이 곡 전용) ──────────────────────────────────────────────────────────────────
def _saw(ph, dt):
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def pulse_wave(f, duty, phase0=0.0):
    dt = f / SR
    ph = (phase0 + np.cumsum(dt)) % 1.0
    return 0.5 * (_saw(ph.copy(), dt) - _saw((ph + duty) % 1.0, dt))


def saw_wave(f, phase0=0.0):
    dt = f / SR
    return _saw((phase0 + np.cumsum(dt)) % 1.0, dt)


def chip(m, dur, duty=0.25, cents=0.0, bend=0.5, vib=0.0, rel=0.018, lp=5200, hp=140, ph=0.0):
    """칩 펄스 — 첫 12ms 위에서 내려앉아 또렷이 박힌다. 길면 뒤에 비브라토."""
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    semis = m + cents / 100 + bend * np.exp(-t / 0.012) + vib * np.sin(2 * np.pi * 6.1 * t) * np.clip((t - 0.2) / 0.12, 0, 1)
    y = pulse_wave(m2f(semis), duty, ph)
    e = np.minimum(1, t / 0.0015) * (0.62 + 0.38 * np.exp(-t / max(0.06, dur * 0.5)))
    k = int(dur * SR)
    e[k:] *= np.linspace(1, 0, n - k) ** 2
    return sosfilt(sos(hp, "highpass"), sosfilt(sos(lp, "lowpass"), y * e))


def tri_bass(m, dur, amp_sub=0.55, rel=0.02):
    n = int((dur + rel) * SR)
    t = np.arange(n) / SR
    f = m2f(m + 0.3 * np.exp(-t / 0.01))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = sum(((-1) ** i) / (2 * i + 1) ** 2 * np.sin((2 * i + 1) * ph) for i in range(6)) * 0.81 + amp_sub * np.sin(ph)
    e = np.minimum(1, t / 0.003) * (0.7 + 0.3 * np.exp(-t / 0.09))
    k = int(dur * SR)
    e[k:] *= np.linspace(1, 0, n - k) ** 2
    return y * e


def wall_voice(notes, dur, seed, detune=(-11, -4, 5, 12)):
    """얇은 톱니 벽 — 음마다 네 줄. 시드가 다른 두 벌을 좌우로 벌린다(디코릴레이션)."""
    n = int(dur * SR)
    y = np.zeros(n)
    for j, m in enumerate(notes):
        for k, c in enumerate(detune):
            y += saw_wave(np.full(n, m2f(m + c / 100)), h01(seed, j, k))
    return y / (len(notes) * len(detune)) ** 0.5


def kick(vel=1.0):
    n = int(0.17 * SR)
    t = np.arange(n) / SR
    f = 57 + 150 * np.exp(-t / 0.018)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.075)
    click = np.sin(2 * np.pi * 2600 * t) * np.exp(-t / 0.0016) * 0.22
    return np.tanh(1.5 * (y + click)) / np.tanh(1.5) * vel


def _noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


def snare(vel=1.0, seed=3):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    nz = sosfilt(sos(1500, "highpass"), sosfilt(sos(9000, "lowpass"), _noise(n, seed))) * np.exp(-t / 0.05)
    tone = np.sin(2 * np.pi * (205 + 90 * np.exp(-t / 0.012)) * t) * np.exp(-t / 0.045)
    return (0.5 * nz + 0.55 * tone) * vel


def hat(vel=1.0, open_=False, seed=5):
    n = int((0.09 if open_ else 0.028) * SR)
    t = np.arange(n) / SR
    d = 0.03 if open_ else 0.007
    return sosfilt(sos(7500, "highpass"), _noise(n, seed)) * np.exp(-t / d) * vel


def riser(dur, seed=9):
    """저속 마디 전체 — 어두운 바람이 밝아지며 커진다. 박 끝에서 슬램으로 그대로 들어간다(게이트 금지 §4-1)."""
    n = int(dur * SR)
    q = (np.arange(n) / n)
    z = _noise(n, seed)
    lo = sosfilt(sos(1200, "lowpass"), z)
    hi = sosfilt(sos(2500, "highpass"), z)
    y = lo * (1 - q) ** 1.2 + hi * q ** 1.5 * 0.9
    f = 180 + 1500 * q ** 2.4
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.22
    return (y * 0.55 + tone) * (0.08 + 0.92 * q ** 2.2)


def whip(dur, seed=17):
    n = int(dur * SR)
    q = np.arange(n) / n
    nz = sosfilt(sos(2000, "highpass"), _noise(n, seed)) * q ** 2.2
    tone = np.sin(2 * np.pi * np.cumsum(600 + 2800 * q ** 2) / SR) * 0.5 * q ** 2
    return nz + tone


# ── 편곡표 — 마디: (드럼 단계, 벽, 저음, 셈여림) ──────────────────────────────────────────────
# 드럼: 1 킥·8분 햇 · 2 + 스네어·16분 · 3 드롭(+오픈햇) · 0 없음 / 벽: (기본 차단 주파수) None=없음
ARR = {
    0: (1, None, "kick", 0.82), 1: (1, None, "kick", 0.84),
    2: (2, 1200, "8", 0.92),
    3: (2, 2400, "8", 1.0),
    4: (0, "swell", "long", 0.8),
    5: (3, 5200, "oct", 1.0), 6: (3, 5200, "oct", 1.0), 7: (3, 5400, "oct", 1.02),
    8: (3, 6400, "oct", 1.0),
    9: (0, "hold", "long", 1.15),
    10: (0, "soft", "long", 0.85), 11: (0, "soft", "long", 0.7),
}
KICK16 = (0, 7, 10)


def dyn(bar):
    return ARR[bar][3]


def drums(s):
    kt = []
    for bar, (lv, *_rest) in ARR.items():
        g = dyn(bar)
        if lv == 0:
            continue
        for k in range(16):
            b = B(bar, k / 4)
            t = s.pos(b)
            if k in KICK16:
                s.add("kick", kick(1.0 if k == 0 else 0.86), t, gain=g)
                kt.append(t)
            if lv >= 2 and k in (4, 12):
                s.add("snare", snare(1.0, seed=int(b * 4) + 3), t, gain=g, send=0.12)
            if lv == 1 and k % 2 == 0:
                s.add("hat", hat(0.75 if k % 4 == 2 else 0.5, seed=int(b * 4)), t, pan=0.18, gain=g)
            if lv >= 2:
                if lv == 3 and k % 4 == 2:
                    s.add("hat", hat(0.7, open_=True, seed=int(b * 4)), t, pan=0.18, gain=g)
                else:
                    s.add("hat", hat(0.7 if k % 2 else 0.42, seed=int(b * 4)), t, pan=0.18 if k % 2 else -0.14, gain=g)
    # 3마디 끝 — 스네어가 8분 → 16분으로 조인다
    for i, st in enumerate((8, 10, 12, 13, 14, 15)):
        s.add("snare", snare(0.5 + 0.08 * i, seed=200 + i), s.pos(B(3, st / 4)), gain=dyn(3), send=0.1)
    # 8마디 끝 — 격파로 미는 16분 필
    for st in range(8, 16):
        s.add("snare", snare(0.55 + 0.06 * (st - 8), seed=300 + st), s.pos(B(8, st / 4)), gain=dyn(8), send=0.1)
    # 저속 마디 — 심장 두 번(저음만)
    for bt, v in ((0, 0.7), (0.5, 0.45), (2, 0.8), (2.5, 0.5)):
        s.add("kick", sosfilt(sos(240, "lowpass"), kick(v)), s.pos(B(4, bt)), gain=1.0)
    return kt


def bass(s):
    for bar, (_, _, st, _) in ARR.items():
        g = dyn(bar)
        for a, b, sym in spans_in(bar):
            r = bass_note(sym, 33, 48)
            if st == "kick":
                for k in KICK16:
                    bb = B(bar, k / 4)
                    if a <= bb < b:
                        s.add("bass", tri_bass(r, 0.34 if k != 7 else 0.17), s.pos(bb), gain=g * (1.0 if k == 0 else 0.8))
            elif st == "8":
                n = int(round((b - a) * 2))
                for i in range(n):
                    s.add("bass", tri_bass(r, s.beat * 0.45), s.pos(a + i * 0.5), gain=g * (1.0 if i % 2 == 0 else 0.72))
            elif st == "oct":
                n = int(round((b - a) * 2))
                for i in range(n):
                    m = r + 12 if i % 4 == 3 or i % 8 == 6 else r
                    s.add("bass", tri_bass(m, s.beat * 0.44), s.pos(a + i * 0.5), gain=g * (1.0 if i % 2 == 0 else 0.76))
            elif st == "long":
                s.add("bass", tri_bass(r, (b - a) * s.beat * 0.96, rel=0.05), s.pos(a), gain=g * (0.6 if bar == 4 else 0.9))


def gate_env(n, t0, s, bar):
    """엇8분 게이트(16분 칸 2·3 · 6·7 · …) — 킥과 자리를 나눈다."""
    e = np.zeros(n)
    a, r = int(0.003 * SR), int(0.012 * SR)
    for k in (2, 3, 6, 7, 10, 11, 14, 15):
        i0 = int(round((s.pos(B(bar, k / 4)) - t0) * SR))
        i1 = int(round((s.pos(B(bar, (k + 1) / 4)) - t0) * SR))
        i0, i1 = max(0, i0), min(n, i1)
        if i0 >= i1:
            continue
        e[i0:i1] = 1.0
        e[i0:min(i1, i0 + a)] *= np.linspace(0, 1, min(a, i1 - i0))
        e[max(i0, i1 - r):i1] *= np.linspace(1, 0, min(r, i1 - i0))
    return e


def walls(s):
    prev = None
    for bar, (_, st, _, _) in ARR.items():
        if st is None:
            continue
        g = dyn(bar)
        for a, b, sym in spans_in(bar):
            prev = voice(sym, 48, 67, prev, n=4)
            t0 = s.pos(a)
            dur = (b - a) * s.beat
            for pan, sd in ((-0.65, 1), (0.65, 2)):
                y = wall_voice(prev, dur + 0.03, seed=a * 10 + sd)
                n = len(y)
                q = np.arange(n) / n
                if st == "swell":
                    # 저속: 어두운 쪽 → 밝은 쪽으로 천천히 벌어진다(마디 안 위치로)
                    k0 = (a - B(4)) / 4
                    k1 = (b - B(4)) / 4
                    kk = k0 + (k1 - k0) * q
                    z = sosfilt(sos(500, "lowpass"), y) * (1 - kk) + sosfilt(sos(3800, "lowpass"), y) * kk
                    z = z * (0.4 + 0.6 * kk)
                elif st == "hold":
                    z = sosfilt(sos(6500, "lowpass"), y) * np.exp(-q * 2.4) * 1.5
                elif st == "soft":
                    z = sosfilt(sos(1700, "lowpass"), y) * 0.55
                else:
                    z = sosfilt(sos(st, "lowpass"), y) * gate_env(n, t0, s, bar)
                z[-int(0.03 * SR):] *= np.linspace(1, 0, int(0.03 * SR))
                s.add("wall", z, t0, pan=pan, gain=g, send=0.16)


# ── 선율 ───────────────────────────────────────────────────────────────────────────────────
HOOK = [
    (0, "D4:.5 A4:.5 F4:.5 C5:.5 A4:.5 D5:.5 C5:1"),
    (1, "D5:.5 Bb4:.5 F4:.5 Bb4:.5 D5:.5 F5:.5 D5:1"),
    (2, "G4:.5 D5:.5 Bb4:.5 F5:.5 D5:.5 G5:.5 F5:1"),
]
REV3 = "G3:.25 A3:.25 Bb3:.25 C4:.25 D4:.25 E4:.25 F4:.25 G4:.25 G4:.25 A4:.25 Bb4:.25 C5:.25 D5:.25 E5:.25 F5:.25 G5:.25"
CALL = [
    (5, "A4:1.25 C5:.75"), (6, "C#5:1.25 E5:.75"), (7, "D5:1.25 F5:.75"),
    (8, "F5:1 Ab5:1 G5:1 Bb5:1"),
]
FALLS = [
    (5, "C6 A5 F5 C5 A4 F4 C4 A3"),
    (6, "A5 G5 E5 C#5 A4 G4 E4 C#4"),
    (7, "A5 F5 D5 A4 F4 D4 A3 F3"),
]
RUN8 = "Db4 F4 Ab4 Db5 F4 Ab4 Db5 F5 Eb4 G4 Bb4 Eb5 G4 Bb4 Eb5 G5"
OUTRO = [(10, "D5:1 F5:1 Db5:1 F5:1"), (11, "C5:1 A4:1 F4:2")]


def add_lead(s, m, b, d, amp, duty=0.25, vib=0.0, bus="lead", pan=0.0):
    dur = d * s.beat
    t = s.pos(b)
    s.add(bus, chip(m, dur * 0.92, duty=duty, cents=6, vib=vib, ph=h01(b, m)), t, pan=pan - 0.22, gain=amp, send=0.14)
    s.add(bus, chip(m, dur * 0.92, duty=duty, cents=-6, vib=vib, ph=h01(m, b)), t, pan=pan + 0.22, gain=amp, send=0.14)


def melody(s):
    for bar, txt in HOOK:
        g = dyn(bar)
        for b, d, m in line(txt, start=B(bar)):
            assert b + d <= B(bar + 1) + 1e-6, (bar, txt)
            add_lead(s, m, b, d, g * (1.0 if bar < 2 else 0.92))
    for i, (b, d, m) in enumerate(line(REV3, start=B(3))):
        add_lead(s, m, b, d, dyn(3) * (0.55 + 0.45 * i / 15), duty=0.125)
    for bar, txt in CALL:
        g = dyn(bar) * (0.72 if bar == 8 else 1.0)            # 격파 첫 박이 전곡 최대가 되게 8마디를 눌러 둔다
        for b, d, m in line(txt, start=B(bar)):
            add_lead(s, m, b, d, g, duty=0.5 if d >= 1 else 0.25, vib=0.14)
    add_lead(s, band.nm("C6"), B(9), 3.0, dyn(9) * 0.9, duty=0.5, vib=0.18)
    for n, a in (("A5", 0.7), ("F5", 0.8), ("C5", 0.8)):                 # 슬램 한 박만 화음으로 겹친다
        add_lead(s, band.nm(n), B(9), 1.0, dyn(9) * a, duty=0.5)
    # 대답: 마림바 폭포(16분 하강) · 8마디는 위로 구른다
    for bar, txt in FALLS:
        for i, n in enumerate(txt.split()):
            band.inst(s, "xylo", "Marimba", band.nm(n), B(bar, 2 + i * 0.25), 0.4, vel=100 - i * 2, amp=dyn(bar), pan=0.4 - 0.1 * i, send=0.12, human=0.0015, rel=0.1)
    for i, n in enumerate(RUN8.split()):
        band.inst(s, "xylo", "Marimba", band.nm(n), B(8, i * 0.25), 0.4, vel=74 + i * 2, amp=dyn(8) * 0.85, pan=-0.4 + 0.05 * i, send=0.12, human=0.0015, rel=0.1)
    # 격파 — 글로켄 오름 한 줄 → 결말: 마림바 + 글로켄(같은 선율)
    for i, n in enumerate("F5 A5 C6 F6".split()):
        band.inst(s, "glock", "Glockenspiel", band.nm(n), B(9, i * 0.25), 1.6, vel=108, amp=0.9, pan=-0.2 + 0.13 * i, send=0.3, human=0.0, rel=0.5)
    for bar, txt in OUTRO:
        for b, d, m in line(txt, start=B(bar)):
            band.inst(s, "mari", "Marimba", m, b, d * 1.4, vel=90, amp=dyn(bar) * 1.4, pan=-0.12, send=0.25, human=0.002, rel=0.3)
            band.inst(s, "glock", "Glockenspiel", m + 12, b, d * 1.4, vel=56, amp=dyn(bar) * 0.55, pan=0.2, send=0.3, human=0.002, rel=0.5)


def accents(s):
    # 저속 마디: 팀파니 롤 크레셴도 + 바람 + 다운비트로 미는 휩
    n = int(4 * s.beat * SR)
    y = band.sample_note("TimpaniRolls", 48, 4 * s.beat, vel=100, rr=1, release=0.01)[:n]
    s.add("fx", y * np.geomspace(0.05, 1.0, len(y)), s.pos(B(4)), gain=0.9, send=0.12)
    s.add("fx", riser(4 * s.beat), s.pos(B(4)), gain=0.55, send=0.2)
    w = 2 * s.beat / 4
    s.add("fx", whip(w), s.pos(B(5)) - w, gain=0.55, send=0.05)
    s.add("fx", whip(w, seed=23), s.pos(B(9)) - w, gain=0.6, send=0.05)
    # 슬램 둘: 봄(5) · 격파(9)
    for bar, ta, cr in ((5, 1.0, 0.9), (9, 1.25, 1.1)):
        y = band.sample_note("Timpani", 41, 1.2, vel=120, rr=1, release=0.3)
        k = int(np.argmax(np.abs(y) > 0.15 * np.abs(y).max()))
        s.add("fx", y * ta, max(0, s.pos(B(bar)) - k / SR), send=0.15)
        band.perc(s, 49, B(bar), amp=cr, vel=118, dur=2.0, send=0.18, human=0.0, bus="crash")
    # 격파 한 박 — 킥 겹
    s.add("kick", kick(1.0), s.pos(B(9)), gain=1.25)
    s.add("kick", kick(0.7), s.pos(B(10)), gain=0.5)


def sidechain(s, kt, buses, depth=0.45, rel=0.085):
    """킥 자리 비우기(믹스 안 고정 패턴). 대사 없음 — 덕킹 금지 규칙 대상 아님."""
    N = s.N
    e = np.ones(N)
    L = int(rel * SR)
    seg = 1 - depth * np.linspace(1, 0, L) ** 1.5
    for t in kt:
        i = int(round(t * SR))
        j = min(N, i + L)
        e[i:j] = np.minimum(e[i:j], seg[: j - i])
    for k in buses:
        if k in s.bus:
            s.bus[k][0] *= e
            s.bus[k][1] *= e


# 1차 버스 표 기준 교정: 저음 −6 · 킥 −3 · 선율 +5 · 벽 +2 · 스네어 +3 · 햇 +3 (저역이 선율을 덮고 있었다: 60Hz 아래 16% · 300–3500Hz 14%)
GAINS = {"lead": 0.62, "xylo": 3.6, "wall": 0.34, "bass": 0.30, "kick": 0.62, "snare": 0.75, "hat": 0.28, "fx": 0.75, "crash": 1.0, "glock": 0.80, "mari": 1.5}
SECTIONS = [("HOOK", 0, 2), ("WALL", 2, 1), ("ITEM", 3, 1), ("SLOW", 4, 1), ("DROP", 5, 3), ("CLIMB", 8, 1), ("KILL", 9, 1), ("END", 10, 2)]


def main():
    s = Song(f"danmaku_{TAG}", "탄막 리메이크 BGM", bpm=BPM, bar=4, bars=BARS, swing=0.5, tail=0.0, lufs=LUFS_BED)
    s.N = TOTAL_N
    for name, b0, nb in SECTIONS:
        s.section(name, b0, nb)
    kt = drums(s)
    bass(s)
    walls(s)
    melody(s)
    accents(s)
    sidechain(s, kt, ("wall", "bass"))
    out = HERE / "out" / TAG
    rep = band.master(s, GAINS, rev_rt=0.9, rev_wet=0.16, out_dir=out, fade_out=0.5, tp_target=-1.5)
    rep["samples"] = TOTAL_N
    rep["pitch_shift_max"] = {k: v for k, v in band.SHIFT.items()}
    (out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=lambda o: float(o)), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in rep if k not in ("bus_x_section",)}, ensure_ascii=False, default=lambda o: float(o))[:1800])


if __name__ == "__main__":
    main()
