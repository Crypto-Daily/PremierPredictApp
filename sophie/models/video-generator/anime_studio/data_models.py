"""
data_models.py - Core domain objects shared by every stage of the pipeline.

These dataclasses carry facts (character, scene, action, frame spec) between the
parser, planner, engines and renderer.  They are deliberately *declarative* and
free of rendering logic so they stay serializable for project save/load.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# --- Character bible ---------------------------------------------------------

@dataclass
class Character:
    """
    The persistent visual reference for one character (spec 3, "Character Bible").

    `params` holds the parametric appearance the *local* renderer draws with;
    an AI adapter would turn the same text description into a seed/reference.
    Either way, re-using this object guarantees identity consistency across
    scenes (spec 6.C).
    """
    char_id: str            # e.g. "CHAR_001"
    name: str               # display name, e.g. "KAI" -> "Kai"
    raw_description: str    # full text from the bible
    # Parametric appearance (filled from the description by character_manager)
    age: int = 0
    skin_tone: str = "fair"
    eye_shape: str = "round"      # round / almond / narrow
    eye_color: str = "brown"
    hair_style: str = "short"
    hair_color: str = "black"
    hair_length: float = 0.45     # fraction of body height
    height: float = 1.0          # relative body height (1.0 = baseline)
    build: str = "slim"          # slim / athletic / heavy
    clothing: str = "casual"
    primary_color: str = "#4a90e2"
    secondary_color: str = "#333333"
    accent_color: str = "#e67e22"
    distinctive: str = ""        # e.g. "scar above left eyebrow"
    palette: List[str] = field(default_factory=list)

    def display_name(self) -> str:
        # Prefer a cleaned name; fall back to id.
        return self.name if self.name else self.char_id


# --- Parsed screenplay line --------------------------------------------------

@dataclass
class CharacterAction:
    """One parsed slash-syntax entry: NAME / action / // environment //"""
    character_name: str
    character_id: Optional[str] = None
    action_text: str = ""
    expression: str = "neutral"
    dialogue: Optional[str] = None      # extracted if the action contains a quote
    environment_text: Optional[str] = None
    # Populated by the scene planner
    start_keyframe: int = 0
    end_keyframe: int = 0
    frame_count: int = 0


@dataclass
class Scene:
    """A single scene (spec 5) with its planned frame breakdown."""
    scene_id: str                       # e.g. "SCENE_001"
    title: str = ""
    duration_seconds: float = 3.0       # estimated from actions / speaking time
    actions: List[CharacterAction] = field(default_factory=list)
    environment_text: Optional[str] = None
    characters_present: List[str] = field(default_factory=list)
    camera: str = "medium-shot"
    lighting: str = "neutral"
    estimated_frames: int = 0
    keyframes: List[Dict] = field(default_factory=list)   # planned key poses
    notes: str = ""


@dataclass
class Screenplay:
    """Top-level parsed artifact."""
    title: str = "Untitled"
    character_bible: List[Character] = field(default_factory=list)
    scenes: List[Scene] = field(default_factory=list)
    raw_text: str = ""

    def character_by_id(self, cid: str) -> Optional[Character]:
        for c in self.character_bible:
            if c.char_id == cid or c.name.upper() == cid.upper():
                return c
        return None

    def character_by_name(self, name: str) -> Optional[Character]:
        nu = name.strip().upper()
        for c in self.character_bible:
            if c.name.upper() == nu or c.char_id == nu:
                return c
        # fuzzy: match if the upper-cased stored name starts with the token
        for c in self.character_bible:
            if c.name.upper().startswith(nu):
                return c
        return None


# --- Animation plan ----------------------------------------------------------

@dataclass
class KeyframePlan:
    """A planned keyframe for one character within a scene."""
    scene_id: str
    frame_index: int                  # absolute timeline frame
    character: str
    pose_name: str                    # e.g. "standing", "jump-start"
    expression: str = "neutral"
    position: Tuple[float, float] = (0.0, 0.0)   # normalized (0..1)
    angle: float = 0.0                # degrees
    scale: float = 1.0
    extra: Dict = field(default_factory=dict)


@dataclass
class FrameSpec:
    """The complete instruction for drawing one output frame."""
    global_index: int
    scene_id: str
    frame_index_in_scene: int
    settings: Optional[dict] = None   # snapshot of RenderSettings at render time
    environment_text: Optional[str] = None
    camera_state: Dict = field(default_factory=dict)
    character_states: List[Dict] = field(default_factory=list)
    effects: List[str] = field(default_factory=list)
    layer_cache_key: Optional[str] = None

    # NOTE: `character_states` is a list of dicts: {character, pose, expression,
    # position, angle, scale, hold_for}.  Using plain dicts (not dataclasses)
    # here keeps serialization trivial for project save/load.
