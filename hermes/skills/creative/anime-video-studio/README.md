# Hermes Anime Video Studio

This feature converts extracted screenplay text into JSON and provides an isolated Remotion starter for MP4 rendering.

## Parser test

From this directory:

```bash
python3 scripts/parse_anime_script.py examples/sample-script.txt --out /tmp/anime-storyboard.json --fps 12 --seconds-per-scene 5
python3 -m json.tool /tmp/anime-storyboard.json >/dev/null
python3 -m unittest scripts/test_parse_anime_script.py
```

## Render a short MP4

Requires Node.js/npm and a Chromium-compatible environment supported by Remotion. Run in a disposable directory so Hermes and Sophie dependencies are untouched:

```bash
cp -a remotion-template /tmp/hermes-anime-render-test
cd /tmp/hermes-anime-render-test
npm install
python3 /path/to/anime-video-studio/scripts/parse_anime_script.py /path/to/anime-video-studio/examples/sample-script.txt --out storyboard.json --fps 12 --seconds-per-scene 5
python3 -c 'import json; d=json.load(open("storyboard.json")); json.dump({"storyboard":d},open("props.json","w"))'
npx remotion render src/index.jsx AnimeVideo out/anime-preview.mp4 --props-file=props.json
test -s out/anime-preview.mp4
```

Replace `/path/to/anime-video-studio` with the actual path to this skill directory. The initial renderer produces storyboard-style motion graphics; it does not generate anime artwork by itself. For illustrated scenes, use an available Hermes image/video provider or user-supplied assets and populate each scene's `image` or `background` field. Preserve the source script and use a project-specific output directory.
