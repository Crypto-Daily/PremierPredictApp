const $ = (id) => document.getElementById(id);
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
let pollTimer = null;
let activeUploadId = null;
let activeJobId = null;

async function jsonResponse(response) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    const text = await response.text();
    throw new Error("The server returned an unexpected response (" + response.status + "). " + text.slice(0,140));
  }
  return response.json();
}

$("clip-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("source-video").files[0];
  if (!file) { $("status").textContent = "Choose a video first."; return; }
  $("start").disabled = true;
  $("job").classList.remove("hidden");
  $("bar").style.width = "1%";
  $("status").textContent = "Preparing secure upload…";
  const chunkSize = 8 * 1024 * 1024;
  const total = Math.ceil(file.size / chunkSize);
  try {
    const initResponse = await fetch("/api/upload/init", {
      method:"POST", headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},
      body:JSON.stringify({filename:file.name,size:file.size,chunks:total,count:$("count").value})
    });
    const init = await jsonResponse(initResponse);
    if (!initResponse.ok) throw new Error(init.error || "Could not start upload.");
    activeUploadId = init.upload_id;
    for (let i=0;i<total;i++) {
      const part=file.slice(i*chunkSize,Math.min(file.size,(i+1)*chunkSize));
      let success=false, lastError="Chunk upload failed.";
      for(let attempt=0;attempt<3&&!success;attempt++){
        try{
          const response=await fetch("/api/upload/"+init.upload_id+"/chunk/"+i,{
            method:"PUT",headers:{"X-CSRF-Token":csrfToken,"Content-Type":"application/octet-stream"},body:part
          });
          const data=await jsonResponse(response);
          if(!response.ok) throw new Error(data.error||lastError);
          success=true;
        }catch(error){lastError=error.message;}
      }
      if(!success) throw new Error("Upload stopped at part "+(i+1)+"/"+total+": "+lastError);
      $("bar").style.width=Math.round(((i+1)/total)*20)+"%";
      $("status").textContent="Uploading video: "+(i+1)+" of "+total+" parts…";
    }
    const done=await fetch("/api/upload/"+init.upload_id+"/complete",{
      method:"POST",headers:{"X-CSRF-Token":csrfToken}
    });
    const result=await jsonResponse(done);
    if(!done.ok) throw new Error(result.error||"Upload could not be completed.");
    activeUploadId=null;
    activeJobId=result.id;
    poll(result.id);
  }catch(error){
    if(activeUploadId){
      try{await fetch("/api/upload/"+activeUploadId+"/abort",{method:"POST",headers:{"X-CSRF-Token":csrfToken}});}catch{}
      activeUploadId=null;
    }
    $("status").textContent=error.message;
    $("start").disabled=false;
  }
});

async function poll(id){
  clearTimeout(pollTimer);
  try{
    const response=await fetch("/api/jobs/"+encodeURIComponent(id));
    const job=await jsonResponse(response);
    if(!response.ok) throw new Error(job.error||"Could not check processing status.");
    $("status").textContent=job.message||job.status;
    $("bar").style.width=(job.progress||0)+"%";
    if(job.status==="ready"){
      $("bar").style.width="100%";
      $("start").disabled=false;
      renderJob(job);
      $("source-video").value="";
      return;
    }
    if(job.status==="deleted"||job.status==="failed"){
      $("start").disabled=false;
      if(job.status==="failed") $("results").innerHTML='<p class="error">'+escapeHtml(job.message)+'</p><p class="muted">The uploaded source and any completed clips have been retained. You can try another upload.</p>';
      return;
    }
    pollTimer=setTimeout(()=>poll(id),2500);
  }catch(error){
    $("status").textContent=error.message;
    $("start").disabled=false;
  }
}

function renderJob(job){
  const clips=job.clips||[];
  $("job-count").textContent=clips.length+" clips";
  const section=document.createElement("section");
  section.className="job-result";
  const heading=document.createElement("div");
  heading.className="job-result-head";
  heading.innerHTML='<div><strong>'+clips.length+' highlights ready</strong><p class="muted">'+escapeHtml(job.message)+'</p></div>';
  const grid=document.createElement("div");
  grid.className="clip-grid";
  clips.forEach((clip,index)=>{
    const card=document.createElement("article");
    card.className="clip-card";
    const video=document.createElement("video");
    video.controls=true; video.preload="metadata"; video.playsInline=true;
    video.src="/api/jobs/"+encodeURIComponent(job.id)+"/clips/"+index;
    const info=document.createElement("div");
    info.className="clip-meta";
    const title=document.createElement("strong");
    title.textContent=clip.name||("Highlight "+(index+1));
    const timing=document.createElement("p");
    timing.className="muted"; timing.textContent=Number(clip.start).toFixed(1)+"s – "+Number(clip.end).toFixed(1)+"s";
    info.append(title,timing);
    const download=document.createElement("a");
    download.className="download-link";
    download.href="/api/jobs/"+encodeURIComponent(job.id)+"/clips/"+index+"?download=1";
    download.download="clip_"+String(index+1).padStart(2,"0")+".mp4";
    download.textContent="Download clip";
    card.append(video,info,download);
    grid.append(card);
  });
  const actions=document.createElement("div");
  actions.className="job-actions";
  const downloadAll=document.createElement("button");
  downloadAll.className="secondary";
  downloadAll.type="button"; downloadAll.textContent="Download all clips";
  downloadAll.addEventListener("click",()=>clips.forEach((clip,index)=>{
    const a=document.createElement("a");
    a.href="/api/jobs/"+encodeURIComponent(job.id)+"/clips/"+index+"?download=1";
    a.download="clip_"+String(index+1).padStart(2,"0")+".mp4";
    document.body.appendChild(a);a.click();a.remove();
  }));
  const done=document.createElement("button");
  done.className="danger";done.type="button";done.textContent="DONE & DELETE";
  done.addEventListener("click",()=>deleteJob(job.id,done));
  actions.append(downloadAll,done);
  section.append(heading,grid,actions);
  $("results").prepend(section);
  $("status").textContent="Your clips are ready. Preview and download them before deleting this job.";
}

async function deleteJob(id,button){
  if(!confirm("Delete this job's original video, all generated clips and temporary files? This cannot be undone."))return;
  button.disabled=true;button.textContent="Deleting…";
  try{
    const response=await fetch("/api/jobs/"+encodeURIComponent(id)+"/delete",{
      method:"POST",headers:{"X-CSRF-Token":csrfToken}
    });
    const result=await jsonResponse(response);
    if(!response.ok)throw new Error(result.error||"Could not delete this job.");
    const card=button.closest(".job-result");
    card.innerHTML='<p class="success">✓ '+escapeHtml(result.message)+'</p>';
    $("status").textContent="Job files deleted. You can upload another video.";
  }catch(error){button.disabled=false;button.textContent="DONE & DELETE";alert(error.message);}
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
