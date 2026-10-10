"""
settings.py - Render/animation settings + named constants.

The spec asks for a settings surface covering fps, resolution, aspect ratio,
art style, quality, seed, etc.  We model it as a dataclass so the pipeline,
web UI, CLI and project files all share one representation.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Tuple

# --- Named option sets (mirrors the spec's lists) ---------------------------

FPS_OPTIONS = [6, 8, 12, 15, 24, 30]   # spec: exact list
RESOLUTIONS = {
    "480p":  (854, 480),
    "720p":  (1280, 720),
    "1080p": (1920, 1080),
    "4K":    (3840, 2160),
}
ASPECT_RATIOS = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "1:1":  1.0,
}
ART_STYLES = [
    "shoujo",            # vibrant, soft - what the spec describes
    "seinen",            # sharper, coarser
    "chibi",             # super-deformed
    "semi-realistic",
]
LINE_QUALITY = ["rough", "clean", "sharp"]
COMPLEXITY = ["simple", "standard", "detailed"]
CAMERA_MOTION = ["static", "subtle", "dynamic"]
MOTION_SMOOTH = ["limited", "smooth", "frame-interpolated"]
BG_DETAIL = ["minimal", "standard", "detailed"]
QUALITY = ["preview", "draft", "final"]

DEFAULT_SETTINGS = {
    "fps": 12,
    "resolution": "720p",
    "aspect_ratio": "16:9",
    "art_style": "shoujo",
    "line_quality": "clean",
    "animation_complexity": "standard",
    "camera_motion_intensity": "subtle",
    "motion_smoothness": "smooth",
    "background_detail": "standard",
    "character_consistency_strength": 0.9,
    "seed": 0,
    "preview_quality": "draft",
    "final_render_quality": "final",
}


@dataclass
class RenderSettings:
    """All knobs the user can turn (spec sections 7 & 12)."""
    fps: int = 12
    resolution: str = "720p"          # key into RESOLUTIONS
    aspect_ratio: str = "16:9"          # key into ASPECT_RATIOS
    art_style: str = "shoujo"
    line_quality: str = "clean"
    animation_complexity: str = "standard"
    camera_motion_intensity: str = "subtle"
    motion_smoothness: str = "smooth"
    background_detail: str = "standard"
    character_consistency_strength: float = 0.9
    seed: int = 0
    preview_quality: str = "draft"
    final_render_quality: str = "final"
    two_frame_hold: int = 1           # hold each drawing for N output frames

    # Derived (computed, not user-facing JSON keys in the simple form)
    @property
    def width(self) -> int:
        base_w, _ = RESOLUTIONS[self.resolution]
        ar = ASPECT_RATIOS[self.aspect_ratio]
        # If aspect is portrait, height > width. Resolve to integer dims.
        if self.aspect_ratio == "16:9":
            return base_w
        if self.aspect_ratio == "9:16":
            return int(base_w * 9 / 16)
        return int(base_w)  # 1:1 square

    @property
    def height(self) -> int:
        _, base_h = RESOLUTIONS[self.resolution]
        if self.aspect_ratio == "16:9":
            return base_h
        if self.aspect_ratio == "9:16":
            return int(base_h)
        return int(base_h)

    def dims(self) -> Tuple[int, int]:
        return self.width, self.height

    def to_dict(self) -> dict:
        d = asdict(self)
        d["width"] = self.width
        d["height"] = self.height
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "RenderSettings":
        # ignore unknown keys / derived ones
        known = {k: v for k, v in d.items() if k in {f.name for f in cls.__dataclass_fields__.values()}}
        return cls(**known)


# A named "hold" strategy: 24fps playback, 2-frame holds => ~12 drawings/sec.
# Expressed as (unique_drawings_per_second).
def drawings_per_second(fps: int, hold: int) -> float:
    return fps / hold
