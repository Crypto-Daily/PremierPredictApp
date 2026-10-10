"""
screenplay_parser.py - Parse the custom slash syntax + Character Bible.

Spec 4 grammar for one action line:

    CHARACTER_NAME / CHARACTER_ACTION_AND_EXPRESSION / // ENVIRONMENT_DESCRIPTION //

Parsing rules implemented (per spec):
  * action begins with a single "/" and ends with a single "/".
  * environment begins with a double "//" and ends with a double "//".
  * the "/" that closes the action is immediately followed by "//" that opens
    the environment, i.e. the boundary is literally  `/ //`.
  * a scene may contain MULTIPLE characters, each on its own line.
  * dialogue (quoted speech) embedded in an action is extracted.

Also parses:
  * `CHARACTER: NAME | ID: CHAR_001` bible headers + the description block.
  * `SCENE_NNN INT|EXT. LOCATION - TIME` scene headers.
"""
from __future__ import annotations
import re
from typing import List, Optional, Tuple

from .data_models import Character, CharacterAction, Scene, Screenplay
from .pdf_parser import split_sections

# --- Regexes ----------------------------------------------------------------

# A single action line: NAME / action / // environment //
#   group1 = character name (UPPER token)
#   group2 = action text (non-greedy, stops at the `/ //` boundary)
#   group3 = environment text (non-greedy, stops at closing `//`)
ACTION_RE = re.compile(
    r"^\s*([A-Z][A-Z0-9_]+)"          # character name token
    r"\s*/\s*"                        # opening single slash
    r"(.*?)"                          # action (non-greedy)
    r"\s*/\s*//\s*"                  # close action slash + open env double slash
    r"(.*?)"                          # environment (non-greedy)
    r"\s*//\s*$",                     # close env double slash
    re.DOTALL,
)

# Scene header: SCENE_001 INT. RUINED VILLAGE - NIGHT
SCENE_RE = re.compile(
    r"^(SCENE[_\s]*?(\d+))"            # SCENE_ / SCENE001 / SCENE 001  -> g1,g2
    r"\s*(?:/\s*)?"                    # optional "/"
    r"\s*(INT|EXT)\.?\s*"              # INT. / EXT.                      -> g3
    r"(.+?)"                           # location + time                  -> g4
    r"\s*$",
    re.IGNORECASE,
)

CHAR_BIBLE_RE = re.compile(
    r"^CHARACTER\s*:\s*([A-Z][A-Z0-9_\s]+?)\s*\|\s*ID\s*:\s*(\S+)", re.IGNORECASE
)
CHAR_BIBLE_RE_NOID = re.compile(
    r"^CHARACTER\s*:\s*([A-Z][A-Z0-9_\s]+)", re.IGNORECASE
)

_CHAR_SCENE_BOUNDARY = re.compile(r"^(CHARACTER|SCENE|INT|EXT)", re.IGNORECASE)


# --- Helpers -----------------------------------------------------------------

def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _extract_character_bible(text: str) -> List[Character]:
    """Pull `CHARACTER: NAME | ID: CID` headers + their description blocks."""
    characters: List[Character] = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        m = CHAR_BIBLE_RE.match(line)
        if not m:
            m = CHAR_BIBLE_RE_NOID.match(line)
        if not m:
            i += 1
            continue
        name = _clean(m.group(1))
        if m.re.groups >= 2 and m.group(2):
            cid = m.group(2).strip()
        else:
            cid = "CHAR_%03d" % (len(characters) + 1)
        i += 1
        desc_lines: List[str] = []
        # collect description until the next CHARACTER/INT/EXT scene header
        while i < len(lines):
            nxt = lines[i].strip()
            if _CHAR_SCENE_BOUNDARY.match(nxt):
                break
            if not nxt:
                # tolerate a single blank line only if a real line follows
                if (i + 1 < len(lines)
                        and not _CHAR_SCENE_BOUNDARY.match(lines[i + 1].strip())):
                    i += 1
                    continue
                break
            desc_lines.append(lines[i].rstrip())
            i += 1
        characters.append(Character(
            char_id=cid, name=name.upper(),
            raw_description=_clean(" ".join(desc_lines))))
    return characters


def _extract_dialogue(action_text: str) -> Optional[str]:
    """Extract quoted dialogue from an action text.

    Looks for the first double quote following an optional 'says' keyword and
    returns the text up to the closing double quote.  Falls back to single
    quotes.  Apostrophes inside the quote (e.g. "shouldn't") are handled correctly
    because we match on the quote *character* rather than a bracket regex.
    """
    low = action_text.lower()
    idx = low.find("says")
    search_from = idx if idx != -1 else 0
    # prefer double quotes
    start = action_text.find('"', search_from)
    if start != -1:
        end = action_text.find('"', start + 1)
        if end != -1:
            return action_text[start + 1:end].strip()
    # fallback single quotes
    start = action_text.find("'", search_from)
    if start != -1:
        end = action_text.find("'", start + 1)
        if end != -1:
            return action_text[start + 1:end].strip()
    return None


def _infer_expression(action_text: str) -> str:
    low = action_text.lower()
    rules = [
        (["nervous", "worried", "scared", "afraid", "tense", "anxious"], "nervous"),
        (["smile", "smiles", "smiling", "slight smile", "happy"], "smile"),
        (["raise eyebrow", "sarcastic"], "sarcastic"),
        (["angry", "furious", "rage"], "angry"),
        (["determined", "focus"], "determined"),
    ]
    for words, expr in rules:
        if any(w in low for w in words):
            return expr
    if "fist" in low or "punch" in low:
        return "determined"
    return "neutral"


def _parse_action_line(line: str) -> Optional[CharacterAction]:
    m = ACTION_RE.match(line)
    if not m:
        return None
    name = m.group(1).strip()
    action_text = _clean(m.group(2))
    env_text = _clean(m.group(3))
    dialogue = _extract_dialogue(action_text)
    expr = _infer_expression(action_text)
    return CharacterAction(
        character_name=name,
        action_text=action_text,
        expression=expr,
        dialogue=dialogue,
        environment_text=env_text,
    )


def _split_location_time(details: str) -> Tuple[str, str]:
    """Split 'RUINED VILLAGE - NIGHT' or 'RUINED VILLAGE AT NIGHT' -> (loc, t)."""
    for sep in (" - ", " AT ", " -- "):
        if sep in details:
            loc, _, t = details.partition(sep)
            return _clean(loc), _clean(t)
    return _clean(details), ""


def _derive_title(text: str) -> str:
    for ln in text.split("\n"):
        s = ln.strip()
        if not s:
            continue
        if re.match(r"^(CHARACTER|SCENE_)", s, re.IGNORECASE):
            return "Untitled Screenplay"
        return s[:80]
    return "Untitled Screenplay"


def parse_screenplay(text: str) -> Screenplay:
    """Parse full screenplay text into a structured Screenplay object."""
    sections = split_sections(text)
    bible_text = sections.get("character_bible", "") or ""
    script_text = sections.get("screenplay", text) or text

    # Characters: prefer the explicitly-delimited bible; fall back to the whole
    # text if the splitter found nothing (some PDFs have no clear boundary).
    characters = _extract_character_bible(bible_text) if bible_text else []
    if not characters:
        characters = _extract_character_bible(text)

    scenes: List[Scene] = []
    lines = script_text.split("\n")
    current_scene: Optional[Scene] = None
    scene_counter = 0
    env_accum: List[str] = []

    for raw in lines:
        stripped = raw.strip()
        if not stripped:
            continue

        # scene header
        sm = SCENE_RE.match(stripped)
        if sm:
            if current_scene:
                _flush_scene(current_scene, env_accum, scenes)
                env_accum = []
            scene_counter += 1
            scene_id = sm.group(1).replace(" ", "_").replace("/", "_").upper()
            location, time_of_day = _split_location_time(_clean(sm.group(4)))
            current_scene = Scene(
                scene_id=scene_id,
                title=(_clean(location + " " + time_of_day) or location),
                environment_text=location,
            )
            continue

        # action line (slash syntax)
        action = _parse_action_line(stripped)
        if action:
            if current_scene is None:
                scene_counter += 1
                current_scene = Scene(
                    scene_id="SCENE_%03d" % scene_counter,
                    title="Scene %d" % scene_counter,
                )
            current_scene.actions.append(action)
            if action.environment_text:
                env_accum.append(action.environment_text)
            continue

        # prose / description line (not slash syntax) - treat as scene description
        if current_scene:
            if current_scene.environment_text:
                current_scene.environment_text += " " + _clean(stripped)
            else:
                current_scene.environment_text = _clean(stripped)

    if current_scene:
        _flush_scene(current_scene, env_accum, scenes)

    return Screenplay(
        title=_derive_title(text),
        character_bible=characters,
        scenes=scenes,
        raw_text=text,
    )


def _flush_scene(scene: Scene, env_accum: List[str], scenes: List[Scene]) -> None:
    # Only back-fill the scene environment if the header gave us none; the
    # per-action environments live on the actions themselves.
    if not scene.environment_text and env_accum:
        scene.environment_text = "; ".join(env_accum)
    seen = set()
    for a in scene.actions:
        key = a.character_name.upper()
        if key not in seen:
            seen.add(key)
            scene.characters_present.append(a.character_name)
    scenes.append(scene)
