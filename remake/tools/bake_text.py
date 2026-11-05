"""화면 글자를 PNG로 굽는다(런타임 글꼴 금지). 수치는 data/meta.json 에서만 읽는다(화면 수치 하드코딩 금지).
숫자는 낱자 스프라이트 → HUD가 엔진 값을 조립한다."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
R = HERE.parent
OUT = R / "assets/text"
OUT.mkdir(parents=True, exist_ok=True)
FONT = R / "assets/fonts/Jua-Regular.ttf"
m = json.loads((R / "data/meta.json").read_text(encoding="utf-8"))
INK = (42, 15, 8, 255)
WHITE = (255, 251, 240, 255)
HONEY = (255, 200, 76, 255)
TEAL = (6, 236, 210, 255)


def bake(name, text, size, fill=WHITE, stroke=None, ink=INK):
    f = ImageFont.truetype(str(FONT), size)
    sw = stroke if stroke is not None else max(3, round(size * 0.09))
    box = f.getbbox(text, stroke_width=sw)
    w, h = box[2] - box[0] + 8, box[3] - box[1] + 8
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((4 - box[0], 4 - box[1]), text, font=f, fill=fill, stroke_width=sw, stroke_fill=ink)
    im.save(OUT / f"{name}.png")
    return {"w": w, "h": h}


peak = f"{m['peak']:,}"
sizes = {}
sizes["hook1"] = bake("hook1", f"탄막 {peak}발", 132, HONEY)
sizes["hook2"] = bake("hook2", "한 발만 맞아도 끝", 88)
sizes["near"] = bake("near", f"맞기까지 {m['marginPx']}px", 74, HONEY)
sizes["bomb"] = bake("bomb", "폭탄!", 150, WHITE)
sizes["kill"] = bake("kill", "격파!", 190, HONEY)
sizes["stat1"] = bake("stat1", f"{peak}발", 150, HONEY)
sizes["stat2"] = bake("stat2", "피격 0", 150, WHITE)
# 코덱스 맥락 판정 3/3: 「BULLETS」가 현재 수인지 누적인지 헷갈림 → 화면 위에 있는 수라고 적는다
sizes["lab_bullets"] = bake("lab_bullets", "지금 화면 위 탄", 36, (214, 218, 245, 255), stroke=0)
sizes["lab_hit"] = bake("lab_hit", "피격", 36, (214, 218, 245, 255), stroke=0)
def bake_digit(key, ch, size, fill, sw=4):
    # 낱자마다 같은 높이·같은 기준선(쉼표가 위로 뜨지 않게)
    f = ImageFont.truetype(str(FONT), size)
    asc, desc = f.getmetrics()
    w = round(f.getlength(ch)) + sw * 2 + 4
    h = asc + desc + sw * 2 + 4
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((sw + 2, sw + 2 + asc), ch, font=f, fill=fill, stroke_width=sw, stroke_fill=INK, anchor="ls")
    im.save(OUT / f"{key}.png")
    return {"w": w, "h": h}


for tag, col, sz in (("w", WHITE, 92), ("h", HONEY, 92), ("t", TEAL, 58)):
    for ch in "0123456789,":
        key = f"d{tag}_{'c' if ch == ',' else ch}"
        sizes[key] = bake_digit(key, ch, sz, col)
(R / "data/text.json").write_text(json.dumps(sizes, ensure_ascii=False, indent=0), encoding="utf-8")
print("구운 글자", len(sizes))
