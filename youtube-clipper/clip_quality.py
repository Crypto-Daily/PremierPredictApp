from __future__ import annotations

import re
import subprocess
from pathlib import Path

HOOK_WORDS = {
    "wait", "what", "who", "how", "why", "look", "watch", "no", "never",
    "insane", "crazy", "unbelievable", "finally", "secret", "truth", "actually",
    "bro", "oh", "wow", "help", "run", "go", "damn", "seriously", "listen",
}
EMOTION_WORDS = {
    "amazing", "terrible", "shocking", "incredible", "funny", "crazy", "angry",
    "love", "hate", "fear", "laugh", "screaming", "beautiful", "wild", "epic",
    "unbelievable", "insane", "wow", "damn", "hell", "no", "yes",
}
CLOSING_PHRASES = (
    "and that's", "there you go", "that was", "finally", "in the end",
    "that's it", "we did it", "mission complete", "game over",
)


def _clamp(value: float) -> int:
    return max(0, min(100, round(value)))


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    whole = int(seconds % 60)
    centiseconds = int((seconds - int(seconds)) * 100)
    return f"{hours}:{minutes:02d}:{whole:02d}.{centiseconds:02d}"


def _ass_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def create_styled_captions(segments: list, clip_start: float, clip_end: float, destination: Path) -> int:
    """Write a bold, bottom-centred ASS subtitle track with highlighted keywords."""
    words = []
    for segment in segments:
        segment_start = float(segment.get("start", 0.0))
        segment_end = float(segment.get("end", segment_start + 1.0))
        raw_words = segment.get("words") or []
        if raw_words:
            for word in raw_words:
                token = str(word.get("word", "")).strip()
                if not token:
                    continue
                start = float(word.get("start", segment_start))
                end = float(word.get("end", max(start + 0.12, segment_end)))
                if end > clip_start and start < clip_end:
                    words.append((max(0.0, start - clip_start), min(clip_end - clip_start, end - clip_start), token))
        else:
            tokens = str(segment.get("text", "")).split()
            if not tokens:
                continue
            span = max(0.2, segment_end - segment_start)
            step = span / len(tokens)
            for index, token in enumerate(tokens):
                start = segment_start + index * step
                end = start + step
                if end > clip_start and start < clip_end:
                    words.append((max(0.0, start - clip_start), min(clip_end - clip_start, end - clip_start), token))

    words.sort(key=lambda item: item[0])
    events = []
    for offset in range(0, len(words), 5):
        group = words[offset:offset + 5]
        if not group:
            continue
        start = group[0][0]
        end = max(group[-1][1], start + 0.35)
        rendered = []
        for _, _, token in group:
            clean = _ass_escape(token)
            key = re.sub(r"[^a-z']", "", clean.lower())
            if key in HOOK_WORDS or key in EMOTION_WORDS or key.isupper() and len(key) >= 3:
                rendered.append(r"{\c&H0039D7FF&\b1}" + clean + r"{\c&H00FFFFFF&\b0}")
            else:
                rendered.append(clean)
        events.append(
            f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Default,,0,0,0,,"
            + " ".join(rendered)
        )

    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 720
PlayResY: 1280
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,4,1,2,48,48,105,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    destination.write_text(header + "\n".join(events) + "\n", encoding="utf-8")
    return len(events)


def _visual_audio_signals(source: Path, start: float, duration: float) -> tuple[int, float]:
    """Sample scene changes and audio peak level as lightweight gameplay-energy proxies."""
    command = [
        "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "info",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
        "-vf", "fps=1/2,select='gt(scene,0.18)',showinfo",
        "-af", "volumedetect", "-f", "null", "-"
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        log = result.stderr or ""
        scene_changes = len(re.findall(r"showinfo.*\bn:\s*\d+", log))
        match = re.search(r"max_volume:\s*(-?[\d.]+)\s*dB", log)
        peak_db = float(match.group(1)) if match else -30.0
        return min(scene_changes, 30), peak_db
    except (OSError, subprocess.SubprocessError, ValueError):
        return 0, -30.0


def rank_clip_quality(source: Path, pick: dict, segments: list) -> dict:
    text = str(pick.get("text", "")).strip()
    words = re.findall(r"[a-z']+", text.lower())
    if not words:
        words = []
    opening = words[:18]
    opening_score = 35 + min(35, sum(word in HOOK_WORDS for word in opening) * 12)
    if text[:1].isupper():
        opening_score += 8
    if "?" in text[:100] or "!" in text[:100]:
        opening_score += 12
    opening_score = _clamp(opening_score)

    emotion_hits = sum(word in EMOTION_WORDS for word in words)
    dialogue_score = _clamp(25 + min(45, emotion_hits * 7) + min(20, text.count("?") * 5 + text.count("!") * 4)
                            + min(10, len(set(words)) / 5))

    duration = max(1.0, float(pick["end"]) - float(pick["start"]))
    scene_changes, peak_db = _visual_audio_signals(source, float(pick["start"]), duration)
    gameplay_score = _clamp(25 + min(55, scene_changes * 7) + max(0, min(20, (peak_db + 35) * 1.2)))

    starts_cleanly = bool(re.search(r"(^|[.!?]\s+)[A-Z0-9]", text))
    ends_cleanly = bool(re.search(r"[.!?…][\"')\]]?\s*$", text))
    context_score = _clamp(35 + min(35, len(words) / 4) + (15 if starts_cleanly else 0) + (15 if ends_cleanly else 0))

    ending = text[-180:].lower()
    ending_score = 35 + (35 if re.search(r"[.!?…][\"')\]]?\s*$", text) else 0)
    ending_score += min(30, sum(phrase in ending for phrase in CLOSING_PHRASES) * 15)
    ending_score = _clamp(ending_score)

    total = round(opening_score * .20 + dialogue_score * .20 + gameplay_score * .25
                  + context_score * .20 + ending_score * .15)
    return {
        "total": total,
        "opening": opening_score,
        "dialogue": dialogue_score,
        "gameplay": gameplay_score,
        "context": context_score,
        "ending": ending_score,
        "method": "Transcript cues plus sampled scene-change and audio-level signals"
    }
