const $ = (id) => document.getElementById(id);
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
let pollTimer = null;

$("clip-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const sourceFile = $("source-video").files[0];
  if (!sourceFile) {
    $("status").textContent = "Choose a video file first.";
    return;
  }
  $("start").disabled = true;
  $("job").classList.remove("hidden");
  $("status").textContent = "Uploading your video…";
  $("bar").style.width = "2%";
  $("results").innerHTML = "";
  try {
    const chunkSize = 8 * 1024 * 1024;
    const totalChunks = Math.ceil(sourceFile.size / chunkSize);
    const initResponse = await fetch("/api/upload/init", {
      method: "POST",
      headers: {"Content-Type":"application/json","X-CSRF-Token":csrfToken},
      body: JSON.stringify({
        filename: sourceFile.name, size: sourceFile.size, chunks: totalChunks,
        count: $("count").value, clip_seconds: $("length").value, aspect: $("aspect").value
      })
    });
    const init = await initResponse.json();
    if (!initResponse.ok) throw new Error(init.error || "Could not start upload.");
    for (let index = 0; index < totalChunks; index++) {
      const chunk = sourceFile.slice(index * chunkSize, Math.min(sourceFile.size, (index + 1) * chunkSize));
      let uploaded = false;
      let lastError = "Upload chunk failed.";
      for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
        try {
          const chunkResponse = await fetch("/api/upload/" + init.upload_id + "/chunk/" + index, {
            method: "PUT",
            headers: {"X-CSRF-Token":csrfToken,"Content-Type":"application/octet-stream"},
            body: chunk
          });
          const chunkData = await chunkResponse.json();
          if (!chunkResponse.ok) throw new Error(chunkData.error || lastError);
          uploaded = true;
        } catch (error) {
          lastError = error.message;
        }
      }
      if (!uploaded) throw new Error("Upload stopped at part " + (index + 1) + " of " + totalChunks + ": " + lastError);
      $("bar").style.width = Math.round(((index + 1) / totalChunks) * 15) + "%";
      $("status").textContent = "Uploading video: " + (index + 1) + " of " + totalChunks + " parts…";
    }
    const completeResponse = await fetch("/api/upload/" + init.upload_id + "/complete", {
      method: "POST",
      headers: {"X-CSRF-Token":csrfToken}
    });
    const data = await completeResponse.json();
    if (!completeResponse.ok) throw new Error(data.error || "Could not finish upload.");
    poll(data.id);
  } catch (error) {
    $("status").textContent = error.message;
    $("start").disabled = false;
  }
});

async function poll(id) {
  clearTimeout(pollTimer);
  try {
    const response = await fetch("/api/jobs/" + id);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Could not check job.");
    $("status").textContent = job.message || job.status;
    $("bar").style.width = (job.progress || 0) + "%";
    if (job.status === "completed") {
      $("start").disabled = false;
      $("results").innerHTML = (job.clips || []).map((clip) => {
        const link = "/clips/" + encodeURIComponent(clip.file);
        return '<article class="clip"><div><strong>' + escapeHtml(clip.name) +
          '</strong><p>' + clip.start + 's – ' + clip.end +
          's</p><p>' + escapeHtml(clip.transcript || "Transcript unavailable") +
          '</p><a href="' + link + '">Download video</a></div></article>';
      }).join("") +
        '<div class="job-cleanup"><p class="muted">Download the clips you want to keep. Then delete this job to free server storage.</p>' +
        '<button id="done-delete" class="danger" type="button" data-job-id="' + encodeURIComponent(id) +
        '">Done &amp; Delete this job</button><p id="delete-status" class="muted" aria-live="polite"></p></div>';
      return;
    }
    if (job.status === "failed") {
      $("start").disabled = false;
      $("results").innerHTML = '<p class="error">' + escapeHtml(job.message) + '</p>' +
        '<button id="done-delete" class="danger" type="button" data-job-id="' + encodeURIComponent(id) +
        '">Delete failed job</button><p id="delete-status" class="muted" aria-live="polite"></p>';
      return;
    }
    pollTimer = setTimeout(() => poll(id), 2500);
  } catch (error) {
    $("status").textContent = error.message;
    $("start").disabled = false;
  }
}

$("results").addEventListener("click", async (event) => {
  const button = event.target.closest("#done-delete");
  if (!button) return;
  const jobId = button.dataset.jobId;
  if (!confirm("Delete this job and all its generated clips from the server? Download anything you want to keep first.")) return;
  button.disabled = true;
  const status = $("delete-status");
  status.textContent = "Deleting uploaded video, clips and temporary files…";
  try {
    const response = await fetch("/api/jobs/" + encodeURIComponent(jobId) + "/delete", {
      method: "POST",
      headers: {"X-CSRF-Token": csrfToken}
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not delete this job.");
    $("results").innerHTML = '<p class="muted">Job deleted. Server storage has been cleared.</p>';
    $("job").classList.add("hidden");
    $("source-video").value = "";
    $("clip-form").reset();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}
