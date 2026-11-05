"""흐물두루 플레이리스트 — 장난감 밴드 저수준 엔진(곡 빌더가 공용으로 쓰는 것만).

담는 것 = 샘플 재생(VSCO 2 CE · CC0)·버스/믹스·박→초 변환(박자·스윙)·악보 문자열 파서·코드 파서/보이싱·이 편 합성 악기·마스터·게이트.
담지 않는 것 = 화성·선율·편곡 — 곡마다 `tracks/tNN_*.py` 가 새로 쓴다(빌더 포크 금지 캐넌).
첫 곡 `build_bgm.py`(「흐물흐물 오후」, 승인본)는 이 엔진 이전에 만들어져 그대로 둔다.
"""
import json
import math
import os
import re
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt, welch


def find_root(p):
    for d in [p, *p.parents]:
        if (d / ".akashic-root").exists():
            return d
    return None   # 공개 저장소(센티넬 없음): 같은 폴더의 sfz_sampler.py + 환경변수 VSCO_SFZ_DIR


HERE = Path(__file__).resolve().parent
ROOT = None
sys.path.insert(0, str(HERE))
if ROOT:
    sys.path.insert(0, str(ROOT / "projects/duru/영상소스/assets/bgm"))
from sfz_sampler import load_sfz  # noqa: E402

VSCO = (Path(os.environ["VSCO_SFZ_DIR"]) if os.environ.get("VSCO_SFZ_DIR")
        else ROOT / "projects/duru/영상 제작 기초 자료/음원/VSCO-2-CE-SFZ" if ROOT else HERE / "VSCO-2-CE-SFZ")
SR = 48000


# ── 결정론 해시 ─────────────────────────────────────────────────────────────
def h01(*k):
    x = 0
    for v in k:
        x = (x * 1000003 + int(round(v * 1000))) & 0xFFFFFFFF
    x = (x ^ (x >> 16)) * 0x45D9F3B & 0xFFFFFFFF
    return ((x ^ (x >> 16)) & 0xFFFFFF) / 0xFFFFFF


def m2f(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def sos(fc, kind, order=2):
    return butter(order, fc, btype=kind, fs=SR, output="sos")


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


# ── 표기 ────────────────────────────────────────────────────────────────────
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def nm(name):
    """'C#5' · 'Bb3' → MIDI."""
    m = re.fullmatch(r"([A-G])([#b]*)(-?\d)", name)
    if not m:
        raise ValueError(name)
    return 12 * (int(m.group(3)) + 1) + PC[m.group(1)] + m.group(2).count("#") - m.group(2).count("b")


def line(s, bar=None, start=0.0):
    """악보 한 줄 → [(박, 길이, midi)]. 토큰 'C5:1' · 'r:.5'(쉼) · '|' 마디선(bar 주면 마디 길이 검사).
    길이는 박 단위 분수 허용('1/3')."""
    out, t, acc = [], start, 0.0
    for tok in s.split():
        if tok == "|":
            if bar is not None and abs(acc - bar) > 1e-6:
                raise ValueError(f"마디 길이 {acc} ≠ {bar} — near beat {t}: {s[:60]}")
            acc = 0.0
            continue
        n, d = tok.split(":")
        d = float(eval(d, {}, {}))
        if n != "r":
            out.append((t, d, nm(n)))
        t += d
        acc += d
    if bar is not None and acc > 1e-6 and abs(acc - bar) > 1e-6:
        raise ValueError(f"마지막 마디 길이 {acc} ≠ {bar}: {s[-60:]}")
    return out


def shift(notes, beats=0.0, semis=0):
    return [(b + beats, d, m + semis) for b, d, m in notes]


QUAL = {
    "": (0, 4, 7), "m": (0, 3, 7), "7": (0, 4, 7, 10), "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "6": (0, 4, 7, 9),
    "m6": (0, 3, 7, 9), "dim": (0, 3, 6), "dim7": (0, 3, 6, 9), "aug": (0, 4, 8), "+": (0, 4, 8), "m7b5": (0, 3, 6, 10),
    "add9": (0, 4, 7, 14), "sus4": (0, 5, 7), "9": (0, 4, 7, 10, 14), "maj9": (0, 4, 7, 11, 14), "7b9": (0, 4, 7, 10, 13),
    "madd9": (0, 3, 7, 14), "m9": (0, 3, 7, 10, 14), "7sus4": (0, 5, 7, 10), "69": (0, 4, 7, 9, 14),
}


def chord(sym):
    """'F#m7/C#' → (근음 pc, 구성음 pc 오프셋 튜플, 베이스 pc)."""
    m = re.fullmatch(r"([A-G][#b]?)([^/]*)(?:/([A-G][#b]?))?", sym)
    if not m:
        raise ValueError(sym)
    r = (PC[m.group(1)[0]] + m.group(1)[1:].count("#") - m.group(1)[1:].count("b")) % 12
    q = QUAL[m.group(2)]
    b = r if not m.group(3) else (PC[m.group(3)[0]] + m.group(3)[1:].count("#") - m.group(3)[1:].count("b")) % 12
    return r, q, b


def voice(sym, lo, hi, prev=None, n=None):
    """코드를 [lo, hi] 안의 밀집 보이싱으로. prev 가 있으면 성부 이동 합이 가장 작은 자리바꿈."""
    r, q, _ = chord(sym)
    pcs = sorted({(r + x) % 12 for x in q})
    if n:
        pcs = pcs[:n] if len(pcs) >= n else pcs
    cands = []
    for base in range(lo - 12, hi + 1):
        if base % 12 not in pcs:
            continue
        v = [base]
        for _ in range(len(pcs) - 1):
            nxt = v[-1] + 1
            while nxt % 12 not in pcs or nxt % 12 in [x % 12 for x in v]:
                nxt += 1
            v.append(nxt)
        if v[0] >= lo and v[-1] <= hi:
            cands.append(v)
    if not cands:
        raise ValueError(f"보이싱 불가 {sym} [{lo},{hi}]")
    if prev:
        return min(cands, key=lambda v: (sum(min(abs(a - b) for b in prev) for a in v), v[0]))
    return min(cands, key=lambda v: abs((v[0] + v[-1]) / 2 - (lo + hi) / 2))


def bass_note(sym, lo=28, hi=48, which="root"):
    r, q, b = chord(sym)
    pc = b if which == "root" else ((r + 7) % 12 if which == "fifth" else (r + q[1]) % 12)
    m = lo + ((pc - lo) % 12)
    return m if m <= hi else m - 12


# ── 곡(시간 축) ─────────────────────────────────────────────────────────────
class Song:
    """bpm = 박(beat)당 분당 수. bar = 마디당 박 수. swing = 박의 앞 반쪽 비율(0.5 = 스트레이트).
    복합박(6/8·9/8·12/8)은 점4분을 박으로 잡고 셋잇단 분할(swing 없음)."""

    def __init__(self, tag, title, bpm, bar, bars, swing=0.5, tail=3.0, lufs=-14.0):
        self.tag, self.title, self.bpm, self.bar, self.bars, self.swing, self.lufs = tag, title, bpm, bar, bars, swing, lufs
        self.beat = 60.0 / bpm
        self.music_s = bars * bar * self.beat
        self.N = int((self.music_s + tail) * SR)
        self.bus = {}
        self.rev = None
        self.sections = []
        self.meta = {}

    def pos(self, b):
        k = math.floor(b + 1e-9)
        fr = b - k
        sw = self.swing
        if sw != 0.5:
            fr = fr / 0.5 * sw if fr < 0.5 else sw + (fr - 0.5) / 0.5 * (1 - sw)
        return (k + fr) * self.beat

    def B(self, bar, beat=0.0):
        return bar * self.bar + beat

    def get(self, name):
        if name not in self.bus:
            self.bus[name] = [np.zeros(self.N), np.zeros(self.N)]
        return self.bus[name]

    def add(self, name, y, t, pan=0.0, gain=1.0, send=0.0):
        i = int(round(t * SR))
        if i >= self.N:
            return
        if i < 0:
            y, i = y[-i:], 0
        y = y[: self.N - i] * gain
        a = (pan + 1) * math.pi / 4
        L, R = self.get(name)
        L[i:i + len(y)] += y * math.cos(a)
        R[i:i + len(y)] += y * math.sin(a)
        if send:
            L, R = self.get("_rev")
            L[i:i + len(y)] += y * math.cos(a) * send
            R[i:i + len(y)] += y * math.sin(a) * send

    def section(self, name, bar0, nbars):
        self.sections.append((name, bar0, nbars))


# ── VSCO 샘플 재생기(48k) — 속도 레이어 고정·라운드로빈·릴리즈 컷 ─────────────
_SFZ, _WAV = {}, {}
SHIFT = {}
OCT = {"Glockenspiel": -12, "Xylophone": -12, "PiccoloStac": -12, "PiccoloSus": -12}   # 표기보다 한 옥타브 위로 울림(실측)
CENT = {"ClarinetStac": 14}


def sfz(name):
    if name not in _SFZ:
        _SFZ[name] = load_sfz(str(next(VSCO.rglob(f"{name}.sfz"))))
    return _SFZ[name]


def wav(path):
    if path not in _WAV:
        sr, d = wavfile.read(path)
        dt = d.dtype
        d = d.astype(np.float64)
        if d.ndim > 1:
            d = d.mean(1)
        d /= {np.dtype(np.int16): 32768.0, np.dtype(np.int32): 2147483648.0}.get(dt, 1.0)
        if sr != SR:
            g = math.gcd(SR, sr)
            d = resample_poly(d, SR // g, sr // g)
        _WAV[path] = d
    return _WAV[path]


def region(name, midi, vel, rr):
    s = sfz(name)
    regs = [r for r in s["regions"] if r["lovel"] <= vel <= r["hivel"]] or s["regions"]
    best = min(abs(r["pk"] - midi) for r in regs)
    c = [r for r in regs if abs(r["pk"] - midi) == best]
    c = [r for r in c if r["lokey"] <= midi <= r["hikey"]] or c
    r = c[rr % len(c)]
    SHIFT[name] = max(SHIFT.get(name, 0), abs(midi - r["pk"]))
    return s, r


def sample_note(name, midi, dur, vel=96, rr=0, release=0.08, attack=0.0):
    midi = midi + OCT.get(name, 0)
    s, r = region(name, midi, vel, rr)
    src = wav(os.path.join(s["base"], s["dpath"], r["sample"]))
    ratio = 2 ** (((midi - r["pk"]) + (r["tune"] + CENT.get(name, 0)) / 100) / 12)
    n = int((dur + release) * SR)
    idx = np.arange(n) * ratio
    idx = idx[idx < len(src) - 1]
    i0 = idx.astype(int)
    fr = idx - i0
    y = np.pad(src[i0] * (1 - fr) + src[i0 + 1] * fr, (0, n - len(idx)))
    if attack > 0:
        a = int(attack * SR)
        y[:a] *= np.linspace(0, 1, a) ** 2
    k0 = int(dur * SR)
    y[k0:] *= np.linspace(1, 0, n - k0) ** 2
    return y * 10 ** (r["volume"] / 20)


def glide_note(name, m0, m1, dur, g0, g1, vel=96, release=0.15):
    """지속음 샘플을 음높이 곡선(m0→m1, g0~g1초 구간)으로 읽는다."""
    s, r = region(name, m0 + OCT.get(name, 0), vel, 0)
    src = wav(os.path.join(s["base"], s["dpath"], r["sample"]))
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    q = np.clip((t - g0) / max(1e-3, g1 - g0), 0, 1)
    q = q * q * (3 - 2 * q)
    m = m0 + OCT.get(name, 0) + (m1 - m0) * q
    ratio = 2 ** ((m - r["pk"] + r["tune"] / 100) / 12)
    idx = np.cumsum(ratio)
    idx = idx[idx < len(src) - 1]
    i0 = idx.astype(int)
    fr = idx - i0
    y = np.pad(src[i0] * (1 - fr) + src[i0 + 1] * fr, (0, n - len(idx)))
    k0 = int(dur * SR)
    y[k0:] *= np.linspace(1, 0, n - k0) ** 2
    return y * 10 ** (r["volume"] / 20)


def inst(song, bus, name, midi, b, dur_b, vel=96, amp=1.0, pan=0.0, send=0.15, human=0.006, rel=0.08, attack=0.0):
    rr = int(h01(b, midi, len(name)) * 97) + 1
    y = sample_note(name, midi, dur_b * song.beat, vel=vel, rr=rr, release=rel, attack=attack)
    y *= amp * (0.9 + 0.1 * h01(midi, b, 3))
    t = song.pos(b) + (h01(b, midi, 7) * 2 - 1) * human
    song.add(bus, y, t, pan=pan, send=send)


def play(song, bus, name, notes, at=0.0, semis=0, stac=1.0, **kw):
    for b, d, m in notes:
        inst(song, bus, name, m + semis, at + b, d * stac, **kw)


def perc(song, key, b, amp=1.0, pan=0.0, vel=100, send=0.06, dur=1.2, human=0.004, bus="perc"):
    s = sfz("GM-StylePerc")
    regs = [r for r in s["regions"] if r["lokey"] <= key <= r["hikey"]]
    lay = [r for r in regs if r["lovel"] <= vel <= r["hivel"]] or regs
    r = lay[int(h01(b, key) * 997) % len(lay)]
    y = wav(os.path.join(s["base"], s["dpath"], r["sample"]))[: int(dur * SR)].copy()
    k = min(len(y), int(0.04 * SR))
    y[-k:] *= np.linspace(1, 0, k)
    y *= amp * 10 ** (r["volume"] / 20)
    t = song.pos(b) + (h01(b, key, 5) * 2 - 1) * human
    song.add(bus, y, t, pan=pan, send=send)


# ── 이 편 합성 악기(48k) ────────────────────────────────────────────────────
def env_ar(n, a, r):
    e = np.ones(n)
    ka, kr = min(n, int(a * SR)), min(n, int(r * SR))
    if ka:
        e[:ka] = np.linspace(0, 1, ka)
    if kr:
        e[n - kr:] *= np.linspace(1, 0, kr)
    return e


def music_box(freq, dur=1.6, amp=1.0):
    """오르골 빗살: 기음 + 약한 2배음 + 빨리 죽는 비조화 5.4배음 + 클릭."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * freq * t) * np.exp(-t / 1.1) + 0.28 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t / 0.45)
         + 0.16 * np.sin(2 * np.pi * 5.4 * freq * t) * np.exp(-t / 0.09))
    y[:24] += np.linspace(0.5, 0, 24)
    return y * env_ar(n, 0.001, 0.05) * amp * 0.5


def celesta(freq, dur=1.8, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = (np.sin(2 * np.pi * freq * t) * np.exp(-t / 1.4) + 0.22 * np.sin(2 * np.pi * 4.0 * freq * t) * np.exp(-t / 0.25)
         + 0.08 * np.sin(2 * np.pi * 3.0 * freq * t) * np.exp(-t / 0.6))
    return y * env_ar(n, 0.002, 0.08) * amp * 0.5


_KS = {}


def ks_pluck(midi, dur, bright=0.5, decay=0.996, body=True):
    """카플러스-스트롱 줄 뜯기(우쿨렐레·나일론 기타·밴조). 주기 블록 단위 벡터 연산 · (음,길이,밝기) 캐시."""
    key = (midi, round(dur, 3), bright, decay, body)
    if key in _KS:
        return _KS[key]
    f = m2f(midi)
    P = SR / f - 0.5          # 두 점 평균 저역통과가 반 샘플 지연을 더한다 → 주기에서 뺀다
    Ni = int(P)
    frac = P - Ni
    n = int(dur * SR)
    rng = np.random.default_rng(int(midi * 1000 + bright * 100))
    exc = rng.uniform(-1, 1, Ni + 2)
    exc = sosfilt(sos(min(0.45 * SR, 1200 + 9000 * bright), "lowpass"), exc)
    y = np.zeros(n + Ni + 2)
    y[:Ni + 2] = exc
    i = Ni + 1
    while i < len(y):
        j = min(len(y), i + Ni)
        k = np.arange(i, j)
        a = y[k - Ni] * (1 - frac) + y[k - Ni - 1] * frac
        b = y[k - Ni - 1] * (1 - frac) + y[k - Ni - 2] * frac
        y[k] = decay * (0.5 * (a + b))
        i = j
    y = y[Ni + 2:Ni + 2 + n]
    if body:
        y = y + 0.5 * bp(y, 180, 420) + 0.25 * bp(y, 900, 1600)
    y *= env_ar(n, 0.0005, 0.03)
    y = y / (np.abs(y).max() + 1e-9)
    _KS[key] = y
    return y


def reed(freq, dur, amp=1.0, vib=0.006, bright=2600):
    """멜로디카(리드): 톱니 + 저역통과 + 늦게 오는 비브라토."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + vib * np.clip((t - 0.2) / 0.3, 0, 1) * np.sin(2 * np.pi * 5.2 * t))
    ph = np.cumsum(f / SR) % 1.0
    y = 2 * ph - 1 + 0.4 * np.sign(np.sin(2 * np.pi * ph))
    y = sosfilt(sos(bright, "lowpass", 2), y)
    return y * env_ar(n, 0.03, 0.06) * amp * 0.35


def steelpan(freq, dur=1.2, amp=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    bend = 1 + 0.004 * np.exp(-t / 0.03)
    y = sum(a * np.sin(2 * np.pi * k * freq * bend * t) * np.exp(-t / dd) for k, a, dd in
            ((1, 1.0, 0.9), (2, 0.55, 0.5), (3, 0.3, 0.3), (4.02, 0.14, 0.15)))
    return y * env_ar(n, 0.004, 0.06) * amp * 0.4


def polyblep_saw(phase_inc):
    ph = np.cumsum(phase_inc) % 1.0
    y = 2 * ph - 1
    dt = phase_inc
    m1 = ph < dt
    t1 = ph[m1] / dt[m1]
    y[m1] -= t1 + t1 - t1 * t1 - 1
    m2 = ph > 1 - dt
    t2 = (ph[m2] - 1) / dt[m2]
    y[m2] -= t2 * t2 + t2 + t2 + 1
    return y


def kazoo_phrase(notes, seed=0):
    """notes = [(t0초, dur초, midi)]. 허밍 톱니 → 막 떨림 → 포먼트 → 숨 · 4.8k 저역통과(치찰 정리)."""
    t_end = max(t0 + d for t0, d, _ in notes) + 0.12
    n = int(t_end * SR)
    t = np.arange(n) / SR
    f = np.full(n, m2f(notes[0][2]))
    amp = np.zeros(n)
    vib_env = np.zeros(n)
    for t0, d, m in notes:
        a, b_ = int(t0 * SR), int((t0 + d) * SR)
        f[a:] = m2f(m)
        seg = np.arange(b_ - a) / SR
        env = np.minimum(1, seg / 0.018) * np.minimum(1, (d - seg) / 0.035).clip(0, 1)
        amp[a:b_] = np.maximum(amp[a:b_], env)
        k = min(b_ - a, int(0.045 * SR))
        f[a:a + k] *= 2 ** (-0.45 / 12 * (1 - np.arange(k) / k))
        vib_env[a:b_] = np.clip((seg - 0.15) / 0.25, 0, 1)
    w = int(0.025 * SR)
    f = np.convolve(np.pad(f, (w, w), mode="edge"), np.ones(w) / w, mode="same")[w:-w]
    f *= 2 ** (0.14 / 12 * vib_env * np.sin(2 * np.pi * 5.6 * t + seed))
    src = polyblep_saw(f / SR)
    buzz = np.tanh(2.6 * src + 0.35 * src ** 2)
    y = (1.0 * bp(buzz, 520, 780) + 0.75 * bp(buzz, 980, 1350) + 0.45 * bp(buzz, 2300, 3100)
         + 0.10 * sosfilt(sos(3500, "highpass"), buzz))
    rng = np.random.default_rng(seed + 11)
    y += 0.035 * bp(rng.standard_normal(n), 2500, 6000) * amp
    y = sosfilt(sos(4800, "lowpass", 4), y) * amp
    return y / (np.abs(y).max() + 1e-9)


def whistle_phrase(notes, seed=0):
    """사람 휘파람: 사인 + 얕은 비브라토 + 숨 소리, 음 사이 짧은 포르타멘토."""
    t_end = max(t0 + d for t0, d, _ in notes) + 0.1
    n = int(t_end * SR)
    t = np.arange(n) / SR
    f = np.full(n, m2f(notes[0][2]))
    amp = np.zeros(n)
    for t0, d, m in notes:
        a, b_ = int(t0 * SR), int((t0 + d) * SR)
        f[a:] = m2f(m)
        seg = np.arange(b_ - a) / SR
        amp[a:b_] = np.maximum(amp[a:b_], np.minimum(1, seg / 0.03) * np.minimum(1, (d - seg) / 0.05).clip(0, 1))
    w = int(0.03 * SR)
    f = np.convolve(np.pad(f, (w, w), mode="edge"), np.ones(w) / w, mode="same")[w:-w]
    f *= 1 + 0.004 * np.sin(2 * np.pi * 5.0 * t + seed)
    ph = 2 * np.pi * np.cumsum(f) / SR
    rng = np.random.default_rng(seed + 5)
    y = np.sin(ph) + 0.05 * np.sin(2 * ph) + 0.05 * bp(rng.standard_normal(n), 2000, 7000)
    return y * amp * 0.6


def slide_whistle(m0, m1, dur, seed=0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    q = t / dur
    m = m0 + (m1 - m0) * (q * q * (3 - 2 * q))
    f = m2f(m) * 2 ** (0.12 / 12 * np.sin(2 * np.pi * 6.2 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.08 * np.sin(2 * ph)
    rng = np.random.default_rng(seed + 3)
    y += 0.06 * bp(rng.standard_normal(n), 1500, 5000)
    env = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.06).clip(0, 1)
    return y * env * 0.5


def sfx_pop():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    f = 500 + 1400 * (1 - np.exp(-t / 0.012))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035)
    y[:40] += np.linspace(0.8, 0, 40)
    return y * 0.6


def boing(dur=0.5):
    """입 하프 '보잉' — 펄스열 + 공명 필터를 쓸어 올렸다 내림."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f0 = 98
    ph = (np.cumsum(np.full(n, f0 / SR))) % 1.0
    src = (ph < 0.12).astype(float) - 0.12
    out = np.zeros(n)
    blk = 480
    for i in range(0, n, blk):
        q = i / n
        fc = 500 + 1800 * math.sin(math.pi * min(1, q * 1.6)) ** 2
        out[i:i + blk] = bp(src[max(0, i - 2000):i + blk], fc * 0.85, fc * 1.15)[-len(src[i:i + blk]):]
    return out / (np.abs(out).max() + 1e-9) * np.exp(-t / (dur * 0.6)) * 0.5


# ── 마스터 · 게이트 ─────────────────────────────────────────────────────────
def room_ir(rt=1.1, seed=5, lp=5200):
    n = int(rt * 1.2 * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    env = np.exp(-6.9 * t / rt)
    L = sosfilt(sos(lp, "lowpass"), rng.standard_normal(n) * env)
    R = sosfilt(sos(lp, "lowpass"), rng.standard_normal(n) * env)
    pre = int(0.015 * SR)
    L = np.pad(L, (pre, 0))[:n]
    R = np.pad(R, (pre, 0))[:n]
    return L / np.sqrt((L ** 2).sum()), R / np.sqrt((R ** 2).sum())


def limiter(x, ceiling=0.89, look=0.004, rel=0.06):
    a = np.abs(x).max(1)
    g = np.minimum(1, ceiling / np.maximum(a, 1e-9))
    w = int(look * SR)
    g = minimum_filter1d(g, size=2 * w + 1, origin=-w // 2)
    coef = math.exp(-1 / (rel * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i, v in enumerate(g):
        cur = v if v < cur else v + (cur - v) * coef
        out[i] = cur
    out = np.convolve(np.pad(out, (w, w), mode="edge"), np.ones(w) / w, mode="same")[w:-w]
    return x * out[:, None]


def true_peak_db(x):
    return 20 * np.log10(np.abs(resample_poly(x, 4, 1, axis=0)).max() + 1e-12)


def master(song, gains, rev_rt=1.1, rev_wet=0.30, out_dir=None, fade_out=0.0, extra=None, tp_target=-1.0):
    """버스 합 → 리버브 → 고역통과 35Hz → 목표 LUFS 정규화 + 룩어헤드 리미터(트루피크 ≤ tp_target) → wav · stems · report.
    tp_target: AAC 인코딩이 피크를 키우는 곡(날카로운 합성 어택)은 더 낮게 — T08 실측 −1.2 → AAC 후 −0.03."""
    N = song.N
    irL, irR = room_ir(rev_rt)
    L = np.zeros(N)
    R = np.zeros(N)
    for k, gn in gains.items():
        if k in song.bus:
            L += song.bus[k][0] * gn
            R += song.bus[k][1] * gn
    if "_rev" in song.bus:
        L += rev_wet * fftconvolve(song.bus["_rev"][0], irL)[:N]
        R += rev_wet * fftconvolve(song.bus["_rev"][1], irR)[:N]
    st = sosfilt(sos(35, "highpass", 4), np.stack([L, R], 1), axis=0)
    if fade_out > 0:
        k0 = int((song.music_s - fade_out) * SR)
        k1 = int(song.music_s * SR)
        env = np.ones(N)
        env[k0:k1] = np.linspace(1, 0, k1 - k0) ** 1.5
        env[k1:] = 0
        st *= env[:, None]
    meter = pyln.Meter(SR)
    raw, ceil = st, -1.7                               # 표본 상한 −1.7dB 에서 시작 → 트루피크가 −1.0 을 넘으면 넘은 만큼 더 낮춰 다시
    for _ in range(4):
        st = raw.copy()
        for _ in range(3):
            lufs = meter.integrated_loudness(st)
            st *= 10 ** ((song.lufs - lufs) / 20)
            st = limiter(st, ceiling=10 ** (ceil / 20))
        tp = true_peak_db(st)
        if tp <= tp_target:
            break
        ceil -= (tp - tp_target) + 0.2
    lufs = meter.integrated_loudness(st)
    song.meta["limiter_ceiling_db"] = round(ceil, 2)
    out = Path(out_dir or HERE / "out" / song.tag)
    (out / "stems").mkdir(parents=True, exist_ok=True)
    wavfile.write(out / "mix.wav", SR, (np.clip(st, -1, 1) * 32767).astype(np.int16))
    for k in gains:
        if k in song.bus:
            s = np.stack(song.bus[k], 1)
            wavfile.write(out / "stems" / f"{k}.wav", SR, (np.clip(s / max(1e-9, np.abs(s).max()) * 0.9, -1, 1) * 32767).astype(np.int16))
    secs = {}
    for name, b0, nb in song.sections:
        a, b = int(song.pos(b0 * song.bar) * SR), int(song.pos((b0 + nb) * song.bar) * SR)
        try:
            secs[name] = round(meter.integrated_loudness(st[a:b]), 1)
        except Exception:
            secs[name] = None
    # 16분(박의 1/4) 창 평균 레이어 수 — 역할당 한 명 점검
    layers = []
    keys = [k for k in gains if k in song.bus]
    step = song.beat / 4
    q = 0.0
    while q < song.music_s - step:
        a, b = int(q * SR), int((q + step) * SR)
        r = [np.sqrt(np.mean((song.bus[k][0][a:b] * gains[k]) ** 2)) + 1e-12 for k in keys]
        mx = max(r)
        if mx > 1e-5:
            layers.append(sum(1 for v in r if 20 * math.log10(v / mx) > -18))
        q += step
    # 버스×섹션 라우드니스(이득 적용 후·정규화 전 상대값) — 균형 조정용
    busx = {}
    for k in keys:
        row = {}
        for name, b0, nb in song.sections:
            a_, b_ = int(song.pos(b0 * song.bar) * SR), int(song.pos((b0 + nb) * song.bar) * SR)
            x = np.stack([song.bus[k][0][a_:b_], song.bus[k][1][a_:b_]], 1) * gains[k]
            try:
                v = meter.integrated_loudness(x)
                row[name] = round(v, 1) if v > -70 else None
            except Exception:
                row[name] = None
        busx[k] = row
    fq, p = welch(st.mean(1), SR, nperseg=8192)
    rep = {"tag": song.tag, "title": song.title, "bpm": song.bpm, "bar_beats": song.bar, "bars": song.bars,
           "swing": song.swing, "music_s": round(song.music_s, 3), "dur_s": round(N / SR, 3), "lufs": round(lufs, 2),
           "true_peak_db": round(tp, 2), "section_lufs": secs, "layers_mean": round(float(np.mean(layers)), 2),
           "layers_max": int(max(layers)), "below60Hz_share": round(float(p[fq < 60].sum() / p.sum()), 4),
           "max_resample_semitones": dict(SHIFT), "bus_section_lufs": busx, **song.meta, **(extra or {})}
    (out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("tag", "music_s", "lufs", "true_peak_db", "section_lufs", "layers_mean", "layers_max")}))
    if "--bus" in sys.argv:
        for k, row in busx.items():
            print(f"  {k:6s}", " ".join(f"{n}:{v}" for n, v in row.items()))
    return rep
