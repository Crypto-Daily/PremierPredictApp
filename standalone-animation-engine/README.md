# Standalone 2D Animation Engine

A small, CPU-friendly Python project for generating original cartoon illustrations and short looping GIF animations from text prompts. It is deliberately independent of Sophie and Hermes and makes no network/API calls.

## What this first version does

- Draws a polished, layered cartoon cat using Pillow at high resolution with supersampling.
- Accepts simple text prompts such as `orange cat`, `black cat`, `white cat`, `sleeping cat`, and `running cat`.
- Exports a PNG still image or a looping GIF.
- Keeps the drawing and animation logic local; no paid API, model download, or GPU is required.
- Includes a smoke test that checks PNG/GIF output.

This is a **procedural illustration engine**, not a general-purpose text-to-image neural model. The prompt currently selects and configures a hand-built drawing grammar. It will not yet invent arbitrary scenes or match a hosted image model for unrestricted prompts.

## Install (Ubuntu)

Run from the repository root:

```bash
cd standalone-animation-engine
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If the virtual environment fails because `venv` is missing, install the OS package first: `sudo apt-get update && sudo apt-get install -y python3-venv python3-pip`.

## Generate a still image

```bash
python engine.py "cute orange tabby cat with green eyes" --output output/cat.png --size 768
```

## Generate a running-cat GIF

```bash
python engine.py "running orange cat" --output output/running-cat.gif --size 512 --frames 24 --fps 12
```

## Run the smoke test

```bash
python -m unittest -v
```

## CLI options

- `--output`: output filename; `.png` creates a still image and `.gif` creates an animation.
- `--size`: square output size (default 512; minimum 128).
- `--frames`: animation frame count (default 24).
- `--fps`: animation playback rate (default 12).
- `--background`: background colour as a Pillow colour name or hex value (default `#FFF7E8`).

## Architecture and next steps

The code separates prompt parsing, frame drawing, and export. Extend it with reusable character parts, pose definitions, scene layouts, and more drawing grammars. Add a video exporter later if FFmpeg is installed. Do not couple this package to Sophie/Hermes; it can be moved to its own repository at any time.
