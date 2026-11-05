# 한 발만 맞아도 끝나는 탄막 3,490발 — 코드 전체

「아낌없이 주는 두루」 쇼츠의 소스입니다. 

- 1080×1920 · 30fps · **480프레임 = 16.000초** · 180BPM 12마디
- 영상 편집 프로그램을 쓰지 않습니다. 브라우저가 캔버스에 **한 프레임씩 그립니다.**
- 라이선스 **CC0**. 그림은 빠져 있습니다(아래 「이 저장소에 없는 것」).

## 바로 돌려 보기

Node 하나면 됩니다. 설치할 것이 없습니다.

```bash
node remake/tools/verify.mjs
```

영상의 숫자를 엔진에서 다시 잽니다. 이 저장소를 만들 때 나온 값입니다.

```text
PASS  V1 결정론  ad9f386f0bab6564
PASS  V2 시크 왕복  40지점
PASS  V3 peak  3490발
PASS  V4 틱 판정 무피격  틱 최소 13.36px ≥ 판정 12px
PASS  V5 연속 판정 무피격  최소 12.857px · 여유 0.86px · t=6.8292s
PASS  V6 옛 값 반례  틱 15.57px 통과 · 틱 사이 6.70px < 12px
PASS  V7 격파  명중 117번째 · t=12.1667s
PASS  V8 화면 시간표  V199=3490발 · V200=0발 · 12마디 480f

8/8 통과
```

브라우저로 게임 보기:

```bash
python -m http.server 8000
```

그다음 `http://localhost:8000/viewer.html` 을 엽니다. 탄·기체 위치는 엔진 값이고, 그림만 동그라미입니다. 「최근접 순간」 버튼이 0.86px 장면입니다.

## 영상과 같은 순서로 다시 만들기

그림은 자리표시로 나옵니다. 같은 이름의 PNG로 바꿔 넣으면 그대로 돌아갑니다.

```bash
npm i playwright gsap
npx playwright install chromium
pip install numpy scipy pillow pyloudnorm
cp node_modules/gsap/dist/gsap.min.js remake/
# Jua 글꼴(Google Fonts)을 remake/assets/fonts/Jua-Regular.ttf 로 내려받기
node remake/tools/export_meta.mjs
python remake/tools/make_placeholders.py
python remake/tools/bake_text.py
node remake/render.mjs --pass a --workers 6 --out out/video.mp4
node remake/render.mjs --pass b --workers 4 --sha-only
```

`remake/gates/pix_a.json` 과 `pix_b.json` 은 프레임별 픽셀 해시입니다. 워커 수를 바꿔 두 번 그려도 같아야 합니다.

음악과 효과음(VSCO 2 CE 샘플 필요):

```bash
export VSCO_SFZ_DIR=/path/to/VSCO-2-CE-SFZ
python remake/bgm/build_bgm.py --tag v3
python remake/mix/build_sfx.py
python remake/mix/final_mix.py --bgm v3 --video out/video.mp4 --out out/final.mp4
```

음악은 다시 빌드해도 같은 파일이 나옵니다. `remake/bgm/out/v3/mix.wav` sha256 앞자리 `d075c4c110e67a0f`.

## 무엇이 어디에

| 파일 | 내용 |
|---|---|
| `danmaku_engine.js` | 엔진. 탄 궤적·회피·충돌·명중. 영상을 그린 파일과 sha256 `1f933fe707f9e1ceb8c5de28a09e188b86dc3c752cc51ba5d77c27e26509ce9c` 동일 |
| `remake/config.js` | 시드·밀도·체력·마디표 |
| `remake/timeline.js` | 영상 프레임 ↔ 게임 시각, 두루 표정 고르기 |
| `remake/main.js` | 화면 전부. 프레임 번호의 순수 함수 |
| `remake/render.mjs` | 렌더와 픽셀 해시 |
| `remake/tools/verify.mjs` | 위의 검증 8종 |
| `remake/tools/sweep.mjs` | 조합 탐색 |
| `remake/bgm/build_bgm.py` | 음악. 화성·선율·편곡이 전부 이 파일에 |
| `remake/mix/build_sfx.py` | 효과음. 화면 사건 시각만 읽음 |
| `PROMPTS.md` | AI 에게 그대로 넘길 수 있는 지시문 STEP 0~8 |

## 조종은 두루가 아니라 코드입니다

두루가 스틱을 잡고 있지만 연출입니다. 실제로 피하는 건 `danmaku_engine.js` 의 `dodgeStep` 입니다. 매 틱 화면 폭을 46칸으로 나눠 조금 뒤 탄 위치까지 보고 가장 안전한 칸으로 갑니다. 머신러닝이 아니라 규칙입니다. 조종석 두루는 그 기체가 움직인 방향과 실제로 스친 순간을 따라 표정만 바뀝니다.

## 계산한 것과 고른 것

- **계산:** 탄 궤적 · 회피 경로 · 충돌 판정 · 명중 · 화면 탄 수
- **고른 것:** 밀도 곡선 · 시드 · 폭탄 시각 · 보스 체력 · 저속 구간(최근접 전후를 느리게 보여 줌)
- 시드는 고른 값입니다. 1,800개 조합 중 격파까지 안 맞은 261개(화면 3,000발 이상 111개)에서 폭탄 직전에 가장 가깝게 스치는 쪽을 골랐습니다.
- 아이템은 기체가 폭탄 순간에 있을 자리에 놓습니다. 기체가 아이템을 찾아가는 게 아닙니다.
- 폭탄부터 격파까지는 0.994배속입니다. 격파를 다운비트에 맞추려고 조금 늦췄습니다.
- 판정은 탄 중심과 기체 중심 거리 12px 입니다. 탄 그림이나 기체 그림이 겹쳐 보여도 그것만으로 맞은 게 아닙니다. 그래서 화면에 판정 원을 항상 그립니다.

## 처음 값은 무피격이 아니었습니다

처음 쓰던 시드(D=3.4, seed=8)는 1/30초마다 검사하면 무피격이었습니다. 느린 장면을 넣으려고 프레임 사이를 재 보니 기체가 지나가는 동안 판정 안에 약 0.02초 들어갔습니다(위 V6). 그래서 틱 사이까지 재서 시드를 다시 골랐습니다.

## 이 저장소에 없는 것

- 영상 파일, 두루·멜론·배경 그림, 썸네일. 그림은 GPT 로 만들었습니다.
- 샘플, 글꼴, GSAP, Playwright 는 따로 받습니다. 라이선스는 [`LICENSE`](LICENSE) 에 자산별로 적었습니다.
