# Anime Video Generator (NEXUS-OMEGA / Sophie submodule)

An AI-powered 2D frame-by-frame anime animation generator inspired by FlipaClip,
but automated: you feed it a screenplay PDF and it produces keyframes, tweens,
arranges them chronologically, and exports an MP4.

This lives *inside* the Sophie repo at `models/video-generator/` so it is part
of the Sophie monorepo and can be reached by the orchestrator.

## Architecture (modular)

```
anime_studio/
  pdf_parser.py         - Minimal PDF text extractor (stdlib zlib only)
  screenplay_parser.py  - Parses the CHARACTER / action / // env // syntax
  character_manager.py  - Persistent character references (the "Character Bible")
  scene_planner.py      - Builds an animation plan: key poses + frame counts
  keyframe_engine.py    - Generates keyframe images (local PIL renderer)
  tween_engine.py       - In-between frame interpolation (position/rotation/scale)
  frame_consistency.py  - Consistency rules (identity, proportions, style)
  frame_store.py        - Persisted frames + timeline model
  renderer.py           - FFmpeg MP4 assembly (resumable)
  settings.py           - RenderSettings (fps, resolution, aspect, style)
  project.py            - Project save/load + autosave/recovery
  adapters/
    base.py             - Abstract image-model adapter (swap AI in/out)
    local_renderer.py   - Local free renderer (Pillow) - the MVP backend
  pipeline.py           - Orchestrates the full workflow end-to-end
webapp.py               - Flask web UI (connect to it: http://localhost:5001)
run.py                  - CLI entry point
tests/                  - pytest-style tests + sample screenplay PDF
```

## Design notes (per the spec)

- **Local/free alternative first.** Keyframe + tween generation is handled by a
  `LocalRenderer` (Pillow + numpy) so the MVP works with *zero* paid API keys or
  credits. An abstract `ImageModelAdapter` makes it trivial to plug in DALL·E,
  Stable Diffusion, or any future AI service — just implement the three methods.
- **Adapter pattern = interchangeable models.** `generate_keyframe`,
  `interpolate`, and `make_background` are the only hooks the pipeline ever calls.
- **Frame economy.** We do NOT generate N independent images per frame. Key poses
  are authored once per character; tweens are procedural interpolations; the
  background is a single layered image reused across frames.
- **Consistency.** Character appearance is parametric (colors/proportions held in
  the `Character` object), so every frame drawn from the same reference is
  pixel-consistent by construction.

## Run

```bash
cd /home/ubuntu/sophie/models/video-generator
python3 run.py --sample            # generates a sample screenplay PDF, runs full pipeline
python3 webapp.py                  # Flask UI on :5001
```

Requires: Python 3 stdlib + Pillow + numpy + Flask + FFmpeg (system). All present
in the Sophie runtime. No pip installs needed.
