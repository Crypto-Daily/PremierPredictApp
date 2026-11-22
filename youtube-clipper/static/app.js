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
      $("results").innerHTML = (job.clips || []).map((clip) => {
        const link = "/clips/"+encodeURIComponent(clip.file);
        return '<article class="clip"><div><strong>'+escapeHtml(clip.name)+'</strong><p>'+clip.start+'s – '+clip.end+'s</p><p>'+escapeHtml(clip.transcript || "Transcript unavailable")+'</p></div><a href="'+link+'">Download MP4</a></article>';
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
