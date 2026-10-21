#!/usr/bin/env python3
"""idea-signal backend: serves the static site + one shared JSON document.

- Listens on 127.0.0.1 ONLY (Caddy proxies LAN traffic to it; nothing exposed).
- GET  /api/data -> {"rev": N, "data": {...} | null}
- PUT  /api/data    {base, data} -> {"ok": true, "rev": N+1} (last-write-wins)
- SEM-CC per-subject PDF uploads (the Sem-CC frontend calls these with
  relative URLs, so they work through every proxy of this backend):
  - GET  /api/uploads?subject=<id> -> {"ok": true, "subject": id, "files": [...]}
  - GET  /api/uploads               -> {"ok": true, "uploads": {id: [...]}}
  - PUT  /api/uploads?subject=<id>&filename=<n.pdf>&unit=<u>&name=<label>
         (raw PDF bytes, max 100MB) -> {"ok": true, "file": {...}}
  - DELETE /api/uploads?subject=<id>&filename=<n.pdf> -> {"ok": true}
- Everything else -> static files from this folder.
- Stdlib only, no dependencies.
"""
import json
import os
import re
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit, parse_qs, unquote

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(ROOT, "data.json")
FILES_DIR = os.path.join(ROOT, "files")
MAX_BYTES = 15 * 1024 * 1024
FILE_MAX_BYTES = 100 * 1024 * 1024
FILES_TOTAL_MAX = 5 * 1024 * 1024 * 1024
ORPHAN_GRACE_SEC = 24 * 3600
HOST, PORT = "127.0.0.1", 8123
_FILE_ID_RE = re.compile(r"^[a-z0-9]{4,40}$")

# Match local CSS/JS refs in index.html, with or without an existing ?v=.
# Version is per-file mtime so any edit changes the URL -> browsers fetch fresh.
_ASSET_RE = re.compile(r'(?P<path>(?:css|js)/[A-Za-z0-9_.\-]+\.(?:css|js))(?P<ver>\?v=[^"\'\s>]+)?')


def _asset_version(rel_path):
    try:
        return str(int(os.path.getmtime(os.path.join(ROOT, rel_path))))
    except OSError:
        return str(int(time.time()))


def _build_id():
    # Max mtime across index + all local CSS/JS: any UI edit bumps the badge.
    # Lets you verify on a phone ("BUILD 17892…") instead of guessing.
    candidates = [os.path.join(ROOT, "index.html")]
    for sub in ("css", "js"):
        d = os.path.join(ROOT, sub)
        try:
            for name in os.listdir(d):
                if name.endswith((".css", ".js")):
                    candidates.append(os.path.join(d, name))
        except OSError:
            pass
    try:
        return str(int(max(os.path.getmtime(p) for p in candidates)))
    except (OSError, ValueError):
        return str(int(time.time()))


def _versioned_index_html():
    with open(os.path.join(ROOT, "index.html"), "r", encoding="utf-8") as f:
        html = f.read()

    def repl(m):
        return f"{m.group('path')}?v={_asset_version(m.group('path'))}"

    html = _ASSET_RE.sub(repl, html)
    build = _build_id()
    marker = (
        f"<!-- BUILD {build} -->"
        f'<script>window.SignalBuild="{build}";'
        'try{var k=document.getElementById("hero-kicker");'
        'if(k&&!k.querySelector(".build-tag")){var s=document.createElement("span");'
        's.className="build-tag";s.style.opacity=".55";'
        's.textContent=" \\u00b7 BUILD "+window.SignalBuild;k.appendChild(s);}}catch(e){}</script>'
        "</body>"
    )
    if "</body>" in html:
        html = html.replace("</body>", marker, 1)
    else:
        html += marker
    return html.encode("utf-8")


def read_store():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            s = json.load(f)
        if isinstance(s, dict) and isinstance(s.get("rev"), int):
            return s
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"rev": 0, "data": None}


def write_store(doc):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    os.replace(tmp, DATA_FILE)


# ---------- file-backed PDFs (100MB): bytes live on disk, JSON keeps refs ----
def _file_id_ok(fid):
    return bool(fid) and bool(_FILE_ID_RE.match(fid))


def _file_path(fid):
    return os.path.join(FILES_DIR, fid + ".pdf")


def _files_total():
    total = 0
    try:
        for name in os.listdir(FILES_DIR):
            if name.endswith(".pdf"):
                try:
                    total += os.path.getsize(os.path.join(FILES_DIR, name))
                except OSError:
                    pass
    except OSError:
        pass
    return total


def _referenced_file_ids(data):
    ids = set()
    try:
        for p in (data or {}).get("projects", []):
            for it in p.get("items", []):
                src = it.get("src") if isinstance(it, dict) else None
                if isinstance(src, str) and src.startswith("/api/files/"):
                    fid = src.split("/api/files/", 1)[1].split("?", 1)[0].split("/", 1)[0]
                    if _file_id_ok(fid):
                        ids.add(fid)
    except (AttributeError, TypeError):
        pass
    return ids


def _gc_orphan_files(data):
    # Never fail a save because of cleanup.
    try:
        keep = _referenced_file_ids(data)
        now = time.time()
        for name in os.listdir(FILES_DIR):
            if not name.endswith(".pdf"):
                continue
            fid = name[:-4]
            if fid in keep:
                continue
            fp = os.path.join(FILES_DIR, name)
            try:
                if now - os.path.getmtime(fp) < ORPHAN_GRACE_SEC:
                    continue
                os.remove(fp)
            except OSError:
                pass
    except OSError:
        pass


def _migrate_embedded_pdfs():
    # One-shot (idempotent): extract data: PDFs into files/, rewrite srcs.
    # Shrinks the shared doc back to KBs so localStorage/sync stay healthy.
    import base64
    import binascii
    try:
        os.makedirs(FILES_DIR, exist_ok=True)
    except OSError:
        return
    doc = read_store()
    data = doc.get("data")
    if not data:
        return
    changed = False
    try:
        for p in data.get("projects", []):
            for it in p.get("items", []):
                if not isinstance(it, dict) or it.get("type") != "pdf":
                    continue
                src = it.get("src")
                if not isinstance(src, str) or not src.startswith("data:application/pdf"):
                    continue
                fid = it.get("id") if isinstance(it.get("id"), str) and _file_id_ok(it.get("id")) else None
                if not fid:
                    continue
                fp = _file_path(fid)
                if not os.path.isfile(fp):
                    try:
                        b64 = src.split(",", 1)[1]
                        raw = base64.b64decode(b64)
                    except (IndexError, binascii.Error, ValueError):
                        continue
                    if len(raw) > FILE_MAX_BYTES or raw[:5] != b"%PDF-":
                        continue
                    tmp = fp + ".tmp"
                    try:
                        with open(tmp, "wb") as f:
                            f.write(raw)
                        os.replace(tmp, fp)
                    except OSError:
                        try:
                            os.remove(tmp)
                        except OSError:
                            pass
                        continue
                it["src"] = "/api/files/" + fid
                changed = True
    except (AttributeError, TypeError):
        return
    if changed:
        try:
            write_store({"rev": doc.get("rev", 0) + 1, "data": data, "updatedAt": time.time()})
            print("migrated embedded PDFs to files/", flush=True)
        except OSError:
            pass


# ---------- SEM-CC per-subject PDF uploads (served from the Sem-CC subtree) ---
# Everything here is prefixed _semcc_ and touches only Sem-CC/ paths, so the
# board logic above stays untouched. Uploaded files land in
# Sem-CC/subjects/<id>/ with metadata in Sem-CC/uploads.json; the Sem-CC
# frontend merges them over the bundled data.js entries.
SEMCC_ROOT = os.path.join(ROOT, "Sem-CC")
SEMCC_SUBJECTS_DIR = os.path.join(SEMCC_ROOT, "subjects")
SEMCC_UPLOADS_FILE = os.path.join(SEMCC_ROOT, "uploads.json")
SEMCC_FILE_MAX_BYTES = 100 * 1024 * 1024
_SEMCC_SUBJECT_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{2,40}$")
_SEMCC_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\- (),+]{0,110}\.[pP][dD][fF]$")


def _semcc_subject_ok(sid):
    return bool(sid) and bool(_SEMCC_SUBJECT_RE.match(sid))


def _semcc_filename_ok(name):
    if not name or ".." in name or "/" in name or "\\" in name:
        return False
    if name.startswith("."):
        return False
    return bool(_SEMCC_FILENAME_RE.match(name))


def _semcc_clean_unit(unit):
    unit = re.sub(r"[\x00-\x1f\x7f]", "", (unit or "").strip())
    if len(unit) > 60:
        unit = unit[:60].strip()
    return unit or "Material"


def _semcc_clean_name(name, filename):
    name = re.sub(r"[\x00-\x1f\x7f]", "", (name or "").strip())
    if not name:
        base = filename[:-4] if filename.lower().endswith(".pdf") else filename
        name = base.replace("_", " ").replace("-", " ").strip() or base
    if len(name) > 120:
        name = name[:120].strip()
    return name


def _semcc_subject_dir(sid):
    return os.path.join(SEMCC_SUBJECTS_DIR, sid)


def _semcc_read_uploads():
    try:
        with open(SEMCC_UPLOADS_FILE, "r", encoding="utf-8") as f:
            doc = json.load(f)
        if isinstance(doc, dict):
            out = {}
            for k, v in doc.items():
                if _semcc_subject_ok(k) and isinstance(v, list):
                    out[k] = [e for e in v if isinstance(e, dict)]
            return out
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {}


def _semcc_write_uploads(doc):
    tmp = SEMCC_UPLOADS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2)
    os.replace(tmp, SEMCC_UPLOADS_FILE)


def _semcc_prune_missing(doc):
    """Drop metadata entries whose files vanished from disk. Returns True if changed."""
    changed = False
    for sid in list(doc.keys()):
        kept = []
        for entry in doc[sid]:
            fn = entry.get("filename")
            if isinstance(fn, str) and _semcc_filename_ok(fn) and os.path.isfile(
                os.path.join(_semcc_subject_dir(sid), fn)
            ):
                kept.append(entry)
            else:
                changed = True
        if kept:
            doc[sid] = kept
        else:
            doc.pop(sid, None)
            changed = True
    return changed


def _semcc_unique_filename(sdir, filename):
    if not os.path.exists(os.path.join(sdir, filename)):
        return filename
    base = filename[:-4]
    for i in range(1, 1000):
        candidate = "%s-%d.pdf" % (base, i)
        if len(candidate) > 120:
            candidate = "%s-%d.pdf" % (base[: 120 - len("-%d.pdf" % i)], i)
        if not os.path.exists(os.path.join(sdir, candidate)):
            return candidate
    return "%s-%d.pdf" % (base[:80], int(time.time()) % 100000)


class Handler(SimpleHTTPRequestHandler):
    server_version = "SignalIdeas/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):  # quiet; systemd captures crashes anyway
        pass

    def end_headers(self):
        # File blobs are immutable (unique id per upload) -> long-cache them.
        # Everything else stays no-store so UI/code updates propagate.
        if urlsplit(self.path).path.startswith("/api/files/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            # Hardened: force revalidation, forbid any disk/memory reuse.
            # Query-string versions (?v=) are the real cache-buster; these
            # headers are the safety net for proxies and old caches.
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def _strip_conditionals(self):
        # Force 200 instead of 304: a stale 304 keeps old CSS/JS alive
        # on phones/laptops even after we deploy a UI change.
        for h in ("If-Modified-Since", "If-None-Match"):
            if h in self.headers:
                del self.headers[h]

    def _serve_file(self, fid, head_only=False):
        if not _file_id_ok(fid):
            self.send_error(404)
            return
        fp = _file_path(fid)
        try:
            st = os.stat(fp)
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(st.st_size))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Last-Modified", self.date_time_string(st.st_mtime))
        self.end_headers()
        if head_only:
            return
        try:
            with open(fp, "rb") as f:
                while True:
                    chunk = f.read(256 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except (OSError, ConnectionError):
            pass

    def _serve_index(self, head_only=False):
        try:
            body = _versioned_index_html()
        except OSError:
            self.send_error(404)
            return
        self._strip_conditionals()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Build", _build_id())
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = urlsplit(self.path).path
        if p == "/api/data":
            self._json(200, read_store())
            return
        if p == "/api/uploads":
            self._semcc_list()
            return
        if p.startswith("/api/files/"):
            self._serve_file(p.split("/api/files/", 1)[1].split("/", 1)[0], head_only=False)
            return
        if p in ("/", "/index.html"):
            self._serve_index(head_only=False)
            return
        self._strip_conditionals()
        return super().do_GET()

    def do_HEAD(self):
        p = urlsplit(self.path).path
        if p.startswith("/api/files/"):
            self._serve_file(p.split("/api/files/", 1)[1].split("/", 1)[0], head_only=True)
            return
        if p in ("/", "/index.html"):
            self._serve_index(head_only=True)
            return
        self._strip_conditionals()
        return super().do_HEAD()

    # ----- SEM-CC uploads (see module section above; Sem-CC/ paths only) -----
    def _semcc_params(self):
        qs = parse_qs(urlsplit(self.path).query, keep_blank_values=True)

        def one(key):
            vals = qs.get(key)
            if not vals:
                return ""
            return unquote(vals[0])

        return one("subject").strip(), one("filename").strip(), one("unit"), one("name")

    def _semcc_list(self):
        sid, _, _, _ = self._semcc_params()
        doc = _semcc_read_uploads()
        if _semcc_prune_missing(doc):
            try:
                _semcc_write_uploads(doc)
            except OSError:
                pass
        if sid:
            if not _semcc_subject_ok(sid):
                self._json(400, {"ok": False, "error": "bad subject"})
                return
            self._json(200, {"ok": True, "subject": sid, "files": doc.get(sid, [])})
            return
        self._json(200, {"ok": True, "uploads": doc})

    def _semcc_put(self):
        sid, filename, unit, name = self._semcc_params()
        if not _semcc_subject_ok(sid):
            self.send_error(400, "bad subject")
            return
        if not _semcc_filename_ok(filename):
            self.send_error(400, "bad filename (use letters/numbers, end with .pdf)")
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > SEMCC_FILE_MAX_BYTES:
            # Drain an oversized body so the connection stays usable.
            if length > SEMCC_FILE_MAX_BYTES:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
            self.send_error(400 if length <= 0 else 413)
            return
        try:
            os.makedirs(_semcc_subject_dir(sid), exist_ok=True)
        except OSError:
            self.send_error(500)
            return
        sdir = _semcc_subject_dir(sid)
        filename = _semcc_unique_filename(sdir, filename)
        fp = os.path.join(sdir, filename)
        tmp = fp + ".tmp"
        try:
            with open(tmp, "wb") as f:
                remaining = length
                first = True
                while remaining > 0:
                    chunk = self.rfile.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    if first:
                        if chunk[:5] != b"%PDF-":
                            raise ValueError("not a pdf")
                        first = False
                    f.write(chunk)
                    remaining -= len(chunk)
                if remaining != 0:
                    raise OSError("short body")
            os.replace(tmp, fp)
        except ValueError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_error(400, "not a pdf")
            return
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_error(500)
            return
        try:
            st_size = os.path.getsize(fp)
        except OSError:
            st_size = length
        entry = {
            "filename": filename,
            "name": _semcc_clean_name(name, filename),
            "unit": _semcc_clean_unit(unit),
            "size": st_size,
            "uploadedAt": time.time(),
            # Relative to the Sem-CC page (/Sem-CC/index.html on every proxy),
            # so window.open(path) resolves to /Sem-CC/subjects/... correctly.
            "path": "subjects/%s/%s" % (sid, filename),
        }
        try:
            doc = _semcc_read_uploads()
            doc.setdefault(sid, []).append(entry)
            _semcc_write_uploads(doc)
        except OSError:
            try:
                os.remove(fp)
            except OSError:
                pass
            self.send_error(500)
            return
        self._json(200, {"ok": True, "file": entry})

    def _semcc_delete(self):
        sid, filename, _, _ = self._semcc_params()
        if not _semcc_subject_ok(sid) or not _semcc_filename_ok(filename):
            self.send_error(400)
            return
        fp = os.path.join(_semcc_subject_dir(sid), filename)
        # Refuse to delete anything outside the subject dir (paranoia).
        if os.path.abspath(fp) != os.path.join(os.path.abspath(_semcc_subject_dir(sid)), filename):
            self.send_error(400)
            return
        try:
            os.remove(fp)
        except FileNotFoundError:
            pass
        except OSError:
            self.send_error(500)
            return
        try:
            doc = _semcc_read_uploads()
            entries = doc.get(sid, [])
            doc[sid] = [e for e in entries if e.get("filename") != filename]
            if not doc[sid]:
                doc.pop(sid, None)
            _semcc_write_uploads(doc)
        except OSError:
            self.send_error(500)
            return
        self._json(200, {"ok": True})

    def _put_file(self, fid):
        # Single round trip: PUT raw PDF bytes, id chosen by the client uid.
        if not _file_id_ok(fid):
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > FILE_MAX_BYTES:
            # drain a wrong-sized body so the connection stays usable
            try:
                if length > FILE_MAX_BYTES:
                    remaining = length
                    while remaining > 0:
                        chunk = self.rfile.read(min(256 * 1024, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
            except OSError:
                pass
            self.send_error(400 if length <= 0 else 413)
            return
        if _files_total() + length > FILES_TOTAL_MAX:
            try:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
            except OSError:
                pass
            self.send_error(413)
            return
        try:
            os.makedirs(FILES_DIR, exist_ok=True)
        except OSError:
            self.send_error(500)
            return
        fp = _file_path(fid)
        tmp = fp + ".tmp"
        try:
            with open(tmp, "wb") as f:
                remaining = length
                first = True
                while remaining > 0:
                    chunk = self.rfile.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    if first:
                        if chunk[:5] != b"%PDF-":
                            raise ValueError("not a pdf")
                        first = False
                    f.write(chunk)
                    remaining -= len(chunk)
                if remaining != 0:
                    raise OSError("short body")
            os.replace(tmp, fp)
        except ValueError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_error(400)
            return
        except OSError:
            try:
                os.remove(tmp)
            except OSError:
                pass
            self.send_error(500)
            return
        self._json(200, {"ok": True, "id": fid, "url": "/api/files/" + fid, "size": length})

    def do_PUT(self):
        p = urlsplit(self.path).path
        if p.startswith("/api/files/"):
            self._put_file(p.split("/api/files/", 1)[1].split("/", 1)[0])
            return
        if p == "/api/uploads":
            self._semcc_put()
            return
        if p != "/api/data":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            self.send_error(400 if length <= 0 else 413)
            return
        try:
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, OSError):
            self.send_error(400)
            return
        if not isinstance(payload, dict) or "data" not in payload:
            self.send_error(400)
            return
        cur = read_store()
        new_rev = cur.get("rev", 0) + 1
        try:
            write_store({"rev": new_rev, "data": payload["data"], "updatedAt": time.time()})
        except OSError:
            self.send_error(500)
            return
        _gc_orphan_files(payload["data"])
        self._json(200, {"ok": True, "rev": new_rev})

    def do_DELETE(self):
        p = urlsplit(self.path).path
        if p == "/api/uploads":
            self._semcc_delete()
            return
        self.send_error(404)

    def do_POST(self):  # be liberal: some clients PUT via POST
        self.do_PUT()


if __name__ == "__main__":
    try:
        os.makedirs(FILES_DIR, exist_ok=True)
    except OSError:
        pass
    _migrate_embedded_pdfs()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"idea-signal backend on http://{HOST}:{PORT} (loopback only)", flush=True)
    srv.serve_forever()
