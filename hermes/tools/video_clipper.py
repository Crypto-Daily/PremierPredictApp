#!/usr/bin/env python3
"""Create short highlight clips from videos you own or are authorized to repurpose.

Requires: Python 3.10+, yt-dlp, and ffmpeg on PATH.
Optional: openai-whisper (the `whisper` CLI) for transcript-based selection/captions.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ENERGY_WORDS = {
    "amazing", "unbelievable", "important", "secret", "finally", "never",
    "always", "mistake", "best", "worst", "incredible", "crazy", "shocking",
    "why", "how", "truth", "proof", "win", "fail", "money", "free",
}


def run(command: list[str], *, capture: bool = False) -> str:
    try:
        result = subprocess.run(
            command, check=True, text=True,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required command not found: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip()
        raise RuntimeError(f"Command failed ({exc.returncode}): {' '.join(command)}\n{detail}") from exc
    return result.stdout if capture else ""


def probe_youtube(url: str) -> dict[str, Any]:
    raw = run(["yt-dlp", "--no-warnings", "--no-playlist", "--dump-single-json", url], capture=True)
    return json.loads(raw)


def download_video(url: str, destination: Path) -> Path:
    template = str(destination / "source.%(ext)s")
    run([
        "yt-dlp", "--no-warnings", "--no-playlist",
        "-f", "bv*+ba/b", "--merge-output-format", "mp4",
        "-o", template, url,
    ])
    matches = sorted(destination.glob("source.*"))
    matches = [p for p in matches if p.suffix.lower() not in {".part", ".json", ".webm.ytdl"}]
    if not matches:
        raise RuntimeError("yt-dlp completed but no source video was found.")
    return matches[0]


def parse_time(value: str) -> float:
    parts = value.strip().split(":")
    if not 1 <= len(parts) <= 3:
        raise argparse.ArgumentTypeError(f"Invalid timestamp: {value}")
    try:
        nums = [float(part) for part in parts]
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"Invalid timestamp: {value}") from exc
    total = 0.0
    for part in nums:
        total = total * 60 + part
    if total < 0:
        raise argparse.ArgumentTypeError("Timestamp cannot be negative.")
    return total


def manual_segments(values: list[str]) -> list[dict[str, Any]]:
    result = []
    for index, value in enumerate(values, 1):
        try:
            start_text, end_text = value.split("-", 1)
            start, end = parse_time(start_text), parse_time(end_text)
        except ValueError as exc:
            raise ValueError(f"Bad --segment '{value}'. Use START-END, e.g. 00:01:10-00:01:45") from exc
        if end <= start:
            raise ValueError(f"Segment end must be after start: {value}")
        result.append({"start": start, "end": end, "title": f"manual-{index}"})
    return result


def chapter_segments(info: dict[str, Any], minimum: float, maximum: float) -> list[dict[str, Any]]:
    segments = []
    for chapter in info.get("chapters") or []:
        start, end = float(chapter.get("start_time") or 0), float(chapter.get("end_time") or 0)
        if minimum <= end - start <= maximum:
            segments.append({"start": start, "end": end, "title": chapter.get("title") or "chapter"})
    return segments


def transcribe(video: Path, workdir: Path, model: str) -> tuple[list[dict[str, Any]], Path | None]:
    if not shutil.which("whisper"):
        raise RuntimeError("Transcript mode needs the optional openai-whisper CLI. Install it with: pip install -U openai-whisper")
    output = workdir / "transcript"
    output.mkdir(exist_ok=True)
    run(["whisper", str(video), "--model", model, "--output_format", "all", "--output_dir", str(output)])
    json_files = list(output.glob("*.json"))
    if not json_files:
        raise RuntimeError("Whisper did not produce a JSON transcript.")
    data = json.loads(json_files[0].read_text(encoding="utf-8"))
    return data.get("segments", []), next(iter(output.glob("*.srt")), None)


def transcript_segments(segments: list[dict[str, Any]], minimum: float, maximum: float, limit: int) -> list[dict[str, Any]]:
    candidates = []
    for index, segment in enumerate(segments):
        start = max(0.0, float(segment.get("start", 0)))
        end = float(segment.get("end", 0))
        if end <= start:
            continue
        text = str(segment.get("text", "")).strip()
        duration = end - start
        if not text or duration < 1:
            continue
        words = re.findall(r"[A-Za-z']+", text.lower())
        score = sum(2 for word in words if word in ENERGY_WORDS)
        score += min(len(words), 35) / 12
        score += 0.8 if re.search(r"[!?]", text) else 0
        # Include a little context around the spoken sentence.
        candidates.append({"start": max(0, start - 2), "end": end + 3, "title": text[:72], "score": score, "index": index})
    candidates.sort(key=lambda item: item["score"], reverse=True)
    chosen: list[dict[str, Any]] = []
    for item in candidates:
        duration = item["end"] - item["start"]
        if duration < minimum:
            item["end"] = item["start"] + minimum
        elif duration > maximum:
            item["end"] = item["start"] + maximum
        if any(not (item["end"] <= old["start"] or item["start"] >= old["end"]) for old in chosen):
            continue
        chosen.append(item)
        if len(chosen) >= limit:
            break
    return sorted(chosen, key=lambda item: item["start"])


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-_").lower()
    return (cleaned[:48] or "highlight")


def cut_clip(source: Path, segment: dict[str, Any], output: Path, aspect: str, captions: Path | None) -> None:
    filters = []
    if aspect == "9:16":
        filters.append("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920")
    elif aspect == "1:1":
        filters.append("scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080")
    if captions:
        escaped = str(captions.resolve()).replace("\\", "/").replace(":", "\\:")
        filters.append(f"subtitles='{escaped}'")
    command = [
        "ffmpeg", "-hide_banner", "-y", "-ss", f"{segment['start']:.3f}",
        "-i", str(source), "-t", f"{segment['end'] - segment['start']:.3f}",
        "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "21", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    ]
    if filters:
        command += ["-vf", ",".join(filters)]
    command.append(str(output))
    run(command)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download and create YouTube highlight clips.")
    parser.add_argument("url", help="YouTube URL (only videos you own or have permission to repurpose)")
    parser.add_argument("--out", default="clips", help="Output folder (default: clips)")
    parser.add_argument("--aspect", choices=["9:16", "16:9", "1:1"], default="9:16")
    parser.add_argument("--mode", choices=["chapters", "transcript", "manual"], default="transcript")
    parser.add_argument("--segment", action="append", default=[], help="Manual START-END timestamp; repeat as needed")
    parser.add_argument("--min-duration", type=float, default=15)
    parser.add_argument("--max-duration", type=float, default=60)
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--whisper-model", default="base", help="Whisper model: tiny, base, small, medium, large")
    parser.add_argument("--captions", action="store_true", help="Burn Whisper-generated captions into clips (transcript mode)")
    args = parser.parse_args()

    if args.min_duration <= 0 or args.max_duration < args.min_duration or args.limit < 1:
        parser.error("Durations and limit must be positive; max-duration must be >= min-duration.")
    if args.mode == "manual" and not args.segment:
        parser.error("Manual mode requires at least one --segment START-END.")

    outdir = Path(args.out).expanduser().resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    try:
        info = probe_youtube(args.url)
        with tempfile.TemporaryDirectory(prefix="hermes-clipper-") as temp:
            workdir = Path(temp)
            video = download_video(args.url, workdir)
            captions = None
            if args.mode == "manual":
                selected = manual_segments(args.segment)
            elif args.mode == "chapters":
                selected = chapter_segments(info, args.min_duration, args.max_duration)
            else:
                transcript, captions = transcribe(video, workdir, args.whisper_model)
                selected = transcript_segments(transcript, args.min_duration, args.max_duration, args.limit)
            if not selected:
                raise RuntimeError("No suitable highlights found. Try manual timestamps or adjust duration limits.")
            selected = selected[:args.limit]
            manifest = []
            for index, segment in enumerate(selected, 1):
                title = safe_name(str(segment.get("title", f"clip-{index}")))
                target = outdir / f"clip_{index:02d}_{title}.mp4"
                cut_clip(video, segment, target, args.aspect, captions if args.captions else None)
                manifest.append({"file": target.name, "start": segment["start"], "end": segment["end"], "title": segment.get("title", "")})
                print(f"Created {target}")
            (outdir / "clips.json").write_text(json.dumps({"source": info.get("webpage_url", args.url), "clips": manifest}, indent=2), encoding="utf-8")
            print(f"Done: {len(manifest)} clip(s) saved in {outdir}")
    except (RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
