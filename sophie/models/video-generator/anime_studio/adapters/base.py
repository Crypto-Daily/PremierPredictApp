"""
adapters/base.py - Abstract image-model adapter.

The spec (section 12) wants *interchangeable* model adapters so different
image-generation, image-editing, interpolation, and voice models can be
integrated later.  This module defines exactly three hooks the pipeline ever
depends on:

    generate_keyframe(char, pose, env) -> PIL.Image   (spec 6.A)
    interpolate(start_img, end_img, t) -> PIL.Image   (spec 6.B)
    make_background(env) -> PIL.Image                  (shared environment)

Any concrete backend implements these three.  The shipped MVP ships a
`LocalRenderer` (free, runs everywhere) under local_renderer.py.  Dropping in
an AI backend is a 3-method class plus one config switch — no pipeline changes.

The `ImageModelAdapter` is intentionally *stateless* between calls except for a
shared `character_store` so the same character reference can be reused
(spec: "reuse the existing reference instead of inventing a new appearance").
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Dict, Optional
from PIL import Image  # noqa: F401  (re-exported as the canonical image type)

# Canonical image type used across all adapters.
Img = Image.Image


class ImageModelAdapter(ABC):
    """Interface every backend (local or AI) must implement."""

    def __init__(self, character_store: Optional[Dict] = None):
        self.character_store = character_store or {}

    # --- 6.A Keyframe generation -------------------------------------------
    @abstractmethod
    def generate_keyframe(self, character, pose_name: str,
                          environment_text: Optional[str],
                          expression: str = "neutral",
                          **extra) -> Img:
        """Render ONE keyframe: a single major pose of `character`."""

    # --- 6.B In-between frames --------------------------------------------
    @abstractmethod
    def interpolate(self, start: Img, end: Img, t: float,
                    direction: str = "forward") -> Img:
        """Generate one in-between frame at fraction `t` in [0,1]
        between two already-rendered keyframes."""

    # --- Shared environment ------------------------------------------------
    @abstractmethod
    def make_background(self, environment_text: str,
                        width: int, height: int, **extra) -> Img:
        """Render the static environment layer reused across all frames
        in a scene (spec: avoid regenerating the background every frame)."""

    # --- Consistency helper (spec 6.C) ------------------------------------
    def reference_image(self, character) -> Optional[Img]:
        """Return a cached reference/render of the character, or None.
        Used to validate/tie consistency.  Optional - may be a no-op."""
        return self.character_store.get(character.char_id)

    # --- Effects (spec 6.B) -----------------------------------------------
    def add_effect(self, frame: Img, effect: str, intensity: float = 1.0) -> Img:
        """Overlay a special effect (motion blur / speed lines / dust etc.).
        Default: no-op.  Backends override as needed."""
        return frame
