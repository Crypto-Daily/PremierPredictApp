const $ = (id) => document.getElementById(id);
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
const headers = {"Content-Type":"application/json","X-CSRF-Token":csrfToken};
let pollTimer = null;
$("clip-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("start").disabled = true;
  $("job").classList.remove("hidden");
  $("status").textContent = "Submitting job…";
  $("bar").style.width = "2%";
  $("results").innerHTML = "";
  try {
    const sourceFile = $("source-video").files[0];
    let response;
    if (sourceFile) {
      const form = new FormData();
      form.append("video", sourceFile);
      form.append("count", $("count").value);
      form.append("clip_seconds", $("length").value);
      form.append("aspect", $("aspect").value);
      $("status").textContent = "Uploading your video…";
      response = await fetch("/api/upload", {method:"POST",headers:{"X-CSRF-Token":csrfToken},body:form});
    } else if ($("url").value.trim()) {
      response = await fetch("/api/jobs", {method:"POST",headers,body:JSON.stringify({
        url:$("url").value, count:$("count").value, clip_seconds:$("length").value, aspect:$("aspect").value
      })});
    } else {
      throw new Error("Paste a YouTube URL or choose a video file.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not start job.");
    poll(data.id);
  } catch (error) {
    $("status").textContent = error.message;
    $("start").disabled = false;
  }
});
async function poll(id) {
  clearTimeout(pollTimer);
  try {
    const response = await fetch("/api/jobs/"+id);
    const job = await response.json();
    $("status").textContent = job.message || job.status;
    $("bar").style.width = (job.progress || 0)+"%";
    if (job.status === "completed") {
      $("start").disabled = false;
      $("results").innerHTML = (job.clips || []).map((clip, index) => {
        const link = "/clips/"+encodeURIComponent(clip.file);
        return '<article class="clip clip-publish"><div class="clip-info"><strong>'+escapeHtml(clip.name)+'</strong><p>'+clip.start+'s – '+clip.end+'s</p><p>'+escapeHtml(clip.transcript || "Transcript unavailable")+'</p><a href="'+link+'">Download MP4</a></div><div class="publish-fields"><label>YouTube title<input class="pub-title" maxlength="100" value="'+escapeHtml(clip.name.replace(/\\.mp4$/i,""))+'"></label><label>Description<textarea class="pub-description" rows="2" maxlength="5000"></textarea></label><label>Publish date and time<input class="pub-time" type="datetime-local"></label><button class="schedule-button" type="button" data-file="'+escapeHtml(clip.file)+'">Upload and schedule</button><p class="pub-status muted" aria-live="polite"></p></div></article>';
      }).join("");
      return;
    }
    if (job.status === "failed") {
      $("start").disabled = false;
      $("results").innerHTML = '<p class="error">'+escapeHtml(job.message)+'</p>';
      return;
    }
    pollTimer = setTimeout(() => poll(id), 2500);
  } catch {
    $("status").textContent = "Connection interrupted. Refresh and check the job again.";
    $("start").disabled = false;
  }
}
$("cookie-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("cookies").files[0];
  if (!file) return;
  const form = new FormData(); form.append("cookies", file);
  $("cookie-status").textContent = "Uploading securely…";
  try {
    const response = await fetch("/api/cookies", {method:"POST",headers:{"X-CSRF-Token":csrfToken},body:form});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Upload failed.");
    $("cookie-status").textContent = data.message;
    $("cookies").value = "";
  } catch (error) { $("cookie-status").textContent = error.message; }
});
async function pollPublish(id, status, button) {
  try {
    const response = await fetch("/api/jobs/"+id);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Could not check upload status.");
    status.textContent = job.message || job.status;
    if (job.status === "published") {
      const url = job.youtube?.url || "#";
      status.innerHTML = 'Scheduled successfully: <a target="_blank" rel="noopener" href="'+url+'">View on YouTube</a>';
      button.textContent = "Scheduled";
      return;
    }
    if (job.status === "failed") {
      button.disabled = false;
      return;
    }
    setTimeout(() => pollPublish(id, status, button), 3000);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
}

$("results").addEventListener("click", async (event) => {
  const button = event.target.closest(".schedule-button");
  if (!button) return;
  const card = button.closest(".clip-publish");
  const title = card.querySelector(".pub-title").value.trim();
  const description = card.querySelector(".pub-description").value;
  const localTime = card.querySelector(".pub-time").value;
  const status = card.querySelector(".pub-status");
  if (!title || !localTime) {
    status.textContent = "Enter a title and future publication time.";
    return;
  }
  const publishAt = new Date(localTime);
  if (Number.isNaN(publishAt.getTime()) || publishAt <= new Date()) {
    status.textContent = "Choose a publication time in the future.";
    return;
  }
  button.disabled = true;
  status.textContent = "Uploading clip to YouTube and scheduling it…";
  try {
    const response = await fetch("/api/publish", {
      method:"POST", headers,
      body:JSON.stringify({file:button.dataset.file,title,description,publish_at:publishAt.toISOString()})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not schedule this clip.");
    await pollPublish(data.id, status, button);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
}


$("pair-browser").addEventListener("click", async () => {
  $("pair-browser").disabled = true;
  $("pair-code").textContent = "Generating a one-time code…";
  try {
    const response = await fetch("/api/browser/pairing", {
      method: "POST", headers
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not generate pairing code.");
    $("pair-code").textContent = "Pairing code (valid for 10 minutes): " + data.code;
  } catch (error) {
    $("pair-code").textContent = error.message;
  } finally {
    $("pair-browser").disabled = false;
  }
});
