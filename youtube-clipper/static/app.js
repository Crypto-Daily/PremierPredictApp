const $ = (id) => document.getElementById(id);
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
let pollTimer = null;
let activeUploadId = null;
let activeJobId = null;
const UPLOAD_RESUME_KEY = "clipper_upload_resume_v1";
try { activeUploadId = JSON.parse(localStorage.getItem(UPLOAD_RESUME_KEY) || "null")?.id || null; } catch {}

async function jsonResponse(response) {
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    const text = await response.text();
    throw new Error("The server returned an unexpected response (" + response.status + "). " + text.slice(0,140));
  }
  return response.json();
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

$("clip-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("source-video").files[0];
  if (!file) { $("status").textContent = "Choose a video first."; return; }
  $("start").disabled = true;
  $("job").classList.remove("hidden");
  $("bar").style.width = "1%";
  $("status").textContent = "Preparing secure upload…";
  try {
    let init, received = new Set();
    const requestedCount = Number($("count").value);
    const chunkSize = 2 * 1024 * 1024;

    // Resume the same file after a temporary connection loss or page refresh.
    let savedResume = null;
    try { savedResume = JSON.parse(localStorage.getItem(UPLOAD_RESUME_KEY) || "null"); } catch {}
    if (activeUploadId && savedResume && savedResume.id === activeUploadId &&
        savedResume.size === file.size && savedResume.name === file.name &&
        savedResume.count === requestedCount) {
      try {
        const statusResponse = await fetch("/api/upload/"+activeUploadId+"/status",{cache:"no-store"});
        if (statusResponse.ok) {
          const saved = await jsonResponse(statusResponse);
          if (saved.size === file.size && saved.count === requestedCount) {
            init = {upload_id:activeUploadId,chunk_size:saved.chunk_size,chunks:saved.chunks};
            received = new Set(saved.received || []);
          }
        }
      } catch {}
    }

    if (!init) {
      if (activeUploadId) {
        try { await fetch("/api/upload/"+activeUploadId+"/abort",{method:"POST",headers:{"X-CSRF-Token":csrfToken}}); } catch {}
        activeUploadId = null;
      }
      const total = Math.ceil(file.size / chunkSize);
      const initResponse = await fetch("/api/upload/init", {
        method:"POST", headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken},
        body:JSON.stringify({filename:file.name,size:file.size,chunks:total,count:requestedCount})
      });
      const initData = await jsonResponse(initResponse);
      if (!initResponse.ok) throw new Error(initData.error || "Could not start upload.");
      init = initData;
      activeUploadId = init.upload_id;
      try { localStorage.setItem(UPLOAD_RESUME_KEY, JSON.stringify({id:activeUploadId,size:file.size,name:file.name,count:requestedCount})); } catch {}
    }

    const actualChunkSize = Number(init.chunk_size) || chunkSize;
    const total = Number(init.chunks) || Math.ceil(file.size / actualChunkSize);
    if (total !== Math.ceil(file.size / actualChunkSize)) throw new Error("This paused upload does not match the selected file. Keep the original file selected to resume.");

    const completed = new Set(received);
    let nextIndex = 0;
    let firstError = null;
    const workerCount = Math.min(4, Math.max(1, total - completed.size));
    $("status").textContent = "Uploading video…";
    $("bar").style.width = Math.round((completed.size / total) * 20) + "%";

    async function uploadWorker() {
      while (!firstError) {
        const i = nextIndex++;
        if (i >= total) return;
        if (completed.has(i)) continue;
        const part = file.slice(i * actualChunkSize, Math.min(file.size, (i + 1) * actualChunkSize));
        let success = false, lastError = "Upload request failed.", attempt = 0;
        // Retry transient failures indefinitely while this upload page remains active.
        // Backoff grows to 30 seconds, then stays there instead of giving up.
        while (!success && !firstError) {
          attempt++;
          try {
            const response = await fetch("/api/upload/"+init.upload_id+"/chunk/"+i, {
              method:"PUT",
              headers:{"X-CSRF-Token":csrfToken,"Content-Type":"application/octet-stream"},
              body:part,
              signal:AbortSignal.timeout(600000)
            });
            if (response.ok) {
              await jsonResponse(response);
              success = true;
            } else {
              const data = await jsonResponse(response);
              lastError = data.error || ("HTTP " + response.status);
              // Bad request/auth/permission/not-found errors cannot be repaired by retrying.
              if (response.status >= 400 && response.status < 500 &&
                  ![408, 425, 429].includes(response.status)) {
                throw new Error(lastError);
              }
              throw new Error(lastError);
            }
          } catch (error) {
            if (error.message && /HTTP 4(00|01|03|04|09|10|11|12|13|14|15|16|17|18|19|22|23|24|25|26|27|28|29|30|31|32|33|34|35|36|37|38|39|40|41|42|43|44|45|46|47|48|49|50|51|52|53|54|55|56|57|58|59|60|61|62|63|64|65|66|67|68|69|70|71|72|73|74|75|76|77|78|79|80|81|82|83|84|85|86|87|88|89|90|91|92|93|94|95|96|97|98|99)/.test(error.message) &&
                !/HTTP (408|425|429)/.test(error.message)) {
              firstError = "Upload cannot continue: " + lastError;
              return;
            }
            lastError = error.name === "TimeoutError" ? "Request timed out." : error.message || lastError;
            const wait = Math.min(30000, 1000 * (2 ** Math.min(attempt - 1, 5)));
            $("status").textContent = "Upload connection interrupted — retrying chunk " + (i + 1) + " (attempt " + attempt + ")…";
            await sleep(wait);
          }
        }
        if (!success) return;
        completed.add(i);
        $("bar").style.width = Math.round((completed.size / total) * 20) + "%";
        $("status").textContent = "Uploading video… " + Math.round((completed.size / total) * 100) + "%";
      }
    }

    await Promise.all(Array.from({length:workerCount},()=>uploadWorker()));
    if (firstError) throw new Error(firstError);
    const done=await fetch("/api/upload/"+init.upload_id+"/complete",{
      method:"POST",headers:{"X-CSRF-Token":csrfToken}
    });
    const result=await jsonResponse(done);
    if(!done.ok) throw new Error(result.error||"Upload could not be completed.");
    activeUploadId=null;
    try { localStorage.removeItem(UPLOAD_RESUME_KEY); } catch {}
    activeJobId=result.id;
    poll(result.id);
  }catch(error){
    // Do not abort: keep successfully received chunks so the user can resume.
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
  heading.innerHTML='<div><strong>'+clips.length+' ranked Reels ready</strong><p class="muted">'+escapeHtml(job.message)+'</p></div>';
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
    const quality=clip.quality;
    if(quality){
      const score=document.createElement("div");
      score.className="quality-score";
      const scoreTitle=document.createElement("strong");
      scoreTitle.textContent="Quality score: "+quality.total+"/100";
      score.append(scoreTitle);
      const metrics=[
        ["Opening",quality.opening],["Dialogue",quality.dialogue],
        ["Gameplay",quality.gameplay],["Context",quality.context],["Ending",quality.ending]
      ];
      const metricList=document.createElement("div");
      metricList.className="quality-metrics";
      metrics.forEach(([label,value])=>{
        const item=document.createElement("span");
        item.textContent=label+" "+value;
        metricList.append(item);
      });
      score.append(metricList);
      const method=document.createElement("p");
      method.className="muted quality-note";
      method.textContent="Gameplay score uses sampled scene changes and audio intensity as proxies.";
      score.append(method);
      card.append(score);
    }
    const badges=document.createElement("div");
    badges.className="clip-badges";
    const reels=document.createElement("span");
    reels.textContent="9:16 Reels";
    const captions=document.createElement("span");
    captions.textContent="Styled captions";
    badges.append(reels,captions);
    const download=document.createElement("a");
    download.className="download-link";
    download.href="/api/jobs/"+encodeURIComponent(job.id)+"/clips/"+index+"?download=1";
    download.download="clip_"+String(index+1).padStart(2,"0")+".mp4";
    download.textContent="Download clip";
    card.append(video,badges,info,download);
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
  $("status").textContent="Your ranked Reels are ready. Preview and download them before deleting this job.";
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

async function restoreReadyJobs(){
  try{
    const response=await fetch("/api/jobs");
    const data=await jsonResponse(response);
    if(!response.ok)throw new Error(data.error||"Could not load saved jobs.");
    (data.jobs||[]).filter(job=>job.status==="ready").sort((a,b)=>b.created-a.created).forEach(job=>renderJob(job));
    const ready=(data.jobs||[]).filter(job=>job.status==="ready").length;
    if(ready)$("job-count").textContent=ready+" saved job"+(ready===1?"":"s");
  }catch(error){console.warn("Could not restore saved clip jobs:",error.message);}
}
restoreReadyJobs();

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}
