#!/usr/bin/env python3
"""Standalone procedural 2D cartoon renderer. No network or model required."""

from __future__ import annotations

import argparse
import math
import os
import re
from pathlib import Path
from typing import Tuple

from PIL import Image, ImageDraw


Color = Tuple[int, int, int]


def parse_color(value: str) -> Color:
    """Parse a Pillow-supported colour string into RGB."""
    try:
        image = Image.new("RGB", (1, 1), value)
        return image.getpixel((0, 0))
    except (ValueError, TypeError) as exc:
        raise argparse.ArgumentTypeError(f"Invalid colour: {value}") from exc


def prompt_settings(prompt: str):
    text = prompt.lower()
    if any(word in text for word in ("black", "midnight", "dark cat")):
        fur, stripe = "#30313B", "#171923"
    elif any(word in text for word in ("white", "snow", "cream cat")):
        fur, stripe = "#F4EDE2", "#D6C9B7"
    elif any(word in text for word in ("gray", "grey", "silver")):
        fur, stripe = "#A9ADB8", "#727786"
    elif any(word in text for word in ("brown", "chocolate")):
        fur, stripe = "#A9653B", "#704027"
    else:
        fur, stripe = "#F29A43", "#B95F2D"
    animated = any(word in text for word in ("run", "running", "walk", "walking", "jump", "jumping", "dance", "dancing", "animate", "animation", "gif"))
    sleeping = "sleep" in text
    eye = "#7CB94A" if any(word in text for word in ("green eye", "green-eyed", "green eyes")) or not sleeping else "#5E8FBD"
    return {"fur": fur, "stripe": stripe, "animated": animated, "sleeping": sleeping, "eye": eye}


def _draw_star(draw: ImageDraw.ImageDraw, cx: float, cy: float, radius: float, fill: str):
    points = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        r = radius if i % 2 == 0 else radius * 0.42
        points.append((cx + math.cos(angle) * r, cy + math.sin(angle) * r))
    draw.polygon(points, fill=fill)


def draw_frame(size: int, prompt: str, frame: int = 0, frames: int = 1,
               background: str = "#FFF7E8", supersample: int = 2) -> Image.Image:
    """Render one RGB frame at target size using supersampled drawing."""
    cfg = prompt_settings(prompt)
    scale = max(1, min(4, supersample))
    n = size * scale
    im = Image.new("RGB", (n, n), background)
    d = ImageDraw.Draw(im)
    s = scale
    def xy(x, y):
        return (int(x * s), int(y * s))
    def box(x1, y1, x2, y2):
        return (int(x1*s), int(y1*s), int(x2*s), int(y2*s))
    def ellipse(bounds, fill, outline="#573C35", width=3):
        d.ellipse(box(*bounds), fill=fill, outline=outline, width=max(1, int(width*s)))
    def line(points, fill="#573C35", width=3, joint="curve"):
        d.line([xy(x,y) for x,y in points], fill=fill, width=max(1,int(width*s)), joint=joint)

    # Responsive layout in a 512-unit coordinate space.
    k = size / 512
    # Draw in 512-space then downsample to requested output dimensions.
    # The supersampling scale is folded into the coordinate helpers.
    # Use normalized coordinates via an additional drawing transform.
    # Recreate helpers in logical coordinates independent of requested size.
    def p(x, y): return (int(x * size / 512 * s), int(y * size / 512 * s))
    def b(x1,y1,x2,y2): return tuple(int(v * size / 512 * s) for v in (x1,y1,x2,y2))
    def e(bounds, fill, outline="#573C35", width=4):
        d.ellipse(b(*bounds), fill=fill, outline=outline, width=max(1,int(width*size/512*s)))
    def l(points, fill="#573C35", width=4):
        d.line([p(x,y) for x,y in points], fill=fill, width=max(1,int(width*size/512*s)), joint="curve")

    # Soft ground shadow.
    d.ellipse(b(104, 405, 410, 449), fill="#E8DCC9")
    fur, stripe, ink = cfg["fur"], cfg["stripe"], "#573C35"
    phase = (frame / max(1, frames)) * math.tau
    moving = cfg["animated"] and frames > 1
    bob = math.sin(phase * 2) * 5 if moving else 0
    leg_swing = math.sin(phase * 2) * 18 if moving else 0
    tail_wave = math.sin(phase * 2) * 18 if moving else 0
    cy = bob

    # Tail behind body: thick, rounded stroke with a contrasting tip.
    tail_points = [(349, 333+cy), (393, 325+cy+tail_wave*.2), (420, 286+cy+tail_wave), (395, 259+cy+tail_wave*.8)]
    l(tail_points, ink, 24)
    l(tail_points, fur, 17)
    l([(404, 270+cy+tail_wave*.8),(397, 260+cy+tail_wave*.8)], stripe, 8)

    # Back legs; swing independently for a readable run cycle.
    if moving:
        legs = [
            [(226, 360+cy), (210+leg_swing, 389+cy), (190+leg_swing, 405+cy)],
            [(296, 359+cy), (307-leg_swing, 389+cy), (328-leg_swing, 405+cy)],
        ]
    else:
        legs = [
            [(226, 360+cy), (222, 392+cy), (204, 405+cy)],
            [(297, 360+cy), (305, 391+cy), (322, 405+cy)],
        ]
    for pts in legs:
        l(pts, ink, 24); l(pts, fur, 17)
        x, y = pts[-1]
        e((x-14,y-7,x+12,y+7), fur, ink, 3)

    # Body with layered warm highlight.
    e((143, 245+cy, 366, 382+cy), fur, ink, 5)
    e((172, 286+cy, 328, 367+cy), "#F8B96F" if fur == "#F29A43" else fur, None, 0)
    # Tabby markings on forehead and body.
    if fur not in ("#F4EDE2", "#30313B"):
        l([(190,273+cy),(201,294+cy)], stripe, 7)
        l([(220,266+cy),(229,287+cy)], stripe, 7)
        l([(250,266+cy),(256,287+cy)], stripe, 7)
        l([(300,301+cy),(321,312+cy)], stripe, 8)
        l([(295,324+cy),(318,335+cy)], stripe, 8)

    # Front legs with animation.
    front_legs = [
        [(270, 349+cy), (258+leg_swing*.7, 380+cy), (241+leg_swing*.7, 401+cy)],
        [(320, 347+cy), (334-leg_swing*.7, 376+cy), (352-leg_swing*.7, 397+cy)],
    ]
    for pts in front_legs:
        l(pts, ink, 22); l(pts, fur, 15)
        x, y = pts[-1]
        e((x-13,y-7,x+13,y+7), fur, ink, 3)

    # Head and ears.
    head_y = 206 + cy
    d.polygon([p(151,head_y-35), p(155,head_y-104), p(209,head_y-63)], fill=fur)
    d.polygon([p(298,head_y-63), p(352,head_y-105), p(352,head_y-28)], fill=fur)
    l([(151,head_y-35),(155,head_y-104),(209,head_y-63)], ink, 5)
    l([(298,head_y-63),(352,head_y-105),(352,head_y-28)], ink, 5)
    d.polygon([p(166,head_y-48),p(163,head_y-86),p(193,head_y-63)], fill="#E88B91")
    d.polygon([p(312,head_y-62),p(341,head_y-88),p(337,head_y-43)], fill="#E88B91")
    e((143,head_y-83,359,head_y+124), fur, ink, 6)

    # Cheeks and muzzle.
    e((166,head_y+48,245,head_y+100), "#F9C7A1" if fur != "#F4EDE2" else "#FFFFFF", None, 0)
    e((255,head_y+48,334,head_y+100), "#F9C7A1" if fur != "#F4EDE2" else "#FFFFFF", None, 0)
    if cfg["sleeping"]:
        l([(190,head_y+25),(208,head_y+31),(225,head_y+25)], ink, 4)
        l([(276,head_y+25),(294,head_y+31),(312,head_y+25)], ink, 4)
    else:
        # Eyes with iris, pupil and glints.
        for cx in (207, 294):
            e((cx-29,head_y-9,cx+29,head_y+49), "#FFFFFF", ink, 3)
            e((cx-18,head_y+1,cx+18,head_y+42), cfg["eye"], None, 0)
            e((cx-8,head_y+2,cx+10,head_y+43), "#20242B", None, 0)
            e((cx-8,head_y+7,cx-1,head_y+16), "#FFFFFF", None, 0)
            e((cx+4,head_y+27,cx+9,head_y+33), "#FFFFFF", None, 0)
    # Nose and smile.
    d.polygon([p(245,head_y+62),p(256,head_y+54),p(267,head_y+62),p(256,head_y+71)], fill="#E98291")
    l([(256,head_y+70),(256,head_y+80),(244,head_y+86)], ink, 3)
    l([(256,head_y+80),(268,head_y+86)], ink, 3)
    # Whiskers and freckles.
    for side in (-1,1):
        base = 205 if side < 0 else 307
        l([(base,head_y+65),(base-40*side,head_y+57)], ink, 2)
        l([(base,head_y+75),(base-45*side,head_y+76)], ink, 2)
        l([(base,head_y+84),(base-38*side,head_y+95)], ink, 2)
    for x in (226, 235, 277, 286):
        e((x-2,head_y+64,x+2,head_y+68), stripe, None, 0)

    # Decorative sparkles and small hearts.
    _draw_star(d, *p(94,151), 7*size/512*s, "#E9B95D")
    _draw_star(d, *p(414,184), 6*size/512*s, "#E9B95D")
    e((402,116,410,124), "#E9A2A8", None, 0)
    e((410,116,418,124), "#E9A2A8", None, 0)
    d.polygon([p(402,121),p(418,121),p(410,132)], fill="#E9A2A8")

    # Downsample for clean antialiased edges.
    return im.resize((size, size), Image.Resampling.LANCZOS)


def generate(prompt: str, output: str, size: int = 512, frames: int = 24,
             fps: int = 12, background: str = "#FFF7E8") -> Path:
    if size < 128 or size > 2048:
        raise ValueError("size must be between 128 and 2048")
    if frames < 2 or frames > 120:
        raise ValueError("frames must be between 2 and 120")
    if fps < 1 or fps > 60:
        raise ValueError("fps must be between 1 and 60")
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    is_gif = path.suffix.lower() == ".gif"
    animated = is_gif
    if animated:
        images = [draw_frame(size, prompt, i, frames, background) for i in range(frames)]
        # Quantize to a shared adaptive palette per frame; Pillow writes a looping GIF.
        palette_frames = [frame.convert("P", palette=Image.Palette.ADAPTIVE, colors=128) for frame in images]
        palette_frames[0].save(
            path, save_all=True, append_images=palette_frames[1:], duration=max(1, round(1000/fps)),
            loop=0, optimize=False, disposal=2
        )
    else:
        draw_frame(size, prompt, 0, 1, background).save(path, format="PNG")
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate a procedural cartoon PNG or looping GIF.")
    parser.add_argument("prompt", help="Describe the cartoon, e.g. 'running orange cat with green eyes'")
    parser.add_argument("--output", default="output/cat.png", help="Output path ending in .png or .gif")
    parser.add_argument("--size", type=int, default=512, help="Square output dimensions (128-2048)")
    parser.add_argument("--frames", type=int, default=24, help="GIF frame count (2-120)")
    parser.add_argument("--fps", type=int, default=12, help="GIF playback rate (1-60)")
    parser.add_argument("--background", default="#FFF7E8", help="Pillow colour name or hex background")
    args = parser.parse_args(argv)
    try:
        parse_color(args.background)
        path = generate(args.prompt, args.output, args.size, args.frames, args.fps, args.background)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Created: {path.resolve()}")
    print(f"Prompt: {args.prompt}")
    print(f"Format: {'animated GIF' if path.suffix.lower() == '.gif' else 'PNG still image'}")


if __name__ == "__main__":
    main()
