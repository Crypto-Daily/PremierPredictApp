import React from "react";
import {Composition, registerRoot} from "remotion";
import {AnimeVideo} from "./AnimeVideo.jsx";

const demo = {
  fps: 12, width: 1280, height: 720,
  scenes: [{id:"scene-1", title:"Render test", durationSeconds:5, environment:"A quiet cinematic night sky", actions:["A light slowly fades into view"], dialogue:[], narration:["Hermes + Remotion starter render"], image:null, background:null}]
};
const metadata = ({props}) => {
  const data = props.storyboard || props;
  const fps = Number(data.fps) || 12;
  const scenes = data.scenes && data.scenes.length ? data.scenes : demo.scenes;
  return {fps, width:Number(data.width)||1280, height:Number(data.height)||720,
    durationInFrames:scenes.reduce((sum, scene)=>sum+Math.max(1,Number(scene.durationSeconds)||5)*fps,0)};
};
const Root = () => <Composition id="AnimeVideo" component={AnimeVideo} durationInFrames={60} fps={12} width={1280} height={720} defaultProps={demo} calculateMetadata={metadata} />;
registerRoot(Root);
