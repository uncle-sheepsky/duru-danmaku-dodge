# 경량 SFZ 샘플러 — .sfz 파싱 → 실제 녹음 샘플(WAV)을 음정 맞춰 재생. 결정론·플러그인 불요.
# VSCO-2-CE-SFZ(CC0) 솔로 바이올린 등 재생용. 지원: region(sample·lokey·hikey·pitch_keycenter·
#   lovel·hivel·volume·tune), <control>default_path, <global>ampeg_attack/release. (루프 미지원=짧은 음용.)
import re, os, numpy as np
from scipy.io import wavfile
SR = 44100
_CACHE = {}

def _load(p):
    if p in _CACHE: return _CACHE[p]
    sr, d = wavfile.read(p); dt = d.dtype; d = d.astype(np.float64)
    if d.ndim > 1: d = d.mean(1)
    if dt == np.int16: d /= 32768.0               # 비트뎁스별 정규화(VSCO=int32 24비트 다수)
    elif dt == np.int32: d /= 2147483648.0
    elif dt == np.uint8: d = (d - 128) / 128.0    # float32/64는 이미 -1..1 가정
    if sr != SR:                                  # 리샘플(샘플레이트 정규화)
        idx = np.arange(0, len(d), sr/SR); d = np.interp(idx, np.arange(len(d)), d)
    _CACHE[p] = d; return d

def load_sfz(path):
    txt = open(path, encoding='utf-8', errors='ignore').read()
    base = os.path.dirname(path)
    mp = re.search(r'default_path=([^\n<]+)', txt)
    dpath = mp.group(1).strip().replace('\\', '/') if mp else ''
    head = txt.split('<region>')[0]
    def gf(k, d):
        m = re.search(k+r'\s*=\s*([\d.]+)', head); return float(m.group(1)) if m else d
    atk, rel = gf('ampeg_attack', 0.005), gf('ampeg_release', 0.4)
    regions = []
    for blk in txt.split('<region>')[1:]:
        blk = re.split(r'<\w+>', blk)[0]
        def f(k, cast=float, d=None):
            m = re.search(k+r'\s*=\s*([^\s/]+)', blk); return cast(m.group(1)) if m else d
        samp = f('sample', str, None)
        if not samp: continue
        pk = f('pitch_keycenter', int, None)
        if pk is None: pk = f('key', int, 60)
        regions.append(dict(sample=samp.strip().replace('\\', '/'),
                            lokey=f('lokey', int, pk), hikey=f('hikey', int, pk), pk=pk,
                            lovel=f('lovel', int, 0), hivel=f('hivel', int, 127),
                            volume=f('volume', float, 0.0), tune=f('tune', float, 0.0)))
    return dict(base=base, dpath=dpath, atk=atk, rel=rel, regions=regions)

def _pick(sfz, midi, vel):
    cands = [r for r in sfz['regions'] if r['lokey'] <= midi <= r['hikey'] and r['lovel'] <= vel <= r['hivel']]
    if not cands:
        cands = [r for r in sfz['regions'] if r['lokey'] <= midi <= r['hikey']]
    if not cands:
        cands = sorted(sfz['regions'], key=lambda r: abs(r['pk']-midi))[:1]
    # 음정차 가장 작은 것
    return min(cands, key=lambda r: abs(r['pk']-midi)) if cands else None

def note(sfz, midi, dur, vel=100, amp=1.0, swell=0.0, rr=0, legato_tail=0.0):
    """swell: 0~1, 음 앞부분 비율만큼 활이 부풂(보잉 스웰). rr: 시드(미세 디튠·시작오프셋=머신건 방지).
    legato_tail: 릴리즈를 짧게(다음 음과 잇기). """
    r = _pick(sfz, midi, vel)
    if r is None: return np.zeros(int(dur*SR))
    p = os.path.join(sfz['base'], sfz['dpath'], r['sample'])
    if not os.path.exists(p): return np.zeros(int(dur*SR))
    src = _load(p)
    detune = 0.0; off = 0
    if rr:                                                  # 미세 변주(±4 cent, ±5ms 시작)
        g = np.random.default_rng(rr); detune = (g.random()*2-1)*0.04; off = int(g.random()*0.005*SR)
    semis = (midi - r['pk']) + r['tune']/100.0 + detune
    ratio = 2.0**(semis/12.0)
    idx = np.arange(off*ratio, len(src), ratio)
    s = np.interp(idx, np.arange(len(src)), src)
    n = int(dur*SR)
    if len(s) < n: s = np.pad(s, (0, n-len(s)))
    else: s = s[:n].copy()
    a = max(1, int(sfz['atk']*SR))
    if swell > 0:                                           # 보잉 스웰(부드러운 부풂)
        sw = max(a, int(swell*n)); ramp = np.sin(np.linspace(0, np.pi/2, min(sw, n)))**2
        s[:len(ramp)] *= ramp
    elif n > a:
        s[:a] *= np.linspace(0, 1, a)
    rel = min(sfz['rel'], dur*0.5) if legato_tail <= 0 else legato_tail
    rl = max(1, int(rel*SR))
    if n > rl: s[-rl:] *= np.linspace(1, 0, rl)
    gain = 10**(r['volume']/20.0)
    return amp*gain*s

if __name__ == '__main__':
    import sys
    sfz = load_sfz(sys.argv[1])
    print('regions:', len(sfz['regions']), 'dpath:', sfz['dpath'], 'atk', sfz['atk'], 'rel', sfz['rel'])
    print('key range:', min(r['lokey'] for r in sfz['regions']), '-', max(r['hikey'] for r in sfz['regions']))
    # 테스트: C5(72) 1.2초
    out = note(sfz, 72, 1.2, vel=100)
    wavfile.write('_sfztest.wav', SR, (np.clip(out, -1, 1)*0.9*32767).astype(np.int16))
    print('wrote _sfztest.wav  %.2fs peak %.3f' % (len(out)/SR, np.max(np.abs(out))))
