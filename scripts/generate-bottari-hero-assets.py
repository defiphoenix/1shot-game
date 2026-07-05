from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
GAME_ASSET_DIR = ROOT / "games/hero-quest/assets/hero-v2"
PUBLIC_ASSET_DIR = ROOT / "hero-quest-main/public/assets/hero-v2"
INDEX_PATHS = [
    ROOT / "games/hero-quest/assets/index.json",
    ROOT / "hero-quest-main/public/assets/index.json",
]
MANIFEST_PATHS = [
    GAME_ASSET_DIR / "manifest.json",
    PUBLIC_ASSET_DIR / "manifest.json",
]

FRAME = 256
SHEET = 1024
COLS = 4
ROWS = 4
AA = 4

INK = "#3a352e"
BODY = "#ffffff"
ORANGE = "#ef8f3a"
SOFT = "#9a9184"
WHITE = "#ffffff"

ANIMATIONS = {
    "idle": {"frames": 12, "frameRate": 6},
    "walk": {"frames": 8, "frameRate": 7},
    "enter-portal": {"frames": 12, "frameRate": 7, "back": True},
    "run": {"frames": 8, "frameRate": 10},
    "jump": {"frames": 6, "frameRate": 8},
    "light-punch": {"frames": 8, "frameRate": 12},
    "hurt": {"frames": 6, "frameRate": 8},
    "death": {"frames": 10, "frameRate": 8},
}


def q(p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float], steps: int = 16):
    return [
        (
            (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t**2 * p2[0],
            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t**2 * p2[1],
        )
        for t in [i / steps for i in range(steps + 1)]
    ]


def c(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
    steps: int = 20,
):
    return [
        (
            (1 - t) ** 3 * p0[0]
            + 3 * (1 - t) ** 2 * t * p1[0]
            + 3 * (1 - t) * t**2 * p2[0]
            + t**3 * p3[0],
            (1 - t) ** 3 * p0[1]
            + 3 * (1 - t) ** 2 * t * p1[1]
            + 3 * (1 - t) * t**2 * p2[1]
            + t**3 * p3[1],
        )
        for t in [i / steps for i in range(steps + 1)]
    ]


class BottariCanvas:
    def __init__(
        self,
        image: Image.Image,
        *,
        origin: tuple[float, float],
        scale: float,
        facing: int,
        rotation: float = 0.0,
    ):
        self.image = image
        self.draw = ImageDraw.Draw(image)
        self.origin = origin
        self.scale = scale * AA
        self.facing = facing
        self.rotation = rotation

    def p(self, x: float, y: float) -> tuple[float, float]:
        ca = math.cos(self.rotation)
        sa = math.sin(self.rotation)
        xr = x * ca - y * sa
        yr = x * sa + y * ca
        return (
            self.origin[0] * AA + self.facing * xr * self.scale,
            self.origin[1] * AA + yr * self.scale,
        )

    def line(self, points, fill=INK, width=3.2):
        self.draw.line([self.p(x, y) for x, y in points], fill=fill, width=max(1, round(width * self.scale)), joint="curve")

    def ellipse(self, cx, cy, rx, ry, fill=BODY, outline=INK, width=3.2):
        px, py = self.p(cx, cy)
        rx *= self.scale
        ry *= self.scale
        box = [px - rx, py - ry, px + rx, py + ry]
        self.draw.ellipse(box, fill=fill, outline=outline, width=max(1, round(width * self.scale)))

    def circle(self, cx, cy, r, fill=INK):
        px, py = self.p(cx, cy)
        rr = r * self.scale
        self.draw.ellipse([px - rr, py - rr, px + rr, py + rr], fill=fill)

    def rounded_rect(self, x, y, w, h, r, fill=BODY, outline=INK, width=3.2):
        x0, y0 = self.p(x, y)
        x1, y1 = self.p(x + w, y + h)
        box = [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]
        self.draw.rounded_rectangle(
            box,
            radius=max(1, round(r * self.scale)),
            fill=fill,
            outline=outline,
            width=max(1, round(width * self.scale)),
        )

    def polygon(self, points, fill=BODY, outline=INK, width=3.2):
        mapped = [self.p(x, y) for x, y in points]
        self.draw.polygon(mapped, fill=fill)
        self.draw.line(mapped + [mapped[0]], fill=outline, width=max(1, round(width * self.scale)), joint="curve")


def draw_capsule(d: BottariCanvas, ax, ay, bx, by, width, fill=BODY):
    d.line([(ax, ay), (bx, by)], fill=INK, width=width + 3.2)
    d.line([(ax, ay), (bx, by)], fill=fill, width=width)


def draw_hatching(d: BottariCanvas, lines, width=1.3):
    for ax, ay, bx, by in lines:
        d.line([(ax, ay), (bx, by)], fill=INK, width=width)


def draw_body(d: BottariCanvas):
    points = []
    points += c((-58, -22), (-75, -62), (-74, -148), (-35, -180))[1:]
    points += c((-35, -180), (-10, -199), (45, -184), (61, -142))[1:]
    points += c((61, -142), (81, -89), (64, -23), (31, -8))[1:]
    points += c((31, -8), (8, 2), (-40, -2), (-58, -22))[1:]
    d.polygon(points, fill=BODY, outline=INK, width=4.4)

    # Loose duplicate strokes and side-panel lines make the asset read like the main card sketch.
    d.line(c((-52, -27), (-66, -72), (-66, -143), (-28, -174), 28), width=1.4)
    d.line(c((-42, -32), (-56, -83), (-51, -145), (-18, -174), 26), fill=SOFT, width=1.7)
    d.line(c((-22, -181), (-35, -125), (-34, -45), (-21, -18), 28), fill=SOFT, width=1.8)
    d.line(c((-4, -184), (-7, -125), (-2, -47), (7, -17), 28), fill=SOFT, width=1.4)
    d.line(c((53, -136), (69, -89), (57, -42), (31, -14), 22), width=1.5)

    draw_hatching(
        d,
        [
            (-64, -45, -50, -52),
            (-67, -57, -52, -64),
            (-68, -70, -54, -78),
            (-63, -151, -48, -159),
            (-55, -164, -39, -171),
            (-35, -9, -10, -14),
            (-11, -7, 22, -12),
        ],
    )

    # Side strap, buckle, and ring detail from the card.
    d.rounded_rect(-61, -128, 12, 23, 3, fill=BODY, outline=INK, width=2.1)
    d.line([(-55, -105), (-53, -82)], width=2.0)
    d.rounded_rect(-61, -88, 11, 17, 3, fill=BODY, outline=INK, width=2.0)
    d.line([(-55, -71), (-55, -56)], width=2.0)
    d.ellipse(-55, -48, 10, 10, fill=BODY, outline=INK, width=2.4)


def draw_bundle(d: BottariCanvas, back: bool):
    x = 70 if back else -88
    y = -82 if back else -83
    d.ellipse(x, y, 38, 44, fill=ORANGE, outline=INK, width=4.1)
    draw_hatching(
        d,
        [
            (x - 31, y - 18, x - 15, y - 33),
            (x - 35, y - 4, x - 11, y - 29),
            (x - 34, y + 11, x - 4, y - 21),
            (x - 27, y + 25, x + 6, y - 10),
            (x - 4, y + 37, x + 25, y + 6),
        ],
        width=1.0,
    )
    knot = [
        (x + 2, y - 38),
        *q((x + 2, y - 38), (x - 18, y - 57), (x - 33, y - 41), 8),
        *q((x - 33, y - 41), (x - 26, y - 22), (x - 2, y - 31), 8),
        (x + 7, y - 37),
        *q((x + 7, y - 37), (x + 31, y - 58), (x + 39, y - 33), 8),
        *q((x + 39, y - 33), (x + 25, y - 20), (x + 8, y - 28), 8),
    ]
    d.polygon(knot, fill=ORANGE, outline=INK, width=3.0)
    d.circle(x + 3, y - 35, 5.5, fill=INK)
    d.circle(x + 3, y - 35, 3.5, fill=ORANGE)
    for dx, dy, r in [
        (-25, -18, 7),
        (-8, -25, 5.5),
        (15, -20, 6.5),
        (-23, 2, 6),
        (0, 1, 7),
        (24, 6, 5.8),
        (-11, 24, 6.5),
        (14, 28, 5.5),
    ]:
        d.circle(x + dx, y + dy, r, fill=WHITE)


def draw_face_and_pocket(d: BottariCanvas, *, eyes="open", blush=False):
    d.rounded_rect(-6, -82, 76, 52, 16, fill=BODY, outline=INK, width=3.3)
    d.line(q((0, -60), (31, -54), (64, -62), 18), width=2.4)
    d.line([(4, -76), (5, -34)], fill=SOFT, width=1.1)
    for sx in [-1, 1, 3, 5, 7]:
        d.line([(sx * 8 + 18, -31), (sx * 8 + 21, -31)], fill=SOFT, width=1.0)
    d.line([(20, -58), (17, -44)], width=2.1)
    d.ellipse(16, -40, 2.8, 5, fill=BODY, outline=INK, width=2.0)

    if eyes == "x":
        for ex in [3, 40]:
            d.line([(ex - 5, -131), (ex + 5, -121)], width=3.0)
            d.line([(ex + 5, -131), (ex - 5, -121)], width=3.0)
    else:
        for ex in [3, 40]:
            d.ellipse(ex, -126, 4.0, 7.5, fill=INK, outline=INK, width=1.0)
    d.line(q((15, -105), (23, -99), (31, -106), 12), width=2.8)

    if blush:
        for bx, by in [(55, -118), (59, -113)]:
            d.line([(bx - 3, by + 4), (bx + 4, by - 3)], fill=ORANGE, width=2.0)


def draw_back_panel(d: BottariCanvas):
    d.line(c((-37, -177), (-48, -122), (-43, -42), (-25, -18), 24), fill=SOFT, width=4.0)
    d.line(c((19, -181), (27, -119), (30, -44), (22, -15), 24), fill=SOFT, width=3.4)
    d.line([(4, -178), (8, -32)], fill=SOFT, width=2.1)
    d.rounded_rect(-12, -84, 61, 40, 14, fill=BODY, outline=INK, width=2.6)
    d.line(q((-4, -64), (19, -58), (42, -64), 12), width=2.0)


def draw_bottari_frame(action: str, frame_index: int, frame_count: int, *, size=FRAME) -> Image.Image:
    canvas = Image.new("RGBA", (size * AA, size * AA), (255, 255, 255, 0))
    progress = frame_index / max(1, frame_count - 1)
    phase = progress * math.tau
    facing = 1
    back = ANIMATIONS.get(action, {}).get("back", False)

    foot_front = 0.0
    foot_back = 0.0
    foot_lift = 0.0
    arm_swing = 0.0
    arm_raise = False
    punch = 0.0
    blush = False
    eyes = "open"
    lean = 0.0
    y_offset = 0.0

    if action in {"walk", "enter-portal"}:
        foot_front = math.sin(phase) * 12
        foot_back = -math.sin(phase) * 12
        arm_swing = math.sin(phase) * 5
    elif action == "run":
        foot_front = math.sin(phase) * 19
        foot_back = -math.sin(phase) * 19
        arm_swing = math.sin(phase) * 8
        lean = -0.08
    elif action == "jump":
        y_offset = -18 * math.sin(progress * math.pi)
        foot_lift = 8
        arm_raise = True
    elif action == "light-punch":
        punch = math.sin(progress * math.pi)
        lean = -0.04 * punch
    elif action == "hurt":
        lean = 0.12 * (1 - progress)
        blush = True
    elif action == "death":
        eyes = "x"
        lean = -0.72 * progress
        y_offset = 22 * progress
        foot_front = 8
        foot_back = -8

    x_offset = 82 * progress if action == "death" else 0
    origin = (size / 2 + x_offset, size - 18 + y_offset)
    scale = (0.84 if action == "death" else 1.0) if size == FRAME else 3.55
    d = BottariCanvas(canvas, origin=origin, scale=scale, facing=facing, rotation=lean)

    d.line([(-112, 2), (-79, -7), (-36, -3), (12, -8), (64, -1)], fill="#cfc7b8", width=1.7)

    if back:
        draw_capsule(d, -40, -160, -70, -112, 11)
        draw_capsule(d, 40, -160, 70, -112, 11)
    else:
        draw_capsule(d, -40, -160, -70, -112, 11)

    draw_bundle(d, back=back)

    d.ellipse(-24 + foot_back, -8 - foot_lift - max(0, foot_back) * 0.2, 13, 9, fill=BODY, outline=INK)
    d.ellipse(24 + foot_front, -8 - foot_lift - max(0, foot_front) * 0.2, 13, 9, fill=BODY, outline=INK)

    d.rounded_rect(-15, -214, 30, 38, 13, fill=BODY, outline=INK, width=3.2)
    d.rounded_rect(-7, -206, 14, 24, 7, fill=None, outline=INK, width=2.2)

    draw_body(d)

    if back:
        draw_back_panel(d)
    else:
        d.line([(47, -148), (55, -138)], width=2.2)
        d.ellipse(57, -134, 3, 4.5, fill=BODY, outline=INK, width=2.0)
        draw_face_and_pocket(d, eyes=eyes, blush=blush)

    if not back:
        if punch > 0:
            hx = 67 + punch * 54
            hy = -88 + punch * 4
            draw_capsule(d, 58, -91, hx, hy, 12)
            d.ellipse(hx, hy, 8.5, 8.5, fill=BODY, outline=INK)
        elif arm_raise:
            draw_capsule(d, 62, -96, 74, -126, 11)
            d.ellipse(74, -126, 8, 8, fill=BODY, outline=INK)
        else:
            draw_capsule(d, 63, -94, 73 + arm_swing, -74, 11)
            d.ellipse(73 + arm_swing, -74, 8, 8, fill=BODY, outline=INK)
    else:
        draw_capsule(d, -58, -95, -67 - arm_swing, -76, 10)
        d.ellipse(-67 - arm_swing, -76, 7.5, 7.5, fill=BODY, outline=INK)

    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def save_sheet(name: str, cfg: dict):
    frames = [draw_bottari_frame(name, i, cfg["frames"]) for i in range(cfg["frames"])]
    sheet = Image.new("RGBA", (SHEET, SHEET), (255, 255, 255, 0))
    for idx, frame in enumerate(frames):
        sheet.alpha_composite(frame, ((idx % COLS) * FRAME, (idx // COLS) * FRAME))
    sheet.save(GAME_ASSET_DIR / f"{name}.png", optimize=True)

    preview = [frame.copy() for frame in frames]
    duration = round(1000 / cfg["frameRate"])
    preview[0].save(
        GAME_ASSET_DIR / f"{name}-preview.gif",
        save_all=True,
        append_images=preview[1:],
        duration=duration,
        loop=0,
        disposal=2,
    )


def save_anchor(name: str, *, back: bool = False):
    action = "enter-portal" if back else "idle"
    frame = draw_bottari_frame(action, 0, 1, size=SHEET)
    frame.save(GAME_ASSET_DIR / f"{name}.png", optimize=True)


def sync_public_assets():
    PUBLIC_ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for item in GAME_ASSET_DIR.iterdir():
        if item.is_file() and item.suffix.lower() in {".png", ".gif"}:
            shutil.copy2(item, PUBLIC_ASSET_DIR / item.name)


def update_manifest(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    data["characterId"] = "bottari-quest-backpack"
    data["description"] = "Bottari hand-drawn backpack platformer character assets generated from the local Bottari renderer."
    data["source"] = {
        "generator": "scripts/generate-bottari-hero-assets.py",
        "style": "bottari-illust",
        "notes": "Main-card-style black sketch lines, 3/4 white backpack body, large orange polka-dot bundle, transparent sprite sheets.",
    }

    for image in data.get("images", []):
        if image.get("path") == "anchor-w.png":
            image["usage"] = "Bottari west-facing transparent anchor reference"
        if image.get("path") == "anchor-n.png":
            image["usage"] = "Bottari back-view transparent anchor reference for portal entry"

    for animation in data.get("animations", []):
        animation["columns"] = COLS
        animation["rows"] = ROWS
        animation["source"] = "bottariProceduralRenderer"

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def update_index(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    assets = data.get("publicAssets", {})
    for image in assets.get("images", []):
        if image.get("id") == "hero-v2-anchor-w":
            image["usage"] = "Bottari west-facing hand-drawn backpack anchor reference"
        if image.get("id") == "hero-v2-anchor-n":
            image["usage"] = "Bottari back-view hand-drawn backpack anchor reference for portal entry"

    for sheet in assets.get("spritesheets", []):
        if str(sheet.get("id", "")).startswith("hero-v2-"):
            sheet["source"] = "bottariProceduralRenderer"

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    GAME_ASSET_DIR.mkdir(parents=True, exist_ok=True)
    save_anchor("anchor-w")
    save_anchor("anchor-n", back=True)
    for name, cfg in ANIMATIONS.items():
        save_sheet(name, cfg)
    sync_public_assets()
    for path in MANIFEST_PATHS:
        update_manifest(path)
    for path in INDEX_PATHS:
        update_index(path)


if __name__ == "__main__":
    main()
