"""
local_renderer.py - The FREE, dependency-light 2D anime renderer (MVP backend).

Implements the abstract `ImageModelAdapter` using only Pillow + numpy (both
already present in the Sophie runtime).  This is the "local or free alternative"
the spec (12) demands: it works with zero paid API keys / credits.

It uses a *skeletal, parametric* character model:
  - every character is fully described by a `Character` object (colors, hair,
    eye color, build, distinctive marks) captured once when the screenplay is
    processed.
  - a "pose" is a dictionary of joint positions + expression params.
  - keyframes are poses; in-betweens are *linear interpolations of the pose
    skeleton* (NOT pixels), then rendered.  This is exactly the "skeletal
    animation / layered animation" technique the spec recommends (section 6.B)
    and it guarantees frame-to-frame identity consistency (6.C) because the
    character's appearance never gets re-invented -- it is drawn from the same
    stored parameters every time.

Swapping in an AI backend: implement the same 3 abstract methods and route the
`pose_name` / `character` params into whatever image model you plug in.
"""
from __future__ import annotations
import math
import re
from typing import Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

from .base import ImageModelAdapter, Img
from ..data_models import Character

try:  # Pillow >= 9.1
    _BICUBIC = Image.Resampling.BICUBIC
except AttributeError:  # older Pillow
    _BICUBIC = Image.BICUBIC

# ---------------------------------------------------------------------------
# Color vocabulary (maps common description words -> hex)
# ---------------------------------------------------------------------------

def _hex(c: str) -> str:
    return c.lower() if c.startswith("#") else _NAME_TO_HEX.get(c.strip().lower(), "#333333")

_NAME_TO_HEX = {
    "black": "#111318", "white": "#f7f7f7", "red": "#d82a2a",
    "dark blue": "#1e3a8a", "blue": "#3b82f6", "light blue": "#93c5fd",
    "brown": "#8b5a2b", "light brown": "#a67c52", "dark brown": "#5d4037",
    "green": "#228b22", "dark green": "#155e2b", "eye green": "#2e8b57",
    "blonde": "#e0b84a", "golden": "#d4a72c", "gold": "#d4af37",
    "pink": "#f49fbb", "pastel pink": "#f8c6d0", "light pink": "#fecdd3",
    "auburn": "#9a3b1b", "gray": "#777777", "grey": "#777777",
    "dark gray": "#3a3a3a", "light gray": "#bdbdbd", "pale": "#f5d0b9",
    "fair": "#f5d0b9", "dark skin": "#5d4037", "tan": "#c98a40",
    "orange": "#e67e22", "yellow": "#f5e04b", "purple": "#7c3aed",
    "black coat": "#0a0a0a", "silver": "#c0c0c0",
}
# anime-style eye colors when description gives a color word
_EYE_COLORS = {
    "brown": "#8b5a2b", "black": "#1a1a1e", "blue": "#3b82f6",
    "green": "#2e8b57", "amber": "#d47817", "gray": "#8a91a0",
    "grey": "#8a91a0", "hazel": "#654321", "purple": "#7c3aed",
    "gold": "#d4af37",
}
_HAIR_COLORS = {
    "black": "#1a1624", "brown": "#5d4037", "blonde": "#e0b84a",
    "pink": "#f78dac", "auburn": "#9a3b1b", "gray": "#5a5a6a",
    "silver": "#b8c1cc", "white": "#e8e8e8", "purple": "#7c3aed",
}


def _resolve_color(word: str, mapping: dict, default: str) -> str:
    w = word.strip().lower()
    for key, val in mapping.items():
        if key in w:
            return val
    return default


# ---------------------------------------------------------------------------
# Skeleton / pose model
# ---------------------------------------------------------------------------
# All coordinates are in "character space": ground at Y=0 (feet on ground),
# X in [-1, 1] (half-width), Y up to ~0.97 (top of head).  The renderer scales
# this box so the character fills a target pixel height while staying centered.

STANDING: Dict[str, object] = {
    "head_x": 0.0, "head_y": 0.89,
    "body_tilt": 0.0, "head_tilt": 0.0,
    "shoulder_l": (-0.20, 0.74), "shoulder_r": (0.20, 0.74),
    "elbow_l": (-0.28, 0.60), "elbow_r": (0.28, 0.60),
    "hand_l": (-0.32, 0.46), "hand_r": (0.32, 0.46),
    "hip": (0.0, 0.42),
    "knee_l": (-0.12, 0.26), "knee_r": (0.12, 0.26),
    "foot_l": (-0.16, 0.0), "foot_r": (0.16, 0.0),
    "mouth_open": 0.0, "blink": 0.0, "gaze_l": 0.0, "gaze_r": 0.0,
    "scar_on": 0.0,            # 1.0 = show the distinctive scar
}


def _copy(base: Dict) -> Dict:
    return dict(base)


def _set(d: Dict, **kw) -> Dict:
    d = dict(d)
    d.update(kw)
    return d


# Named poses.  Each returns a full skeleton dict.
def pose_standing():
    return _copy(STANDING)


def pose_idle_bob(t):
    """Subtle breathing bob for an idle stand (t in [0,1] cycle)."""
    b = math.sin(t * math.pi * 2)
    s = _copy(STANDING)
    s["body_tilt"] = math.degrees(2 * b)
    s["head_y"] = 0.89 + 0.01 * b
    s["shoulder_l"] = (-0.22, 0.74 + 0.01 * b)
    s["shoulder_r"] = (0.22, 0.74 - 0.01 * b)
    return s


def pose_walk(t):
    """t in [0,1] across one walk step. Arms/legs swing."""
    b = math.sin(t * math.pi * 2)
    s = _copy(STANDING)
    s["body_tilt"] = math.degrees(3 * b)
    s["shoulder_l"] = (-0.24, 0.74 + 0.02 * b)
    s["shoulder_r"] = (0.24, 0.74 - 0.02 * b)
    s["elbow_l"] = (-0.30, 0.62 - 0.02 * b)
    s["elbow_r"] = (0.30, 0.62 + 0.02 * b)
    s["hand_l"] = (-0.34, 0.46 - 0.03 * b)
    s["hand_r"] = (0.34, 0.46 + 0.03 * b)
    s["hip"] = (0.02 * b, 0.42)
    s["knee_l"] = (-0.10, 0.26 + 0.01 * b)
    s["knee_r"] = (0.10, 0.26 - 0.01 * b)
    s["foot_l"] = (-0.16 - 0.02 * b, -0.0)
    s["foot_r"] = (0.16 + 0.02 * b, -0.0)
    s["head_y"] = 0.89 + 0.01 * b
    return s


def pose_crouch():
    s = _copy(STANDING)
    s["hip"] = (0.0, 0.38)
    s["knee_l"] = (-0.10, 0.24)
    s["knee_r"] = (0.10, 0.24)
    s["foot_l"] = (-0.16, 0.0)
    s["foot_r"] = (0.16, 0.0)
    s["shoulder_l"] = (-0.18, 0.70)
    s["shoulder_r"] = (0.18, 0.70)
    s["head_y"] = 0.85
    s["body_tilt"] = 0.0
    return s


def pose_leap():
    """Mid-air jump: legs split, arms up, body horizontal."""
    s = _copy(STANDING)
    s["body_tilt"] = -10.0
    s["head_y"] = 0.88
    s["hip"] = (0.0, 0.45)
    s["shoulder_l"] = (-0.10, 0.60)
    s["shoulder_r"] = (0.10, 0.60)
    s["elbow_l"] = (-0.10, 0.72)
    s["elbow_r"] = (0.10, 0.72)
    s["hand_l"] = (-0.08, 0.82)
    s["hand_r"] = (0.08, 0.82)
    s["knee_l"] = (-0.18, 0.42)
    s["knee_r"] = (0.18, 0.42)
    s["foot_l"] = (-0.22, 0.30)
    s["foot_r"] = (0.22, 0.30)
    return s


def pose_land():
    s = pose_crouch()
    s["body_tilt"] = 8.0
    s["shoulder_l"] = (-0.22, 0.68)
    s["shoulder_r"] = (0.22, 0.68)
    s["knee_l"] = (-0.14, 0.22)
    s["knee_r"] = (0.14, 0.22)
    return s


def pose_land_recover():
    s = _copy(STANDING)
    s["body_tilt"] = 3.0
    s["shoulder_l"] = (-0.21, 0.75)
    s["shoulder_r"] = (0.21, 0.75)
    s["knee_l"] = (-0.11, 0.27)
    s["knee_r"] = (0.11, 0.27)
    s["foot_l"] = (-0.15, 0.0)
    s["foot_r"] = (0.15, 0.0)
    return s


def pose_dodge_back():
    """Leaning far back, arms out for balance, one leg bent."""
    s = _copy(STANDING)
    s["body_tilt"] = 16.0
    s["head_y"] = 0.90
    s["shoulder_l"] = (-0.16, 0.78)
    s["shoulder_r"] = (0.16, 0.78)
    s["elbow_l"] = (-0.28, 0.74)
    s["elbow_r"] = (0.28, 0.74)
    s["hand_l"] = (-0.32, 0.62)
    s["hand_r"] = (0.32, 0.62)
    s["hip"] = (0.0, 0.44)
    s["knee_r"] = (0.10, 0.26)
    s["foot_r"] = (0.12, 0.0)
    s["head_tilt"] = -10.0
    return s


def pose_punch_windup():
    s = pose_crouch()
    s["body_tilt"] = 0.0
    s["shoulder_l"] = (-0.18, 0.72)
    s["shoulder_r"] = (0.18, 0.72)
    # right arm pulled back (coiled)
    s["elbow_r"] = (-0.18, 0.66)
    s["hand_r"] = (-0.32, 0.56)
    return s


def pose_punch_extend():
    s = _copy(STANDING)
    s["body_tilt"] = -4.0
    # right arm fully extended forward
    s["elbow_r"] = (0.34, 0.54)
    s["hand_r"] = (0.46, 0.50)
    s["shoulder_r"] = (0.20, 0.74)
    s["hand_l"] = (-0.32, 0.46)
    s["knee_l"] = (-0.14, 0.22)
    s["knee_r"] = (0.10, 0.28)
    s["foot_l"] = (-0.16, 0.0)
    s["foot_r"] = (0.12, 0.0)
    return s


def pose_punch_impact():
    s = pose_punch_extend()
    s["hip"] = (-0.03, 0.42)          # follow-through push
    s["shoulder_r"] = (0.22, 0.74)
    return s


def pose_punch_recoil():
    s = _copy(STANDING)
    s["body_tilt"] = 6.0
    s["shoulder_r"] = (0.22, 0.76)
    s["elbow_r"] = (0.12, 0.66)
    s["hand_r"] = (0.02, 0.56)
    s["head_tilt"] = 5.0
    return s


def pose_turn():
    s = _copy(STANDING)
    s["body_tilt"] = 0.0
    s["shoulder_l"] = (-0.16, 0.74)
    s["shoulder_r"] = (0.16, 0.74)
    s["hip"] = (0.02, 0.42)
    s["gaze_l"] = 0.3
    s["gaze_r"] = 0.3
    return s


def pose_defensive():
    s = _copy(STANDING)
    s["shoulder_r"] = (0.22, 0.76)
    s["elbow_r"] = (0.20, 0.72)
    s["hand_r"] = (0.14, 0.60)   # raised guard
    s["shoulder_l"] = (-0.18, 0.74)
    s["body_tilt"] = 4.0
    s["hip"] = (-0.02, 0.42)
    return s


POSE_REGISTRY = {
    "standing": pose_standing,
    "idle": pose_idle_bob,
    "walk": pose_walk,
    "crouch": pose_crouch,
    "leap": pose_leap,
    "land": pose_land,
    "recover": pose_land_recover,
    "dodge": pose_dodge_back,
    "punch_windup": pose_punch_windup,
    "punch_extend": pose_punch_extend,
    "punch_impact": pose_punch_impact,
    "punch_recoil": pose_punch_recoil,
    "turn": pose_turn,
    "defend": pose_defensive,
}


def get_pose(name: str, t: float = 0.0):
    """Resolve a named pose to a concrete skeleton dict.

    Poses that are parameterised by a phase (walk cycle, idle bob) accept `t`;
    static poses ignore it.  We normalise by trying the phase call first and
    falling back to a no-arg call.
    """
    fn = POSE_REGISTRY.get(name, pose_standing)
    try:
        return fn(t)
    except TypeError:
        return fn()


def _lerp_pose(a: Dict, b: Dict, t: float) -> Dict:
    """Linearly interpolate two skeleton dicts (floats and point tuples)."""
    out = {}
    for k in a:
        av = a[k]
        bv = b[k]
        if isinstance(av, tuple) and isinstance(bv, tuple):
            out[k] = tuple(x + (y - x) * t for x, y in zip(av, bv))
        else:
            out[k] = av + (bv - av) * t
    return out


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def _to_px(x: float, y: float, cx: float, cy: float, char_h: float, scale: float,
           angle_deg: float, w: int, h: int) -> Tuple[float, float]:
    """Transform character-space coords -> canvas pixels, applying position,
    height scale, and a body-angle rotation about the character center."""
    px = cx + x * char_h * scale
    py = cy - y * char_h * scale     # Y is up in char space
    if angle_deg:
        ang = math.radians(angle_deg)
        rx = px - cx
        ry = py - cy
        px = cx + rx * math.cos(ang) - ry * math.sin(ang)
        py = cy + rx * math.sin(ang) + ry * math.cos(ang)
    return px, py


def _sausage(draw: ImageDraw.ImageDraw, p0, p1, radius, fill, angle=0.0):
    """Draw a rounded capsule (sausage) between two points."""
    (x0, y0), (x1, y1) = p0, p1
    import math as _m
    dx, dy = x1 - x0, y1 - y0
    length = max(_m.hypot(dx, dy), 1.0)
    # rotate endpoints by angle of the segment
    ux, uy = dx / length, dy / length
    # perpendicular
    px_, py_ = -uy, ux
    r = radius
    # offset the segment by rotation `angle` around its midpoint (rarely needed)
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    if angle:
        a = math.radians(angle)
        rx = (x0 - cx) * math.cos(a) - (y0 - cy) * math.sin(a)
        ry = (x0 - cx) * math.sin(a) + (y0 - cy) * math.cos(a)
        rx2 = (x1 - cx) * math.cos(a) - (y1 - cy) * math.sin(a)
        ry2 = (x1 - cx) * math.sin(a) + (y1 - cy) * math.cos(a)
        x0, y0 = cx + rx, cy + ry
        x1, y1 = cx + rx2, cy + ry2
        dx, dy = x1 - x0, y1 - y0
        length = max(_m.hypot(dx, dy), 1.0)
        ux, uy = dx / length, dy / length
        px_, py_ = -uy, ux
    # build a polygon (rectangle with rounded caps)
    pts = [
        (x0 + px_ * r, y0 + py_ * r),
        (x0 - px_ * r, y0 - py_ * r),
        (x1 - px_ * r, y1 - py_ * r),
        (x1 + px_ * r, y1 + py_ * r),
    ]
    draw.polygon(pts, fill=fill)
    draw.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=fill)
    draw.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=fill)


# ---------------------------------------------------------------------------
# Local renderer
# ---------------------------------------------------------------------------

class LocalRenderer(ImageModelAdapter):
    """Free Pillow-based 2D anime renderer.  No API keys, no credits."""

    def __init__(self, character_store: Optional[Dict] = None, seed: int = 0):
        super().__init__(character_store)
        self.seed = seed
        # cache of per-character baked base layers (head/hair) keyed by char_id
        self._char_cache: Dict = {}

    # -- public rendering ---------------------------------------------------

    def render_frame(self, width: int, height: int, posed_chars: List[dict],
                     bg_image: Optional[Img] = None, effects: Optional[List[str]] = None) -> Img:
        """Composite one full frame: background + every posed character + effects."""
        if bg_image is None:
            bg_image = self.make_background("default day", width, height)
        frame = bg_image.convert("RGBA")
        if frame.size != (width, height):
            frame = frame.resize((width, height))
        for pc in posed_chars:
            frame = self._draw_character(frame, pc)
        for eff in effects or []:
            frame = self.add_effect(frame, eff)
        return frame.convert("RGB")

    def _draw_character(self, base: Img, pc: dict) -> Img:
        """Draw one posed character onto `base`."""
        char: Character = pc["character"]
        skeleton = pc.get("skeleton", get_pose("standing"))
        pos = pc["position"]          # (x_frac, y_frac) ground-point
        scale = pc.get("scale", 0.55)
        angle = pc.get("angle", 0.0)
        w, h = base.size
        cx = pos[0] * w
        cy = pos[1] * h
        char_h = h * 0.54              # character height ~ 54% of canvas height
        params = self._character_params(char)
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        # z-order (back -> front): body+limbs, hair-behind-head, face,
        # hair-in-front (bangs), clothes, accessories
        self._draw_body(draw, skeleton, cx, cy, char_h, scale, params)
        self._draw_hair_back(draw, skeleton, cx, cy, char_h, scale, params)
        self._draw_face(draw, skeleton, cx, cy, char_h, scale, params)
        self._draw_hair_front(draw, skeleton, cx, cy, char_h, scale, params)
        self._draw_clothes(draw, skeleton, cx, cy, char_h, scale, params)
        self._draw_accessories(draw, skeleton, cx, cy, char_h, scale, params)
        # rotate the whole layered character about its ground point by `angle`
        if angle:
            overlay = overlay.rotate(angle, center=(cx, cy), resample=_BICUBIC,
                                     expand=False)
        return Image.alpha_composite(base, overlay)

    # -- character param extraction -----------------------------------------

    def _character_params(self, char: Character) -> dict:
        """Derive concrete colors/sizes from the Character text description."""
        desc = (char.raw_description or "").lower()
        skin = _NAME_TO_HEX.get(char.skin_tone, _resolve_color(desc, {}, "#f5d0b9"))
        eye_c = _resolve_color(desc, _EYE_COLORS, "#8b5a2b")
        hair_c = _resolve_color(desc, _HAIR_COLORS, "#1a1624")
        # clothing color: scan the description for known color words first so
        # "dark-blue jacket" / "white and red school uniform" resolve correctly,
        # then fall back to the character's recorded primary_color.
        cloth = None
        for key in ("dark blue", "dark-blue", "blue jacket", "battle coat",
                    "black coat", "school uniform", "red", "blue", "black"):
            if key in desc:
                cloth = _NAME_TO_HEX.get(key.replace(" ", "").replace("-", ""))
                if cloth:
                    break
        if not cloth:
            cloth = char.primary_color or "#d82a2a"
        if not cloth or cloth == "#333333":
            cloth = "#1e3a8a"
        sc = char.distinctive or ""
        has_scar = ("scar" in desc) or ("scar" in sc.lower())
        # hair length fraction in [0.2, 0.6]
        hl = 0.42
        if "long" in desc:
            hl = 0.58
        elif "short" in desc:
            hl = 0.30
        return {
            "skin": skin, "eye": eye_c, "hair": hair_c, "cloth": cloth,
            "hair_len": hl, "scar": has_scar, "build": char.build or "slim",
            "hair_style": char.hair_style or "short",
            "accent": char.accent_color or "#e67e22",
            "blush": ("blush" in desc) or ("rosy" in desc),
        }

    # -- body ---------------------------------------------------------------

    def _draw_body(self, draw, sk, cx, cy, char_h, scale, p):
        hscale = char_h * scale
        # joints in pixels (ground at cy)
        def J(key):
            x, y = sk[key]
            return _to_px(x, y, cx, cy, char_h, scale, 0.0, 0, 0)
        neck = (cx, cy - 0.78 * char_h * scale)
        hip = J("hip")
        # torso polygon (shoulders -> hips)
        sl = J("shoulder_l"); sr = J("shoulder_r")
        poly = [sl, sr, hip, neck]
        draw.polygon(poly, fill=p["cloth"])
        # shadow under feet
        fl = J("foot_l"); fr = J("foot_r")
        shadow_cx = (fl[0] + fr[0]) / 2.0
        shadow_w = (fr[0] - fl[0]) * 2.5
        shadow_h = char_h * scale * 0.06
        shade = int(30 * 0.5)
        shadow = Image.new("RGBA", (int(shadow_w * 1.4) + 4, int(shadow_h) + 4),
                           (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        sx0 = shadow.size[0] / 2 - shadow_w / 2
        sd.ellipse([sx0, shadow_h / 2, sx0 + shadow_w, shadow_h * 1.6],
                   fill=(0, 0, 0, shade))
        shadow = shadow.filter(ImageFilter.GaussianBlur(2))
        base_img = draw._image
        base_img.paste(shadow, (int(shadow_cx - shadow.size[0] / 2),
                                int(cy + 2 - shadow.size[1] / 2)), shadow)
        # limbs (arms / legs) drawn last so they sit on the body
        self._draw_limbs(draw, sk, cx, cy, char_h, scale, p)

    # -- limbs: arms / legs as sausages --------------------------------------
    def _draw_limbs(self, draw, sk, cx, cy, char_h, scale, p):
        def J(key):
            x, y = sk[key]
            return _to_px(x, y, cx, cy, char_h, scale, 0.0, 0, 0)
        sl = J("shoulder_l"); sr = J("shoulder_r")
        hip = J("hip")
        # arms
        thick = max(char_h * scale * 0.045, 4)
        _sausage(draw, sl, J("elbow_l"), thick, p["cloth"])
        _sausage(draw, J("elbow_l"), J("hand_l"), thick, p["cloth"])
        _sausage(draw, sr, J("elbow_r"), thick, p["cloth"])
        _sausage(draw, J("elbow_r"), J("hand_r"), thick, p["cloth"])
        # legs
        thick_l = max(char_h * scale * 0.055, 5)
        _sausage(draw, hip, J("knee_l"), thick_l, p["cloth"])
        _sausage(draw, J("knee_l"), J("foot_l"), thick_l, p["cloth"])
        _sausage(draw, hip, J("knee_r"), thick_l, p["cloth"])
        _sausage(draw, J("knee_r"), J("foot_r"), thick_l, p["cloth"])

    # -- face ---------------------------------------------------------------

    def _draw_face(self, draw, sk, cx, cy, char_h, scale, p):
        hscale = char_h * scale
        head_r = hscale * 0.48      # head radius (anime: large)
        hx, hy = _to_px(sk["head_x"], sk["head_y"], cx, cy, char_h, scale, 0.0, 0, 0)
        # face base (circle)
        face_col = p["skin"]
        draw.ellipse([hx - head_r, hy - head_r, hx + head_r, hy + head_r],
                     fill=face_col)
        # eyes - large anime eyes
        eye_y = hy - head_r * 0.12
        eye_w = head_r * 0.9
        eye_h = head_r * 0.55
        gaze = sk.get("gaze_l", 0.0)
        # left eye
        lx = hx - head_r * 0.32
        self._draw_eye(draw, lx, eye_y, eye_w, eye_h, p["eye"], gaze)
        rx = hx + head_r * 0.32
        self._draw_eye(draw, rx, eye_y, eye_w, eye_h, p["eye"], gaze)
        # blink
        if sk.get("blink", 0.0) > 0.0:
            for ex in (lx, rx):
                by = eye_y + (eye_h * 0.5) * sk["blink"]
                draw.ellipse([ex - eye_w * 0.45, by - eye_h * 0.3,
                              ex + eye_w * 0.45, by + eye_h * 0.3],
                             fill=p["skin"])
        # mouth / lip sync
        self._draw_mouth(draw, hx, hy, head_r, sk.get("mouth_open", 0.0),
                         sk.get("expression"), p)
        # cheeks / blush
        if p.get("blush"):
            bx = head_r * 0.62
            draw.ellipse([hx - bx*1.3, hy, hx - bx*0.2, hy + bx*0.7],
                         fill=(255, 180, 180, 120))
            draw.ellipse([hx + bx*0.2, hy, hx + bx*1.3, hy + bx*0.7],
                         fill=(255, 180, 180, 120))
        # distinctive scar
        if p.get("scar"):
            sx = hx + head_r * 0.28
            sy0 = hy - head_r * 0.05
            draw.line([sx, sy0, sx + head_r * 0.18, sy0 + head_r * 0.10],
                      fill=(200, 120, 120), width=2)

    def _draw_eye(self, draw, cx, cy, w, h, col, gaze=0.0):
        # outer eye white (oval)
        draw.ellipse([cx - w, cy - h, cx + w, cy + h], fill=(255, 255, 255))
        # iris
        ix = cx + gaze * w * 0.55
        iy = cy + 0.0
        draw.ellipse([ix - w * 0.55, iy - h * 0.55, ix + w * 0.55, iy + h * 0.55],
                     fill=col)
        # sparkle (two whites)
        draw.ellipse([ix - w * 0.18, iy - h * 0.30, ix - w * 0.04, iy - h * 0.16],
                     fill=(255, 255, 255))
        draw.ellipse([ix + w * 0.20, iy - h * 0.32, ix + w * 0.36, iy - h * 0.18],
                     fill=(255, 255, 255))
        # pupil (dark center)
        draw.ellipse([ix - w * 0.16, iy - h * 0.16, ix + w * 0.16, iy + h * 0.16],
                     fill=(20, 20, 25))
        # upper eyelashes
        draw.line([cx - w, cy - h, cx + w, cy - h], fill=(20, 20, 25), width=1)

    def _draw_mouth(self, draw, hx, hy, head_r, open_frac, expression, p):
        """open_frac in [0,1] drives lip-sync; expression picks a base shape."""
        my = hy + head_r * 0.22
        mw = head_r * 0.22
        if open_frac > 0.05:
            # open mouth (for dialogue) - scale with open_frac
            oh = head_r * 0.08 * min(open_frac * 2.2, 1.0)
            draw.ellipse([hx - mw, my - oh * 0.5, hx + mw, my + oh * 0.5],
                         fill=(240, 120, 130))
        else:
            # neutral / smile / etc. curve
            expr = expression or "neutral"
            if expr == "smile":
                draw.arc([hx - mw, my - mw * 0.5, hx + mw, my + mw * 0.5],
                         start=0, end=180, fill=(240, 120, 130), width=2)
            elif expr == "sarcastic":
                draw.arc([hx - mw, my - mw * 0.2, hx + mw, my + mw * 0.6],
                         start=0, end=180, fill=(240, 120, 130), width=2)
                # raised eyebrow
                draw.line([hx - head_r * 0.32, my - head_r * 0.32,
                           hx - head_r * 0.12, my - head_r * 0.38],
                          fill=(60, 50, 55), width=2)
            elif expr == "nervous":
                # slight downturn
                draw.arc([hx - mw, my - mw * 0.3, hx + mw, my + mw * 0.3],
                         start=180, end=360, fill=(240, 120, 130), width=2)
            elif expr == "angry":
                draw.line([hx - mw, my, hx + mw, my], fill=(190, 60, 60), width=2)
            else:
                draw.arc([hx - mw, my - mw * 0.2, hx + mw, my + mw * 0.2],
                         start=0, end=180, fill=(240, 120, 130), width=2)

    # -- hair ---------------------------------------------------------------

    def _draw_hair_back(self, draw, sk, cx, cy, char_h, scale, p):
        """Hair volume sitting BEHIND the head.  Drawn before the face so the
        face occludes the overlapping centre and hair shows at the sides/back."""
        hscale = char_h * scale
        head_r = hscale * 0.48
        hx, hy = _to_px(sk["head_x"], sk["head_y"], cx, cy, char_h, scale, 0.0, 0, 0)
        hair_c = p["hair"]
        hair_w = head_r * 1.3
        draw.ellipse([hx - hair_w, hy - head_r * 0.9,
                      hx + hair_w, hy + head_r * 0.6], fill=hair_c)

    def _draw_hair_front(self, draw, sk, cx, cy, char_h, scale, p):
        """Hair in FRONT of the face: bangs + (if long) strands flowing over the
        shoulders/chest.  Drawn after the face so it overlaps the forehead while
        the face itself stays fully visible."""
        hscale = char_h * scale
        head_r = hscale * 0.48
        hx, hy = _to_px(sk["head_x"], sk["head_y"], cx, cy, char_h, scale, 0.0, 0, 0)
        hair_c = p["hair"]
        hl = p["hair_len"]
        bw = head_r * 0.55
        # left bang
        draw.ellipse([hx - head_r - bw * 0.3, hy - head_r * 0.4,
                      hx - head_r + bw, hy + head_r * 0.3], fill=hair_c)
        # right bang
        draw.ellipse([hx + head_r - bw, hy - head_r * 0.4,
                      hx + head_r + bw * 0.3, hy + head_r * 0.3], fill=hair_c)
        # long hair flow over the front (if long)
        if hl > 0.5:
            flow_len = hscale * 0.5
            for sx in (-head_r * 0.55, head_r * 0.55):
                top = hy + head_r * 0.4
                ctrl_y = top + flow_len * 0.6
                bot = top + flow_len
                pts = [
                    (hx + sx, top),
                    (hx + sx - 4, ctrl_y),
                    (hx + sx - 6, ctrl_y + 6),
                    (hx + sx, bot),
                    (hx + sx + 6, ctrl_y + 6),
                    (hx + sx + 4, ctrl_y),
                ]
                draw.polygon(pts, fill=hair_c)

    # -- clothing accessories ------------------------------------------------

    def _draw_clothes(self, draw, sk, cx, cy, char_h, scale, p):
        # torso already filled with cloth color in _draw_body; add a simple
        # collar / shirt layer + buttons
        hscale = char_h * scale
        # draw a collar triangle + buttons
        neck_x = cx
        neck_y = cy - 0.78 * char_h * scale
        # collar
        draw.polygon([
            (neck_x - hscale * 0.07, neck_y),
            (neck_x + hscale * 0.07, neck_y),
            (neck_x, neck_y + hscale * 0.08),
        ], fill=p["accent"])
        # buttons on jacket
        for i in range(3):
            by = neck_y + hscale * 0.12 + i * hscale * 0.08
            draw.ellipse([neck_x - 2, by - 2, neck_x + 2, by + 2], fill=p["accent"])

    def _draw_accessories(self, draw, sk, cx, cy, char_h, scale, p):
        if p.get("scar"):
            pass  # scar drawn on face
        # (extend here for e.g. the cherry-blossom hair clips / flower)
        if "flower" in str(p.get("hair_style", "")) or p.get("flower"):
            hx, hy = _to_px(sk["head_x"], sk["head_y"], cx, cy, char_h, scale, 0.0, 0, 0)
            head_r = char_h * scale * 0.48
            # white 5-petal flower with yellow centre on the right temple
            fx = hx + head_r * 0.55
            fy = hy - head_r * 0.1
            petals = 5
            for i in range(petals):
                ang = math.radians(i * 360 / petals)
                px = fx + math.cos(ang) * head_r * 0.16
                py = fy + math.sin(ang) * head_r * 0.16
                draw.ellipse([px - head_r * 0.06, py - head_r * 0.06,
                              px + head_r * 0.06, py + head_r * 0.06],
                             fill=(255, 255, 254))
            draw.ellipse([fx - head_r * 0.07, fy - head_r * 0.07,
                          fx + head_r * 0.07, fy + head_r * 0.07],
                         fill=(242, 200, 40))

    # -- background + effects (adapter interface) ---------------------------

    def make_background(self, environment_text: str, width: int, height: int,
                        **extra) -> Img:
        """Render a layered, reusable background for a scene environment."""
        img = Image.new("RGB", (width, height))
        d = ImageDraw.Draw(img)
        env = (environment_text or "").lower()
        # sky gradient + time of day
        if any(k in env for k in ("night", "moon", "dark")):
            top, bot = (18, 22, 58), (8, 10, 30)
        elif any(k in env for k in ("sunset", "dramatic sunset", "dusk", "golden")):
            top, bot = (255, 150, 90), (60, 30, 80)
        elif "day" in env or "clearing" in env or "arena" in env or "village" in env:
            top, bot = (120, 180, 245), (70, 150, 230)
        else:
            top, bot = (90, 160, 235), (60, 130, 220)
        for y in range(height):
            ratio = y / max(height - 1, 1)
            r = int(top[0] * (1 - ratio) + bot[0] * ratio)
            g = int(top[1] * (1 - ratio) + bot[1] * ratio)
            b = int(top[2] * (1 - ratio) + bot[2] * ratio)
            d.line([(0, y), (width, y)], fill=(r, g, b))
        # ground
        ground_h = int(height * 0.18)
        gx0, gy0 = 0, height - ground_h
        if any(k in env for k in ("ruined", "arena", "stone", "cracked")):
            ground_col = (90, 85, 90)
            # cracked/stone pattern
            for _ in range(int(width / 22)):
                x = int(np.random.RandomState(self.seed).rand() * width)
                d.rectangle([x, gy0, x + int(2 + np.random.RandomState(self.seed).rand() * 4),
                             height], fill=ground_col)
        else:
            ground_col = (110, 170, 90)
            d.rectangle([0, gy0, width, height], fill=ground_col)
            # grass tufts
            for x in range(0, width, 7):
                h = int(3 + np.random.RandomState(self.seed + x).rand() * 5)
                d.line([(x, gy0), (x, gy0 - h)], fill=(90, 150, 70), width=1)
        # distant silhouettes (trees / buildings)
        rng = np.random.RandomState(self.seed + 7)
        if "tree" in env or "forest" in env or "clearing" in env or "village" in env:
            n = int(12 + rng.rand() * 8)
            for i in range(n):
                x = int(rng.rand() * width)
                th = int(30 + rng.rand() * 70)
                tw = int(th * (0.5 + rng.rand()))
                base_y = gy0 - 10
                # tree trunk
                d.rectangle([x - tw // 4, base_y - th // 2, x + tw // 4, base_y],
                            fill=(60, 45, 40))
                # foliage clusters
                d.ellipse([x - tw, base_y - th, x + tw, base_y - th // 2],
                           fill=(40, 90, 60))
        if "building" in env or "village" in env or "arena" in env or "ruined" in env:
            n = int(5 + rng.rand() * 6)
            for i in range(n):
                x = int(rng.rand() * width)
                bw = int(30 + rng.rand() * 80)
                bh = int(40 + rng.rand() * 140)
                by = gy0 - bh
                d.rectangle([x, by, x + bw, gy0 - 8], fill=(120, 110, 120))
                # roof
                d.polygon([
                    (x, by), (x + bw, by), (x + bw // 2, by - bh * 0.4)
                ], fill=(90, 80, 90))
        # moon (night) or sun (day)
        if "night" in env or "moon" in env:
            mx, my = width - 90, 90
            d.ellipse([mx - 30, my - 30, mx + 30, my + 30], fill=(245, 245, 220))
        elif "sunset" in env or "sun" in env or "day" in env:
            sx, sy = width - 80, 80
            d.ellipse([sx - 28, sy - 28, sx + 28, sy + 28], fill=(245, 200, 60))
            # cloud puffs
            for _ in range(4):
                cx = int(rng.rand() * width)
                cy = int(40 + rng.rand() * 40)
                r = int(18 + rng.rand() * 20)
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 240, 180))
        img = img.filter(ImageFilter.GaussianBlur(radius=1))
        # re-sharpen ground edge a touch by not blurring... (keep simple)
        return img

    def add_effect(self, frame: Img, effect: str, intensity: float = 1.0) -> Img:
        w, h = frame.size
        ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        e = effect.lower()
        if "dust" in e or "smoke" in e or "cloud" in e:
            rng = np.random.RandomState(hash(e + str(intensity)) & 0xffff)
            n = int(12 * intensity)
            for _ in range(n):
                x = int(rng.rand() * w)
                y = int(h * 0.55 + rng.rand() * h * 0.3)
                r = int(2 + rng.rand() * 5)
                a = int(120 * intensity)
                d.ellipse([x - r, y - r, x + r, y + r], fill=(200, 200, 200, a))
            ov = ov.filter(ImageFilter.GaussianBlur(3))
        elif "speed" in e or "motion" in e:
            rng = np.random.RandomState(hash("speed") & 0xffff)
            for _ in range(int(8 * intensity)):
                x = int(rng.rand() * w)
                y = int(rng.rand() * h * 0.6)
                d.line([x, y, x + int(20 + rng.rand() * 20), y],
                       fill=(255, 255, 255, int(200 * intensity)), width=1)
        elif "lightning" in e:
            rng = np.random.RandomState(hash("light") & 0xffff)
            for _ in range(int(3 * intensity)):
                x = int(rng.rand() * w)
                pts = [(x, 0)]
                cx, cy = x, 0
                for _ in range(8):
                    cx += int(-15 + rng.rand() * 30)
                    cy += int(40 + rng.rand() * 30)
                    pts.append((cx, cy))
                d.line(pts, fill=(230, 240, 255, int(220 * intensity)), width=2)
        elif "explosion" in e or "energy" in e or "fire" in e:
            cx, cy = w // 2, h // 2
            rng = np.random.RandomState(hash(e) & 0xffff)
            for r in range(int(50 * intensity)):
                ang = rng.rand() * 6.28
                rad = int(rng.rand() * 60)
                x = cx + math.cos(ang) * rad
                y = cy + math.sin(ang) * rad
                d.ellipse([x - 3, y - 3, x + 3, y + 3],
                          fill=(255, int(120 + rng.rand() * 100), 30, int(180 * intensity)))
            ov = ov.filter(ImageFilter.GaussianBlur(2))
        return Image.alpha_composite(frame.convert("RGBA"), ov).convert("RGB")

    # -- adapter interface --------------------------------------------------

    def generate_keyframe(self, character, pose_name: str,
                          environment_text: Optional[str], expression="neutral",
                          **extra) -> Img:
        """Draw a single character in a named pose on its own transparent layer."""
        sk = get_pose(pose_name)
        if expression:
            sk = dict(sk); sk["expression"] = expression
        w = int(extra.get("width", 1024)); h = int(extra.get("height", 576))
        pos = extra.get("position", (0.5, 0.88))
        scale = extra.get("scale", 0.55)
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        params = self._character_params(character)
        self._draw_body(draw, sk, pos[0] * w, pos[1] * h, h * 0.54, scale, params)
        self._draw_hair_back(draw, sk, pos[0] * w, pos[1] * h, h * 0.54, scale, params)
        self._draw_face(draw, sk, pos[0] * w, pos[1] * h, h * 0.54, scale, params)
        self._draw_hair_front(draw, sk, pos[0] * w, pos[1] * h, h * 0.54, scale, params)
        self._draw_clothes(draw, sk, pos[0] * w, pos[1] * h, h * 0.54, scale, params)
        self._draw_accessories(draw, sk, pos[0] * w, pos[1] * h, h * 0.54, scale, params)
        return overlay

    def interpolate(self, start: Img, end: Img, t: float,
                    direction: str = "forward") -> Img:
        """Pixel-level blend fallback (used only if pose data unavailable)."""
        if start.size != end.size:
            end = end.resize(start.size)
        t = max(0.0, min(1.0, t))
        return Image.blend(start.convert("RGBA"), end.convert("RGBA"), t).convert("RGB")


def lerp_pose(a: Dict, b: Dict, t: float) -> Dict:
    """Public pose lerp for the tween engine."""
    return _lerp_pose(a, b, t)
