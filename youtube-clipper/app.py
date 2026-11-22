from __future__ import annotations
import json, logging, os, re, secrets, shutil, subprocess, threading, time, uuid
from pathlib import Path
import requests, whisper
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("video_highlights")
BASE = Path(__file__).resolve().parent
load_dotenv(BASE / ".env")
DATA = Path(os.environ.get("CLIPPER_DATA", BASE / "data")).resolve()
JOBS, INCOMING = DATA / "jobs", DATA / "incoming"
for folder in (JOBS, INCOMING):
    folder.mkdir(parents=True, exist_ok=True)
    folder.chmod(0o700)
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
PASSWORD_HASH, PASSWORD = os.environ.get("APP_PASSWORD_HASH", ""), os.environ.get("APP_PASSWORD", "")
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_BYTES", str(1024**3)))
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "1") == "1",
                  MAX_CONTENT_LENGTH=MAX_UPLOAD)
CHUNK, MAX_CLIPS, CLIP_SECONDS = 8 * 1024**2, 10, 90
MAX_DURATION = int(os.environ.get("MAX_VIDEO_SECONDS", "10800"))
BRIDGE = os.environ.get("WHATSAPP_BRIDGE_URL", "http://127.0.0.1:8766").rstrip("/")
PHONE_NUMBER = re.sub(r"\D", "", os.environ.get("WHATSAPP_PHONE_NUMBER", ""))
CHAT_ID = os.environ.get("WHATSAPP_CHAT_ID", "").strip() or (f"{PHONE_NUMBER}@s.whatsapp.net" if PHONE_NUMBER else "")
MODEL_NAME = os.environ.get("WHISPER_MODEL", "base")
whatsapp_process = None
jobs, upload_locks = {}, {}
lock, model_lock = threading.RLock(), threading.Lock()
whisper_model = None
# Restore small job records so a PM2 restart does not lose delivery retry state.
for saved in JOBS.glob("*.json"):
    try:
        item = json.loads(saved.read_text(encoding="utf-8"))
        if item.get("pipeline") == "whatsapp-highlights" and item.get("id"):
            if item.get("status") == "sending":
                item["status"] = "delivery_failed"
                item["message"] = "The app restarted during WhatsApp delivery. Retry to send any clips not yet accepted."
                saved.write_text(json.dumps(item), encoding="utf-8")
            jobs[item["id"]] = item
    except (OSError, json.JSONDecodeError):
        log.warning("Skipping unreadable job record: %s", saved.name)

def logged_in(): return session.get("authenticated") is True
def require_login():
    if not logged_in(): abort(401)

def write_job(job_id, **changes):
    with lock:
        if job_id not in jobs: return
        jobs[job_id].update(changes)
        tmp = JOBS / f".{job_id}.json.tmp"
        tmp.write_text(json.dumps(jobs[job_id], ensure_ascii=False), encoding="utf-8")
        tmp.replace(JOBS / f"{job_id}.json")

def load_model():
    global whisper_model
    with model_lock:
        if whisper_model is None:
            log.info("Loading Whisper model %s", MODEL_NAME)
            whisper_model = whisper.load_model(MODEL_NAME)
        return whisper_model

def score_text(text):
    words = re.findall(r"[a-zA-Z']+", text.lower())
    if not words: return 0.0
    groups = [
        {"secret","truth","realize","revealed","actually","discover"},
        {"love","fear","angry","cry","laugh","amazing","terrible","beautiful"},
        {"wow","unbelievable","suddenly","never","shocking","incredible"},
        {"important","mistake","remember","best","worst","must","why"},
        {"because","then","but","until","finally","imagine","problem","happened"},
        {"yes","no","wait","what","seriously","listen","look"},
    ]
    hits = sum(1 for word in words if any(word in group for group in groups))
    return hits * 1.6 + text.count("!") * 1.1 + text.count("?") * .8 + min(len(words)/45, 1.5)

def choose_highlights(segments, duration, requested):
    if not segments:
        raise RuntimeError("No speech was detected. This first version uses spoken content to find highlights.")
    latest = max(0.0, duration - CLIP_SECONDS)
    starts = {min(latest, max(0.0, round(max(0.0, float(s.get("start",0))-30)/15)*15)) for s in segments}
    candidates = []
    for start in starts:
        end = min(duration, start + CLIP_SECONDS)
        parts = [s for s in segments if float(s.get("start",0)) < end and float(s.get("end",0)) > start]
        text = " ".join(str(s.get("text","")).strip() for s in parts).strip()
        if text: candidates.append({"start":start,"end":end,"score":score_text(text)+min(len(parts)/8,2),"text":text})
    candidates.sort(key=lambda x:x["score"], reverse=True)
    chosen=[]
    for item in candidates:
        if all(item["end"] <= old["start"] or item["start"] >= old["end"] for old in chosen):
            chosen.append(item)
        if len(chosen) >= requested: break
    if not chosen: raise RuntimeError("Could not identify suitable spoken highlight moments.")
    return sorted(chosen,key=lambda x:x["start"])

def send_clip(path, caption):
    if not CHAT_ID: raise RuntimeError("Set WHATSAPP_PHONE_NUMBER in the app environment before processing.")
    if not path.is_file(): raise FileNotFoundError(f"Missing clip: {path.name}")
    payload={"chatId":CHAT_ID,"filePath":str(path.resolve()),"mediaType":"video",
             "caption":caption[:900],"fileName":path.name}
    response=requests.post(f"{BRIDGE}/send-media",json=payload,timeout=(10,300))
    try: result=response.json()
    except ValueError: result={"error":response.text[:250]}
    if response.status_code >= 400 or result.get("success") is not True:
        raise RuntimeError(f"WhatsApp bridge rejected {path.name}: {result.get('error',response.status_code)}")
    return result

def deliver(job_id, work):
    clips=jobs[job_id].get("clips",[])
    sent=set(jobs[job_id].get("sent_indices",[]))
    write_job(job_id,status="sending",progress=90,message=f"Sending clips to WhatsApp ({len(sent)}/{len(clips)})…")
    for i,clip in enumerate(clips):
        if i in sent: continue
        caption=f"Highlight {i+1}/{len(clips)} · {clip['start']}s–{clip['end']}s\n{clip.get('transcript','')[:500]}"
        error=None
        for attempt in range(1,4):
            try:
                send_clip(work/clip["file"],caption)
                sent.add(i)
                write_job(job_id,sent_indices=sorted(sent),progress=90+int(9*len(sent)/max(1,len(clips))),
                          message=f"WhatsApp accepted clip {len(sent)} of {len(clips)}…")
                error=None
                break
            except Exception as exc:
                error=exc
                log.warning("WhatsApp attempt %s failed for job %s clip %s: %s",attempt,job_id,i+1,exc)
                if attempt < 3: time.sleep(3*attempt)
        if error is not None:
            write_job(job_id,status="delivery_failed",
                      message=f"WhatsApp could not accept clip {i+1}. Your original and clips are safe on the server. Tap Retry WhatsApp delivery.")
            return False
    # Baileys has accepted every clip; now clear the complete video workspace.
    shutil.rmtree(work,ignore_errors=True)
    for path in INCOMING.glob(job_id+".*"): path.unlink(missing_ok=True)
    write_job(job_id,status="delivered",progress=100,
              message=f"All {len(clips)} clips sent to WhatsApp. Original and clip files deleted from the server.",
              storage_cleared=True)
    return True

def process_video(job_id, source_path, requested):
    work=JOBS/job_id
    work.mkdir(mode=0o700,parents=True,exist_ok=True)
    source=work/("original"+source_path.suffix.lower())
    try:
        write_job(job_id,status="validating",progress=5,message="Checking your uploaded video…")
        source_path.replace(source)
        probe=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
            "-of","default=noprint_wrappers=1:nokey=1",str(source)],
            check=True,capture_output=True,text=True,timeout=60)
        duration=float(probe.stdout.strip())
        if duration <= 0 or duration > MAX_DURATION:
            raise ValueError(f"Video duration must be between 1 second and {MAX_DURATION//3600} hours.")
        write_job(job_id,status="transcribing",progress=20,message="AI is analysing the spoken content…")
        transcript=load_model().transcribe(str(source),fp16=False,verbose=False)
        picks=choose_highlights(transcript.get("segments",[]),duration,requested)
        write_job(job_id,status="rendering",progress=55,message=f"Creating {len(picks)} clips (maximum 90 seconds each)…")
        clips=[]
        for i,pick in enumerate(picks,1):
            output=work/f"highlight_{i:02d}.mp4"
            subprocess.run(["ffmpeg","-y","-ss",f"{pick['start']:.3f}","-i",str(source),
                "-t",f"{pick['end']-pick['start']:.3f}","-vf","scale='min(720,iw)':-2",
                "-c:v","libx264","-preset","veryfast","-crf","28","-c:a","aac","-b:a","96k",
                "-movflags","+faststart",str(output)],check=True,stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,text=True,timeout=1800)
            clips.append({"file":output.name,"name":f"Highlight {i:02d}",
                          "start":round(pick["start"],2),"end":round(pick["end"],2),
                          "transcript":pick["text"][:500]})
            write_job(job_id,progress=55+int(30*i/len(picks)),message=f"Created clip {i} of {len(picks)}…")
        write_job(job_id,clips=clips,status="clips_ready",progress=88,
                  message=f"Created {len(clips)} clips. Sending to WhatsApp…")
        deliver(job_id,work)
    except Exception as exc:
        log.exception("Processing failed for job %s",job_id)
        write_job(job_id,status="failed",progress=0,message=str(exc)[:500],storage_cleared=False)
        # Keep source and any rendered clips if processing or delivery cannot finish.

@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"]="nosniff"
    response.headers["X-Frame-Options"]="DENY"
    response.headers["Referrer-Policy"]="no-referrer"
    response.headers["Content-Security-Policy"]="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'"
    return response

@app.get("/login")
def login_page(): return render_template("login.html")

@app.post("/login")
def login():
    supplied=request.form.get("password","")
    ok=check_password_hash(PASSWORD_HASH,supplied) if PASSWORD_HASH else secrets.compare_digest(supplied,PASSWORD) if PASSWORD else False
    if not ok:
        time.sleep(1)
        return render_template("login.html",error="Incorrect password."),401
    session.clear(); session["authenticated"]=True; session["csrf"]=secrets.token_urlsafe(24)
    return redirect(url_for("index"))

@app.post("/logout")
def logout():
    require_login()
    if request.form.get("csrf") != session.get("csrf"): abort(403)
    session.clear()
    return redirect(url_for("login_page"))

@app.get("/")
def index():
    if not logged_in(): return redirect(url_for("login_page"))
    return render_template("index.html",csrf=session["csrf"])

@app.get("/health")
def health():
    return jsonify(status="ok",app="private-video-highlights",
                   whatsapp_configured=bool(CHAT_ID))

@app.get("/api/whatsapp/status")
def whatsapp_status():
    require_login()
    try:
        response = requests.get(f"{BRIDGE}/status", timeout=5)
        response.raise_for_status()
        data = response.json()
        data["recipient_configured"] = bool(CHAT_ID)
        return jsonify(data)
    except Exception as exc:
        log.warning("WhatsApp status unavailable: %s", exc)
        return jsonify(connected=False, qr_data_url=None,
                       recipient_configured=bool(CHAT_ID),
                       error="WhatsApp session is starting. Refresh in a moment."), 503

@app.post("/api/upload/init")
def init_upload():
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"): abort(403)
    data=request.get_json(silent=True) or {}
    filename=Path(str(data.get("filename",""))).name
    suffix=Path(filename).suffix.lower()
    if suffix not in {".mp4",".mov",".m4v",".mkv",".webm"}:
        return jsonify(error="Supported formats: MP4, MOV, M4V, MKV and WebM."),400
    try:
        size=int(data.get("size",0)); count=max(1,min(MAX_CLIPS,int(data.get("count",10))))
        chunks=int(data.get("chunks",0))
    except (TypeError,ValueError): return jsonify(error="Invalid upload details."),400
    expected=(size+CHUNK-1)//CHUNK
    if size<=0 or size>MAX_UPLOAD or chunks!=expected or chunks>256:
        return jsonify(error=f"Video must be between 1 byte and {MAX_UPLOAD//(1024**3)} GiB."),400
    upload_id=uuid.uuid4().hex
    folder=INCOMING/f"{upload_id}.upload"; folder.mkdir(mode=0o700)
    (folder/"meta.json").write_text(json.dumps({"suffix":suffix,"size":size,"chunks":chunks,
        "count":count,"received":[]}),encoding="utf-8")
    (folder/"video.part").touch(mode=0o600)
    upload_locks[upload_id]=threading.Lock()
    return jsonify(upload_id=upload_id,chunk_size=CHUNK),201

@app.put("/api/upload/<upload_id>/chunk/<int:index>")
def upload_chunk(upload_id,index):
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"): abort(403)
    if not re.fullmatch(r"[a-f0-9]{32}",upload_id): abort(404)
    folder=INCOMING/f"{upload_id}.upload"
    try: meta=json.loads((folder/"meta.json").read_text(encoding="utf-8"))
    except (OSError,json.JSONDecodeError): abort(404)
    if index<0 or index>=meta["chunks"]: abort(404)
    raw=request.get_data(cache=False)
    expected=min(CHUNK,meta["size"]-index*CHUNK)
    if len(raw)!=expected: return jsonify(error=f"Chunk {index+1} has an unexpected size."),400
    with upload_locks.setdefault(upload_id,threading.Lock()):
        with (folder/"video.part").open("r+b") as target:
            target.seek(index*CHUNK); target.write(raw)
        received=set(meta.get("received",[])); received.add(index); meta["received"]=sorted(received)
        (folder/"meta.json").write_text(json.dumps(meta),encoding="utf-8")
    return jsonify(received=index),200

@app.post("/api/upload/<upload_id>/abort")
def abort_upload(upload_id):
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"): abort(403)
    if not re.fullmatch(r"[a-f0-9]{32}",upload_id): abort(404)
    shutil.rmtree(INCOMING/f"{upload_id}.upload",ignore_errors=True)
    upload_locks.pop(upload_id,None)
    return jsonify(message="Incomplete upload removed.")

@app.post("/api/upload/<upload_id>/complete")
def complete_upload(upload_id):
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"): abort(403)
    if not re.fullmatch(r"[a-f0-9]{32}",upload_id): abort(404)
    folder=INCOMING/f"{upload_id}.upload"
    try:
        meta=json.loads((folder/"meta.json").read_text(encoding="utf-8"))
        video=folder/"video.part"
        if not video.is_file() or video.stat().st_size!=meta["size"] or len(meta.get("received",[]))!=meta["chunks"]:
            return jsonify(error="Upload is incomplete. Please retry the missing parts."),409
        job_id=uuid.uuid4().hex; source=INCOMING/f"{job_id}{meta['suffix']}"
        video.replace(source); shutil.rmtree(folder,ignore_errors=True); upload_locks.pop(upload_id,None)
    except (OSError,json.JSONDecodeError): abort(404)
    source.chmod(0o600)
    record={"id":job_id,"pipeline":"whatsapp-highlights","status":"queued","progress":1,"message":"Upload complete. Starting analysis…",
            "created":int(time.time()),"clips":[],"sent_indices":[],"requested_clips":meta["count"],"storage_cleared":False}
    with lock:
        jobs[job_id]=record
        (JOBS/f"{job_id}.json").write_text(json.dumps(record),encoding="utf-8")
    threading.Thread(target=process_video,args=(job_id,source,meta["count"]),
                     name=f"highlight-{job_id[:8]}",daemon=True).start()
    return jsonify(id=job_id),202

@app.get("/api/jobs/<job_id>")
def job_status(job_id):
    require_login()
    if not re.fullmatch(r"[a-f0-9]{32}",job_id): abort(404)
    with lock:
        item=jobs.get(job_id)
        if item is None:
            path=JOBS/f"{job_id}.json"
            if not path.is_file(): abort(404)
            item=json.loads(path.read_text(encoding="utf-8"))
    return jsonify({k:v for k,v in item.items() if k not in {"sent_indices","source_path"}})

@app.post("/api/jobs/<job_id>/retry")
def retry_delivery(job_id):
    require_login()
    if request.headers.get("X-CSRF-Token") != session.get("csrf"): abort(403)
    if not re.fullmatch(r"[a-f0-9]{32}",job_id): abort(404)
    with lock:
        record=jobs.get(job_id)
        if not record or record.get("status")!="delivery_failed":
            return jsonify(error="This job has no pending WhatsApp delivery."),409
        work=JOBS/job_id
        if not work.is_dir(): return jsonify(error="Retained video files are missing. Re-upload the video."),410
        record["status"]="sending"
    threading.Thread(target=deliver,args=(job_id,work),daemon=True).start()
    return jsonify(message="Retrying unsent clips."),202

@app.get("/api/jobs")
def list_jobs():
    require_login()
    with lock:
        return jsonify(jobs=[{k:v for k,v in item.items() if k not in {"sent_indices","source_path"}} for item in jobs.values()])

def run_whatsapp_bridge():
    global whatsapp_process
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js is required for the dedicated WhatsApp session.")
    env = os.environ.copy()
    env.setdefault("WHATSAPP_AUTH_DIR", str(DATA / "whatsapp-auth"))
    whatsapp_process = subprocess.Popen([node, str(BASE / "whatsapp.js")],
        cwd=str(BASE), env=env, stdin=subprocess.DEVNULL)
    def watch():
        while True:
            code = whatsapp_process.poll()
            if code is not None:
                log.error("Dedicated WhatsApp session exited (%s); restarting app under PM2.", code)
                os._exit(1)
            time.sleep(5)
    threading.Thread(target=watch, name="whatsapp-watch", daemon=True).start()

def run_cloudflare_tunnel():
    binary=shutil.which("cloudflared")
    if not binary: raise SystemExit("cloudflared is not installed or missing from PATH.")
    tunnel=subprocess.Popen([binary,"tunnel","--no-autoupdate","--url",
        f"http://127.0.0.1:{os.environ.get('PORT','8765')}"],stdin=subprocess.DEVNULL)
    def watch():
        while True:
            code=tunnel.poll()
            if code is not None:
                log.error("Cloudflare tunnel exited (%s); restarting app under PM2.",code)
                os._exit(1)
            time.sleep(5)
    threading.Thread(target=watch,name="cloudflare-watch",daemon=True).start()

if __name__=="__main__":
    if not PASSWORD and not PASSWORD_HASH: raise SystemExit("Set APP_PASSWORD or APP_PASSWORD_HASH before starting.")
    run_whatsapp_bridge()
    run_cloudflare_tunnel()
    app.run(host="127.0.0.1",port=int(os.environ.get("PORT","8765")),debug=False,use_reloader=False,threaded=True)
