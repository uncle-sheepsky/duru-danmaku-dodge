"""자리표시 그림을 만든다 — 영상의 두루·배경 그림은 이 저장소에 없다. 이름이 같은 PNG로 바꿔 넣으면 그대로 돌아간다.
사용: python remake/tools/make_placeholders.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

R = Path(__file__).resolve().parent.parent
C = R / "assets/cels"
P = R / "assets/prep"
F = R / "assets/f0"
for d in (C, P, F):
    d.mkdir(parents=True, exist_ok=True)
GROUPS = {"stick_idle": 6, "stick_lean": 6, "stick_graze": 5, "stick_bomb": 6, "stick_mash": 4, "stick_down": 6}


def face(w, h, tag, fill=(255, 251, 240, 255)):
    """투명 배경 둥근 자리표시. 칸 번호가 보이게 눈 사이에 점 개수를 찍는다."""
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = min(w, h) * 0.36
    cx, cy = w / 2, h * 0.46
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=fill, outline=(42, 15, 8, 255), width=max(2, int(r * 0.06)))
    e = r * 0.28
    for s in (-1, 1):
        d.ellipse((cx + s * e - r * 0.07, cy - r * 0.15, cx + s * e + r * 0.07, cy + r * 0.05), fill=(42, 15, 8, 255))
    for i in range(tag):
        d.ellipse((cx - r * 0.5 + i * r * 0.2, cy + r * 0.35, cx - r * 0.5 + i * r * 0.2 + r * 0.12, cy + r * 0.47), fill=(230, 70, 80, 255))
    return im


for g, n in GROUPS.items():
    for i in range(1, n + 1):
        face(372, 319, i).save(C / f"{g}_cel{i:02d}__s.png")
        face(760, 651, i).save(C / f"{g}_cel{i:02d}__l.png")
for i in range(1, 5):
    face(116, 116, i, (255, 200, 76, 255)).save(C / f"ship_cel{i:02d}__s.png")
    face(348, 348, i, (255, 200, 76, 255)).save(C / f"ship_cel{i:02d}__l.png")
    face(1000, 658, i).save(C / f"cutin_face_cel{i:02d}.png")
for i in range(1, 4):
    face(230, 230, i, (143, 209, 79, 255)).save(C / f"boss_melon_cel{i:02d}__s.png")
face(62, 62, 0, (255, 200, 76, 255)).save(C / "item_bomb_cel01__s.png")
face(170, 170, 0, (255, 200, 76, 255)).save(C / "item_bomb_cel01__l.png")
Image.new("RGB", (1080, 1920), (10, 8, 34)).save(P / "bg_field.png")
Image.new("RGB", (760, 652), (70, 30, 70)).save(P / "cockpit.png")
face(132, 132, 0, (40, 90, 50, 255)).save(P / "turret.png")
for n in ("chunk_a", "chunk_b", "chunk_c"):
    face(200, 200, 0, (143, 209, 79, 255)).save(P / f"{n}.png")
Image.new("RGB", (1080, 1920), (10, 8, 34)).save(F / "g_a_squeeze.png")
print("자리표시 완료", len(list(C.glob("*.png"))) + 2 + 3 + 2 + 1)
