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
  const form = new FormData();
  form.append("video", sourceFile);
  form.append("count", $("count").value);
  form.append("clip_seconds", $("length").value);
  form.append("aspect", $("aspect").value);
  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      headers: {"X-CSRF-Token": csrfToken},
      body: form
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not upload video.");
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
