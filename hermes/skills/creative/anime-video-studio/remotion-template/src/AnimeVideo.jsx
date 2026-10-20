import React from "react";
import {AbsoluteFill, Img, Sequence, interpolate, useCurrentFrame, useVideoConfig} from "remotion";

const SceneCard = ({scene, index}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const opacity = interpolate(frame, [0, Math.max(1, Math.round(fps * 0.5))], [0, 1], {extrapolateRight: "clamp"});
  const dialogue = (scene.dialogue || []).map((d) => d.character + ": " + d.text).join("\n");
  const action = (scene.actions || []).join(" ");
  const narration = (scene.narration || []).join(" ");
  return (
    <AbsoluteFill style={{backgroundColor:"#101827", color:"#f8fafc", opacity, fontFamily:"Arial, sans-serif"}}>
      {scene.background ? <AbsoluteFill><Img src={scene.background} style={{width, height, objectFit:"cover"}} /></AbsoluteFill> : null}
      <AbsoluteFill style={{background:"linear-gradient(135deg, rgba(8,15,30,.9), rgba(22,44,75,.55))"}} />
      {scene.image ? <Img src={scene.image} style={{position:"absolute", width:"48%", height:"75%", right:"5%", top:"8%", objectFit:"contain"}} /> : null}
      <div style={{position:"absolute", left:"7%", top:"8%", maxWidth:"76%"}}>
        <div style={{fontSize:20, color:"#93c5fd", letterSpacing:3}}>SCENE {index+1}</div>
        <div style={{fontSize:52, fontWeight:700, marginTop:14, lineHeight:1.12}}>{scene.title || "Scene " + (index+1)}</div>
        {scene.environment ? <div style={{fontSize:25, color:"#cbd5e1", marginTop:20, lineHeight:1.35}}>{scene.environment}</div> : null}
      </div>
      <div style={{position:"absolute", left:"7%", right:"7%", bottom:"9%", padding:"22px 28px", borderRadius:16, background:"rgba(3,7,18,.82)", border:"1px solid rgba(148,163,184,.3)"}}>
        {action ? <div style={{fontSize:25, marginBottom:10}}>{action}</div> : null}
        {dialogue ? <div style={{fontSize:23, whiteSpace:"pre-line", color:"#fef3c7"}}>{dialogue}</div> : null}
        {narration ? <div style={{fontSize:21, marginTop:8, color:"#cbd5e1"}}>{narration}</div> : null}
      </div>
      <div style={{position:"absolute", right:"3%", top:"3%", color:"#94a3b8", fontSize:16}}>HERMES • ANIME STUDIO</div>
    </AbsoluteFill>
  );
};

export const AnimeVideo = ({storyboard}) => {
  const data = storyboard || {fps:12, scenes:[{title:"Render test", durationSeconds:5}]};
  let from = 0;
  const fps = data.fps || 12;
  const sequences = (data.scenes || []).map((scene, index) => {
    const duration = Math.max(1, Math.round((Number(scene.durationSeconds) || 5) * fps));
    const element = <Sequence key={scene.id || index} from={from} durationInFrames={duration}><SceneCard scene={scene} index={index} /></Sequence>;
    from += duration;
    return element;
  });
  return <AbsoluteFill>{sequences}</AbsoluteFill>;
};
