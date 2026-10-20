import React from "react";
import {Composition, registerRoot} from "remotion";
import {AnimeVideo} from "./AnimeVideo.jsx";

const demo = {
  fps: 12, width: 1280, height: 720,
  scenes: [{
    id: "scene-1", title: "Render test", durationSeconds: 5,
    environment: "A quiet cinematic night sky",
    actions: ["A light slowly fades into view"],
    dialogue: [], narration: ["Hermes + Remotion starter render"],
    image: null, background: null
  }]
};

const Root = () => (
  <Composition
    id="AnimeVideo"
    component={AnimeVideo}
    durationInFrames={demo.scenes.reduce((n, s) => n + s.durationSeconds * demo.fps, 0)}
    fps={demo.fps}
    width={demo.width}
    height={demo.height}
    defaultProps={{storyboard: demo}}
  />
);
registerRoot(Root);
