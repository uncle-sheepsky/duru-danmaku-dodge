"""사건 효과음 — 시각은 data/meta.json(엔진 실행값)과 config 마디표만 읽는다. 화면에 일어난 사건에서만 소리가 난다.
음높이는 그 마디 화음 안에서 고른다(BGM과 부딪히지 않게). 산출: mix/out/sfx.wav · sfx_report.json
사용: python remake/mix/build_sfx.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import sosfilt

HERE = Path(__file__).resolve().parent
R = HERE.parent


sys.path.insert(0, str(R / "bgm"))
from band import SR, m2f, nm, sos  # noqa: E402

M = json.loads((R / "data/meta.json").read_text(encoding="utf-8"))
FPS = 30
N = 768000
BAR_F = M["barF"]
BOMB_V, KILL_V = M["bombV"], M["killV"]
OUTRO_V = M["outroV"]
BAR_CHORD = {0: ("D5", "A5"), 1: ("Bb4", "F5"), 2: ("G4", "D5"), 3: ("C5", "G5"), 4: ("C5", "G5")}   # 빌드 마디 화음의 근음·5도
L = np.zeros(N)
Rr = np.zeros(N)
LOG = []


def put(y, v, gain=1.0, pan=0.0, name=""):
    i = int(round(v / FPS * SR))
    if i >= N:
        return
    y = y[: N - i] * gain
    a = (pan + 1) * np.pi / 4
    L[i:i + len(y)] += y * np.cos(a)
    Rr[i:i + len(y)] += y * np.sin(a)
    if name:
        LOG.append({"sfx": name, "frame": round(v, 2)})


def tone(m, dur, wave="sine", dec=None):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ph = 2 * np.pi * m2f(m) * t
    y = np.sin(ph) if wave == "sine" else np.sign(np.sin(ph)) * 0.5
    e = np.exp(-t / (dec or dur / 3)) * np.minimum(1, t / 0.0015)
    return y * e


def noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


def graze(seed):
    """스침 — 짧게 찌익. 음정 없음."""
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    return sosfilt(sos(3500, "highpass"), noise(n, seed)) * np.exp(-t / 0.014)


def coin(m0, m1):
    """1,000발 단위 넘을 때 — 두 음 칩(화음 안)."""
    a, b = tone(m0, 0.07, "pulse", 0.05), tone(m1, 0.22, "pulse", 0.09)
    y = np.zeros(len(a) + len(b))
    y[:len(a)] += a
    y[len(a):] += b
    return sosfilt(sos(7000, "lowpass"), y)


def sparkle(ms):
    gap = int(0.05 * SR)
    y = np.zeros(int(0.5 * SR) + gap * len(ms))
    for i, m in enumerate(ms):
        s = tone(m, 0.4, "sine", 0.12) + 0.3 * tone(m + 12, 0.4, "sine", 0.06)
        y[i * gap:i * gap + len(s)] += s
    return y


def near_ting():
    return tone(nm("C6"), 0.5, "sine", 0.14) + 0.4 * tone(nm("G6"), 0.5, "sine", 0.07)


def boom(dur, f0, seed, bright=1.0):
    """폭발 — 아래로 떨어지는 저음 + 터지는 노이즈. 방사 아닌 소리라 화면 금지 규칙과 무관."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f0 * (0.35 + 0.65 * np.exp(-t / 0.09))
    low = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (dur * 0.32))
    nz = noise(n, seed)
    mid = sosfilt(sos(5200, "lowpass"), sosfilt(sos(400, "highpass"), nz)) * np.exp(-t / (dur * 0.16))
    air = sosfilt(sos(4000, "highpass"), nz) * np.exp(-t / (dur * 0.1))
    y = 0.8 * low + 0.5 * mid * bright + 0.25 * air * bright
    return y * np.minimum(1, t / 0.001)


def swoosh(dur, seed):
    n = int(dur * SR)
    q = np.arange(n) / n
    z = noise(n, seed)
    y = sosfilt(sos(1800, "lowpass"), z) * (1 - q) + sosfilt(sos(2500, "highpass"), z) * q
    return y * np.sin(np.pi * q) ** 1.2


def crack(seed):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    rng = np.random.default_rng(seed)
    for i in range(7):
        k = int(rng.uniform(0, 0.05) * SR)
        m = min(n - k, int(0.012 * SR))
        y[k:k + m] += rng.uniform(0.5, 1.0) * sosfilt(sos(2200, "highpass"), rng.standard_normal(m)) * np.exp(-np.arange(m) / (0.003 * SR))
    return y * np.exp(-t / 0.05)


def chunk_tick(seed):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    f = rng.uniform(900, 1700)
    return np.sin(2 * np.pi * f * t) * np.exp(-t / 0.012)


def hit_blip(m):
    return sosfilt(sos(6000, "lowpass"), tone(m, 0.06, "pulse", 0.02))


def stamp():
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(70 + 90 * np.exp(-t / 0.02)) / SR) * np.exp(-t / 0.07) + 0.3 * sosfilt(sos(900, "highpass"), noise(n, 77)) * np.exp(-t / 0.02)


# ── 배치 ──
# 스침: 몰린 사건은 3프레임 안 하나로 묶는다(따닥거림 방지) · 뒤로 갈수록 크게
last = -99
gz = [v for v in M["grazePreBombV"] if v < BOMB_V]
for i, v in enumerate(gz):
    if v - last >= 3:
        put(graze(100 + i), v, gain=0.20 + 0.20 * i / max(1, len(gz) - 1), pan=-0.2 + 0.4 * (i % 2), name="graze")
        last = v
# 숫자 넘김: 화음 안 두 음(마디 안 위치에서 그 마디 화음)
for k, v in M["milestones"].items():
    a, b = BAR_CHORD[int(v // BAR_F)]
    put(coin(nm(a), nm(b)), v, gain=0.24, pan=0.45, name=f"count{k}")
# 아이템 등장: 위로 세 음(C 화음)
put(sparkle([nm("C6"), nm("E6"), nm("G6")]), M["itemV"], gain=0.20, pan=0.2, name="item")
# 최근접 순간(화면 표시선과 같은 프레임)
put(near_ting(), M["contMinV"], gain=0.26, name="nearest")
# 폭탄: 다운비트
put(boom(1.1, 95, 31), BOMB_V, gain=0.60, name="bomb")
put(swoosh(0.25, 33), BOMB_V, gain=0.20, pan=-0.4, name="cutin_in")
put(swoosh(0.22, 34), BOMB_V + 28, gain=0.15, pan=0.4, name="cutin_out")
# 명중: 약하게, 체력이 줄수록 음이 올라간다(드롭 화음과 무관한 F 펜타 안에서만)
PENTA = [nm(x) for x in "C5 D5 F5 G5 A5 C6 D6 F6".split()]
hits = [v for v in M["hits"] if v < KILL_V]
for i, v in enumerate(hits):
    if v < BOMB_V:
        continue                       # 봄 전 명중음은 끈다(탄막 긴장을 덮지 않게)
    put(hit_blip(PENTA[min(len(PENTA) - 1, int((i / len(hits)) * len(PENTA)))]), v, gain=0.055, pan=0.15 * ((i % 3) - 1))
LOG.append({"sfx": "hit_blip", "count": sum(1 for v in hits if v >= BOMB_V)})
# 격파
put(boom(1.5, 80, 41, 1.2), KILL_V, gain=0.70, name="kill")
put(crack(43), KILL_V, gain=0.32, name="crack")
for i in range(9):
    put(chunk_tick(50 + i), KILL_V + 10 + i * 3.4, gain=0.05, pan=-0.6 + 0.15 * i)
# 결과 글자
put(stamp(), OUTRO_V, gain=0.34, name="stat1")
put(stamp(), OUTRO_V + BAR_F / 2, gain=0.34, name="stat2")

st = np.stack([L, Rr], 1)
(HERE / "out").mkdir(exist_ok=True)
wavfile.write(HERE / "out/sfx.wav", SR, np.clip(st, -1, 1).astype(np.float32))
(HERE / "out/sfx_report.json").write_text(json.dumps({"events": LOG, "peak": float(np.abs(st).max())}, ensure_ascii=False, indent=0), encoding="utf-8")
print("효과음 사건", len(LOG), "피크", round(float(np.abs(st).max()), 3))
