"""BGM + 사건 효과음 → 최종 믹스 + 화면과 합치기. 대사 없음. 덕킹 없음(구간 이득도 없음).
게이트: 통합 −14.8~−14.0 LUFS · AAC 인코딩 뒤 트루피크 ≤ −1 dBTP · 프레임 480 · 꼬리 무음
사용: python remake/mix/final_mix.py --bgm v3 --video out/proto_silent.mp4 --out out/listen_v3.mp4
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
from scipy.io import wavfile
from scipy.signal import resample_poly

HERE = Path(__file__).resolve().parent
R = HERE.parent
SR = 48000
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
TAG, VIDEO, OUT = arg("--bgm", "v3"), R / arg("--video", "out/proto_silent.mp4"), R / arg("--out", "out/listen_v3.mp4")
SFX_DB = float(arg("--sfx-db", "0"))
TARGET = -14.4


def rd(p):
    sr, x = wavfile.read(p)
    assert sr == SR, sr
    if x.dtype == np.int16:
        x = x.astype(np.float64) / 32768.0
    return x.astype(np.float64)


def limiter(x, ceiling, look=0.003, rel=0.05):
    from scipy.ndimage import minimum_filter1d
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
    return x * out[:, None], float(20 * math.log10(out.min() + 1e-12))


def tp(x):
    return 20 * math.log10(np.abs(resample_poly(x, 4, 1, axis=0)).max() + 1e-12)


bgm = rd(R / "bgm/out" / TAG / "mix.wav")
sfx = rd(HERE / "out/sfx.wav")
assert len(bgm) == len(sfx) == 768000, (len(bgm), len(sfx))
raw = bgm + sfx * 10 ** (SFX_DB / 20)
m = pyln.Meter(SR)
ceil_db, gr = -1.9, 0.0
# 표본 상한을 시작값으로, 트루피크가 −1.4를 넘으면 넘은 만큼 낮춰 다시(AAC가 0.3~0.4 dB 더 키운다)
for _ in range(6):
    mix = raw.copy()
    for _ in range(4):
        mix *= 10 ** ((TARGET - m.integrated_loudness(mix)) / 20)
        mix, gr = limiter(mix, 10 ** (ceil_db / 20))
    if tp(mix) <= -1.4:
        break
    ceil_db -= (tp(mix) + 1.4) + 0.1
lufs, peak = m.integrated_loudness(mix), tp(mix)
(HERE / "out").mkdir(exist_ok=True)
wav = HERE / f"out/mix_{TAG}.wav"
wavfile.write(wav, SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))

subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(VIDEO), "-i", str(wav), "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(OUT)], check=True)
# 납품 후보를 다시 디코드해서 잰다(파이프 마지막 산출물 기준)
dec = HERE / "out/_dec.wav"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(OUT), "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(dec)], check=True)
d = rd(dec)
frames = int(subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(OUT)], capture_output=True, text=True).stdout.strip().strip(","))
tail = 20 * math.log10(np.sqrt(np.mean(d[-int(0.05 * SR):] ** 2)) + 1e-9)
rep = {"wav_lufs": round(lufs, 2), "wav_tp": round(peak, 2), "limiter_ceiling_db": round(ceil_db, 2), "limiter_max_gr_db": round(gr, 2), "aac_lufs": round(m.integrated_loudness(d), 2), "aac_tp": round(tp(d), 2), "frames": frames, "tail_db": round(tail, 1), "bgm": TAG, "sfx_db": SFX_DB}
rep["PASS"] = -14.8 <= rep["aac_lufs"] <= -14.0 and rep["aac_tp"] <= -1.0 and frames == 480 and tail < -40
(HERE / f"out/mix_{TAG}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
dec.unlink()
print(json.dumps(rep, ensure_ascii=False))
