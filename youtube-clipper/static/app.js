const $ = (id) => document.getElementById(id);
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
let pollTimer = null;
let activeUploadId = null;

$("clip-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("source-video").files[0];
  if (!file) { $("status").textContent = "Choose a video first."; return; }
  $("start").disabled = true;
  $("job").classList.remove("hidden");
  $("results").innerHTML = "";
  $("bar").style.width = "1%";
  $("status").textContent = "Preparing secure upload…";
  const chunkSize = 8 * 1024 * 1024;
  const total = Math.ceil(file.size / chunkSize);
  try {
    const initResponse = await fetch("/api/upload/init", {
      method: "POST",
      headers: {"Content-Type":"application/json","X-CSRF-Token":csrfToken},
      body: JSON.stringify({filename:file.name,size:file.size,chunks:total,count:$("count").value})
    });
    const init = await initResponse.json();
    if (!initResponse.ok) throw new Error(init.error || "Could not start upload.");
    activeUploadId = init.upload_id;
    for (let i=0;i<total;i++) {
      const part=file.slice(i*chunkSize,Math.min(file.size,(i+1)*chunkSize));
      let success=false, lastError="Chunk upload failed.";
      for(let attempt=0;attempt<3 && !success;attempt++){
        try{
          const response=await fetch("/api/upload/"+init.upload_id+"/chunk/"+i,{
            method:"PUT",headers:{"X-CSRF-Token":csrfToken,"Content-Type":"application/octet-stream"},body:part
          });
          const data=await response.json();
          if(!response.ok) throw new Error(data.error || lastError);
          success=true;
        }catch(error){lastError=error.message;}
      }
      if(!success) throw new Error("Upload stopped at part "+(i+1)+"/"+total+": "+lastError);
      $("bar").style.width=Math.round(((i+1)/total)*15)+"%";
      $("status").textContent="Uploading video: "+(i+1)+" of "+total+" parts…";
    }
    const done=await fetch("/api/upload/"+init.upload_id+"/complete",{
      method:"POST",headers:{"X-CSRF-Token":csrfToken}
    });
    const result=await done.json();
    if(!done.ok) throw new Error(result.error || "Upload could not be completed.");
    activeUploadId=null;
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
    const job=await response.json();
    if(!response.ok) throw new Error(job.error || "Could not check processing status.");
    $("status").textContent=job.message || job.status;
    $("bar").style.width=(job.progress || 0)+"%";
    if(job.status==="delivered"){
      $("bar").style.width="100%";
      $("start").disabled=false;
      $("results").innerHTML='<p class="success">✓ '+escapeHtml(job.message)+'</p><p class="muted">You can upload another video. No video files remain in this job on the server.</p>';
      $("source-video").value="";
      return;
    }
    if(job.status==="delivery_failed"){
      $("start").disabled=false;
      $("results").innerHTML='<p class="error">'+escapeHtml(job.message)+'</p><button id="retry-delivery" type="button">Retry WhatsApp delivery</button><p id="retry-status" class="muted" aria-live="polite"></p>';
      $("retry-delivery").addEventListener("click",async()=>{
        const button=$("retry-delivery");button.disabled=true;
        $("retry-status").textContent="Retrying unsent clips…";
        try{
          const retry=await fetch("/api/jobs/"+encodeURIComponent(id)+"/retry",{method:"POST",headers:{"X-CSRF-Token":csrfToken}});
          const data=await retry.json();
          if(!retry.ok) throw new Error(data.error || "Retry failed.");
          poll(id);
        }catch(error){$("retry-status").textContent=error.message;button.disabled=false;}
      });
      return;
    }
    if(job.status==="failed"){
      $("start").disabled=false;
      $("results").innerHTML='<p class="error">'+escapeHtml(job.message)+'</p><p class="muted">The source file has been kept on the server. Fix the issue and upload again.</p>';
      return;
    }
    pollTimer=setTimeout(()=>poll(id),2500);
  }catch(error){
    $("status").textContent=error.message;
    $("start").disabled=false;
  }
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}


async function refreshWhatsAppStatus(){
  const status=$("wa-status"), qr=$("wa-qr");
  try{
    const response=await fetch("/api/whatsapp/status");
    const data=await response.json();
    if(data.connected){
      status.textContent="✓ WhatsApp is connected"+(data.user ? " as "+(data.user.name || data.user.id || "your linked account") : "")+".";
      qr.classList.add("hidden");
    }else if(data.qr_data_url){
      status.textContent="Scan this QR code with the WhatsApp account dedicated to the Clipper.";
      qr.src=data.qr_data_url;qr.classList.remove("hidden");
    }else{
      status.textContent=data.error || (data.recipient_configured ? "Waiting for WhatsApp QR code…" : "Set WHATSAPP_PHONE_NUMBER on the server, then restart the existing Clipper process.");
      qr.classList.add("hidden");
    }
  }catch(error){status.textContent="WhatsApp session is starting. This page will check again shortly.";}
  setTimeout(refreshWhatsAppStatus,5000);
}
refreshWhatsAppStatus();
