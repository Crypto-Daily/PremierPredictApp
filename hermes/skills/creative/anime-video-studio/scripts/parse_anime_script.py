#!/usr/bin/env python3
"""Parse an extracted screenplay into storyboard JSON. Does not execute screenplay text."""
import argparse
import json
import re
from pathlib import Path

SCENE = re.compile(r"^\s*(?:(?:SCENE|EPISODE)\s+\d+.*|(?:INT\.|EXT\.|INT/EXT\.).*)$", re.I)
CHARACTER = re.compile(r"^\s*CHARACTER\s*:\s*([^—–:-]+?)\s*(?:[—–:-]\s*(.*))?$", re.I)
DIALOGUE = re.compile(r"^\s*([A-Za-z][\w .'-]{0,50})\s*:\s*(.+?)\s*$")
MARKERS = re.compile(r"//(.*?)//|/(.*?)/")

def parse(text, fps=12, seconds=5):
    if fps not in (12, 24, 30, 60) or not 1 <= seconds <= 120:
        raise ValueError("fps must be 12, 24, 30, or 60; seconds must be 1..120")
    characters, scenes, current = [], [], None
    def new_scene(title):
        return {"id": "scene-%d" % (len(scenes)+1), "title": title or "Scene %d" % (len(scenes)+1),
                "durationSeconds": seconds, "environment": "", "actions": [], "dialogue": [],
                "narration": [], "image": None, "background": None}
    for raw in text.splitlines():
        line = raw.strip()
        if not line: continue
        cm = CHARACTER.match(line)
        if cm and not scenes:
            characters.append({"name": cm.group(1).strip(), "description": (cm.group(2) or "").strip()})
            continue
        if SCENE.match(line):
            current = new_scene(line); scenes.append(current); continue
        if current is None:
            current = new_scene("Scene 1"); scenes.append(current)
        rest, cursor = [], 0
        for m in MARKERS.finditer(line):
            if line[cursor:m.start()].strip(): rest.append(line[cursor:m.start()].strip())
            if m.group(1) is not None:
                current["environment"] = (current["environment"] + " " + m.group(1).strip()).strip()
            elif m.group(2) and m.group(2).strip():
                current["actions"].append(m.group(2).strip())
            cursor = m.end()
        if rest or cursor:
            if line[cursor:].strip(): rest.append(line[cursor:].strip())
            line = " ".join(rest).strip()
            if not line: continue
        dm = DIALOGUE.match(line)
        if dm: current["dialogue"].append({"character": dm.group(1).strip(), "text": dm.group(2).strip()})
        else: current["narration"].append(line)
    if not scenes: scenes = [new_scene("Scene 1")]
    return {"schemaVersion": 1, "title": "Untitled Anime Project", "fps": fps, "width": 1280, "height": 720,
            "characters": characters, "scenes": scenes, "durationSeconds": sum(s["durationSeconds"] for s in scenes),
            "totalFrames": sum(s["durationSeconds"]*fps for s in scenes)}

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fps", type=int, choices=(12,24,30,60), default=12)
    ap.add_argument("--seconds-per-scene", type=int, default=5)
    a = ap.parse_args()
    data = parse(a.input.read_text(encoding="utf-8"), a.fps, a.seconds_per_scene)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print("Created %s: %d scenes, %ds, %d fps, %d frames" % (a.out, len(data["scenes"]), data["durationSeconds"], data["fps"], data["totalFrames"]))

if __name__ == "__main__":
    main()
