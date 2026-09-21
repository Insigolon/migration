/* Embeds — Microlink auto-preview with graceful fallback. No key needed. */
(function () {
  async function fetchPreview(url) {
    const endpoint = "https://api.microlink.io?url=" + encodeURIComponent(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
      const res = await fetch(endpoint, { signal: ctrl.signal });
      if (!res.ok) throw new Error("http " + res.status);
      const json = await res.json();
      if (json.status !== "success") throw new Error("microlink " + (json.status || "fail"));
      const d = json.data || {};
      return {
        title: d.title || "",
        description: d.description || "",
        image: (d.image && d.image.url) || "",
        ok: true
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  }

  function openPreview(url) {
    const dlg = document.getElementById("preview-modal");
    const frame = document.getElementById("preview-frame");
    document.getElementById("preview-url").textContent = url;
    frame.removeAttribute("srcdoc");
    frame.src = url;
    document.getElementById("preview-open").onclick = () => window.open(url, "_blank", "noopener");
    dlg.showModal();
  }

  document.getElementById("preview-close").addEventListener("click", () => {
    const dlg = document.getElementById("preview-modal");
    document.getElementById("preview-frame").src = "about:blank";
    dlg.close();
  });

  /* Downscale uploads so localStorage (~5MB) survives */
  function fileToDataURL(file, maxDim = 1600) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let { width: w, height: h } = img;
        const s = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * s); h = Math.round(h * s);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function faviconOf(url) {
    try {
      const host = new URL(url).hostname;
      return "https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(host);
    } catch { return ""; }
  }

  /* Raw file -> dataURL (PDFs can't downscale like images). Caller enforces size. */
  function fileToPDFDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = reject;
      r.readAsText(file);
    });
  }

  /* PDFs: browsers fail multi-MB data: embeds and block top-level data:
     navigation (white page). Derive a Blob object URL per item for
     preview + open, keep the stored dataURL untouched. */
  const _pdfUrlCache = new Map(); // key -> {len, url}
  function _dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || "");
    if (!m) return null;
    const mime = m[1] || "application/pdf";
    try {
      if (m[2]) {
        const bin = atob(m[3]);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
      }
      return new Blob([decodeURIComponent(m[3])], { type: mime });
    } catch { return null; }
  }
  function pdfViewUrl(key, src) {
    const s = String(src || "");
    if (!/^data:application\/pdf/i.test(s)) return s; // http(s)/blob passthrough
    const len = s.length;
    const hit = _pdfUrlCache.get(key);
    if (hit && hit.len === len) return hit.url;
    if (hit) { try { URL.revokeObjectURL(hit.url); } catch {} }
    const blob = _dataUrlToBlob(s);
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    _pdfUrlCache.set(key, { len, url });
    return url;
  }
  function pdfRevokeStale(activeKeys) {
    const keep = new Set(activeKeys || []);
    for (const [k, v] of _pdfUrlCache) {
      if (!keep.has(k)) { try { URL.revokeObjectURL(v.url); } catch {} _pdfUrlCache.delete(k); }
    }
  }
  function pdfBytes(src) {
    const s = String(src || "");
    const m = /^data:[^,]*;base64,(.*)$/s.exec(s);
    if (m) return Math.floor(m[1].length * 3 / 4);
    return s.length;
  }
  function fmtBytes(n) {
    if (!(n >= 0)) return "";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  }
  function pdfSizeLabel(src, fallbackBytes) {
    const s = String(src || "");
    if (/^data:/i.test(s)) return fmtBytes(pdfBytes(s));
    if (typeof fallbackBytes === "number") return fmtBytes(fallbackBytes);
    return "";
  }
  function downloadUrl(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "document.pdf";
    if (!/^data:/i.test(url)) a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  /* Markdown download: text -> Blob object URL -> download, then revoke. */
  function downloadMarkdown(text, name) {
    const blob = new Blob([String(text == null ? "" : text)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      downloadUrl(url, name || "note.md");
    } finally {
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 5000);
    }
  }

  window.SignalEmbeds = { fetchPreview, domainOf, faviconOf, openPreview, fileToDataURL, fileToPDFDataURL, readTextFile, pdfViewUrl, pdfRevokeStale, pdfSizeLabel, downloadUrl, downloadMarkdown };
})();
