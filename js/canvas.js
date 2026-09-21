/* Canvas — infinite pan/zoom + notes/images/links/shapes + layers + inspector */
(function () {
  const store = window.SignalStore;
  const embeds = window.SignalEmbeds;

  const viewDash = document.getElementById("view-dashboard");
  const viewCanvas = document.getElementById("view-canvas");
  const viewport = document.getElementById("viewport");
  const world = document.getElementById("world");
  const itemsEl = document.getElementById("items");
  const layersEl = document.getElementById("layers");

  let pid = null;
  let tool = "select";
  let spaceHeld = false;
  let selectedId = null;
  let editingId = null;
  let pendingPoint = { x: 120, y: 120 };

  const proj = () => store.getProject(pid);
  const view = () => (proj() ? (proj().view ||= { x: 60, y: 40, zoom: 1 }) : { x: 0, y: 0, zoom: 1 });

  /* FigJam — sticky tints + wire (connector/stroke) helpers. Stroke colors
     are the bright variants so 2–3px lines stay legible on dark. */
  const TINTS = ["", "amber", "sage", "dusty", "clay"];
  const TINT_STROKE = { "": "#ff8a2b", amber: "#ffa159", sage: "#3ddc84", dusty: "#5ab0ff", clay: "#ff5c5c" };
  const wireColor = (it) => TINT_STROKE[it && it.color] || TINT_STROKE[""];
  const wireWidth = (it, fallback) => {
    const w = Number(it && it.width);
    return [2, 3, 5, 8].includes(w) ? w : fallback;
  };
  // Edge-midpoint anchor for a side of an item box.
  function anchorOf(it, side) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    if (side === "n") return { x: cx, y: it.y };
    if (side === "s") return { x: cx, y: it.y + it.h };
    if (side === "w") return { x: it.x, y: cy };
    return { x: it.x + it.w, y: cy };
  }
  // Nearest edge side of an item box to a world point (for click-to-attach).
  function nearestSide(it, x, y) {
    const dl = Math.abs(x - it.x), dr = Math.abs(x - (it.x + it.w));
    const dt = Math.abs(y - it.y), db = Math.abs(y - (it.y + it.h));
    const m = Math.min(dl, dr, dt, db);
    return m === dt ? "n" : m === db ? "s" : m === dl ? "w" : "e";
  }
  function wireEndpoints(it) {
    const p = proj();
    if (!p) return null;
    const a = p.items.find((x) => x.id === (it.from && it.from.id));
    const b = p.items.find((x) => x.id === (it.to && it.to.id));
    if (!a || !b || a.visible === false || b.visible === false) return null;
    if (a.type === "connector" || a.type === "stroke") return null;
    if (b.type === "connector" || b.type === "stroke") return null;
    return { a: anchorOf(a, it.from.side || "e"), b: anchorOf(b, it.to.side || "w") };
  }

  function open(id) {
    pid = id;
    selectedId = null;
    const p = proj();
    if (!p) return;
    document.getElementById("canvas-title").textContent = p.label;
    viewDash.classList.add("hidden");
    viewCanvas.classList.add("active");
    document.body.classList.add("in-canvas");
    setTool("select");
    setMTab("canvas");
    // rescue boards saved while nested sections landed behind parents
    if (restackProject(p)) { store.touch(pid); store.save(); }
    renderAll();
    // center a bit on open if empty view
    if (p.items.length === 0) {
      const v = view();
      v.x = 60; v.y = 40; v.zoom = 1;
    }
    applyView();
  }

  function back() {
    store.save(true);
    pid = null;
    viewCanvas.classList.remove("active");
    viewDash.classList.remove("hidden");
    document.body.classList.remove("in-canvas");
    window.dispatchEvent(new CustomEvent("signal:data"));
  }
  document.getElementById("btn-back").addEventListener("click", back);

  /* ---------- mobile tabs: canvas-first, layers/inspect swap the same area ---------- */
  const coarseMQ = window.matchMedia ? window.matchMedia("(pointer: coarse)") : { matches: false };
  const narrowMQ = window.matchMedia ? window.matchMedia("(max-width: 760px)") : { matches: false };
  function setMTab(name) {
    document.body.dataset.mtab = name;
    document.querySelectorAll("[data-mtab]").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.mtab === name ? "true" : "false"));
    if (name === "canvas") {
      // viewport was display:none -> rect changed; re-apply transform + re-render coords
      requestAnimationFrame(() => applyView());
    }
  }
  document.querySelectorAll("[data-mtab]").forEach((b) =>
    b.addEventListener("click", () => setMTab(b.dataset.mtab)));
  if (!document.body.dataset.mtab) setMTab("canvas");
  // touch hint under canvas (desktop string is meaningless on mobile)
  const canvasHint = document.getElementById("canvas-hint");
  if (canvasHint && coarseMQ.matches) {
    canvasHint.textContent = "DRAG BG TO PAN · PINCH TO ZOOM · DOUBLE-TAP TO ZOOM";
  }
  // orientation / URL-bar resize changes viewport rect -> re-pin transform
  window.addEventListener("resize", () => { if (proj()) applyView(); });
  // iOS Safari takes over two-finger gestures at the page level unless denied
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("gesturechange", (e) => e.preventDefault());

  /* ---------- swapped layout: coords + zoom overlay the canvas in .statusbar,
     tool hint drops below it (desktop .canvas-hint, mobile .statusbar pill).
     Same nodes, relocated — IDs stay unique. */
  const canvasCtl = document.getElementById("canvas-ctl");
  const statusbarEl = document.querySelector(".statusbar");
  const toolbarEl = document.querySelector(".toolbar");
  const stCoords = document.getElementById("st-coords");
  const zoomCtl = statusbarEl ? statusbarEl.querySelector(".zoom-ctl") : null;
  const toolHint = document.getElementById("tool-hint");
  const stCount = document.getElementById("st-count");
  function layoutCanvasCtl() {
    if (!canvasCtl || !statusbarEl || !toolbarEl || !stCoords || !zoomCtl || !toolHint) return;
    // Touch devices keep zoom reachable: the zoom cluster lives in the
    // floating canvas-ctl pill (shown on coarse pointers via CSS), since
    // the desktop statusbar stays hidden in the minimal HUD view.
    if (narrowMQ.matches || coarseMQ.matches) {
      canvasCtl.append(stCoords, zoomCtl);
      statusbarEl.append(toolHint);
    } else {
      // restore desktop order: coords, zoom, count, tool / hint last in toolbar
      statusbarEl.insertBefore(stCoords, stCount);
      statusbarEl.insertBefore(zoomCtl, stCount);
      // hint was originally the last child of .toolbar
      toolbarEl.append(toolHint);
    }
  }
  if (narrowMQ.addEventListener) narrowMQ.addEventListener("change", layoutCanvasCtl);
  else if (narrowMQ.addListener) narrowMQ.addListener(layoutCanvasCtl);
  layoutCanvasCtl();

  /* ---------- tools ---------- */
  function setTool(t) {
    tool = t;
    document.querySelectorAll("[data-tool]").forEach((b) =>
      b.setAttribute("aria-pressed", b.dataset.tool === t ? "true" : "false"));
    viewport.classList.toggle("tool-pan", t === "pan");
    viewport.classList.toggle("tool-place", ["note", "image", "link", "pdf", "md", "rect", "connect", "pen", "eraser"].includes(t));
    document.getElementById("st-tool").textContent = t.charAt(0).toUpperCase() + t.slice(1);
    const touch = coarseMQ.matches;
    const hints = touch ? {
      select: "Tap to select · drag to move · double-tap a note to type · pinch to zoom",
      pan: "Drag to pan · pinch to zoom",
      note: "Tap the canvas to place a note",
      image: "Tap the canvas to place an image",
      link: "Tap the canvas to place a link",
      pdf: "Tap the canvas to place a PDF",
      md: "Tap the canvas to place markdown",
      rect: "Tap the canvas to place a section",
      connect: "Tap one item, then tap another to connect them",
      pen: "Drag on the canvas to draw",
      eraser: "Tap a drawn stroke to erase it"
    } : {
      select: "Click note text again to type · drag to move · drag the corner to resize",
      pan: "Drag to pan · Ctrl+scroll to zoom",
      note: "Click the canvas to place a note",
      image: "Click the canvas to place an image",
      link: "Click the canvas to place a link",
      pdf: "Click the canvas to place a PDF",
      md: "Click the canvas to place markdown",
      rect: "Click the canvas to place a section (groups ideas behind it)",
      connect: "Click one item, then another to draw an arrow (Esc cancels)",
      pen: "Drag on the canvas to draw",
      eraser: "Click a drawn stroke to erase it"
    };
    document.getElementById("tool-hint").textContent = hints[t] || "";
  }
  document.querySelector(".toolbar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (b) setTool(b.dataset.tool);
  });

  /* ---------- view transform ---------- */
  function applyView() {
    const v = view();
    v.zoom = Math.min(4, Math.max(0.25, v.zoom));
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    document.querySelector(".grid-dots").style.backgroundSize = `${28 * v.zoom}px ${28 * v.zoom}px`;
    document.getElementById("st-zoom").textContent = Math.round(v.zoom * 100) + "%";
  }

  function screenToWorld(sx, sy) {
    const r = viewport.getBoundingClientRect();
    const v = view();
    return {
      x: Math.round((sx - r.left - v.x) / v.zoom),
      y: Math.round((sy - r.top - v.y) / v.zoom)
    };
  }

  /* ---------- section snap (magnetic only, no grouping) ----------
     Snaps an item's edges/center to nearby section edges/center.
     Threshold is ~12 screen px so feel is constant at any zoom.
     Nested sections: smallest containing section wins the highlight. */
  const SNAP_SCREEN_PX = 12;
  function sectionRects(ignoreId) {
    const p = proj();
    if (!p) return [];
    return p.items.filter((it) => it.type === "rect" && it.id !== ignoreId && it.visible !== false);
  }
  function snapPoint(x, y, w, h, ignoreId) {
    const rects = sectionRects(ignoreId);
    if (!rects.length) return { x: Math.round(x), y: Math.round(y), targetId: null };
    const tol = SNAP_SCREEN_PX / ((view() && view().zoom) || 1);
    const ax = [x, x + w / 2, x + w];
    const ay = [y, y + h / 2, y + h];
    let bestX = tol + 1, bestY = tol + 1;
    let srcX = null, srcY = null;
    for (const s of rects) {
      const tx = [s.x, s.x + s.w / 2, s.x + s.w];
      const ty = [s.y, s.y + s.h / 2, s.y + s.h];
      for (const a of ax) for (const t of tx) {
        const d = t - a;
        if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestX)) { bestX = d; srcX = s.id; }
      }
      for (const a of ay) for (const t of ty) {
        const d = t - a;
        if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestY)) { bestY = d; srcY = s.id; }
      }
    }
    if (Math.abs(bestX) > tol) { bestX = 0; srcX = null; }
    if (Math.abs(bestY) > tol) { bestY = 0; srcY = null; }
    const nx = Math.round(x + bestX);
    const ny = Math.round(y + bestY);
    // highlight: smallest section containing the center (with tol margin = "near")
    let targetId = null;
    let bestArea = Infinity;
    const cx = nx + w / 2, cy = ny + h / 2;
    for (const s of rects) {
      if (cx >= s.x - tol && cx <= s.x + s.w + tol && cy >= s.y - tol && cy <= s.y + s.h + tol) {
        const area = s.w * s.h;
        if (area < bestArea) { bestArea = area; targetId = s.id; }
      }
    }
    const snapped = nx !== Math.round(x) || ny !== Math.round(y);
    if (!targetId && snapped) targetId = srcX || srcY;
    return { x: nx, y: ny, targetId, snapped };
  }
  function flashSnap(targetId) {
    if (!targetId) return;
    const el = itemsEl.querySelector(`[data-id="${targetId}"]`);
    if (!el) return;
    el.classList.add("snap-target");
    setTimeout(() => el.classList.remove("snap-target"), 900);
  }
  function markSnapTarget(targetId) {
    itemsEl.querySelectorAll(".snap-target").forEach((el) => {
      if (el.dataset.id !== targetId) el.classList.remove("snap-target");
    });
    if (!targetId) return;
    const el = itemsEl.querySelector(`[data-id="${targetId}"]`);
    if (el) el.classList.add("snap-target");
  }

  function zoomAt(sx, sy, factor) {
    const r = viewport.getBoundingClientRect();
    const v = view();
    const px = sx - r.left, py = sy - r.top;
    const wx = (px - v.x) / v.zoom, wy = (py - v.y) / v.zoom;
    v.zoom = Math.min(4, Math.max(0.25, v.zoom * factor));
    v.x = px - wx * v.zoom;
    v.y = py - wy * v.zoom;
    applyView();
    store.save();
  }
  document.getElementById("zoom-in").addEventListener("click", () => {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
  });
  document.getElementById("btn-fit").addEventListener("click", () => {
    const v = view(); v.x = 60; v.y = 40; v.zoom = 1; applyView(); store.save();
  });

  /* focus mode (panels hidden) + native fullscreen on the canvas only */
  const workspaceEl = document.querySelector(".workspace");
  function setFocus(on) {
    workspaceEl.classList.toggle("focus", on);
    const b = document.getElementById("btn-focus");
    if (b) { b.textContent = on ? "EXIT FOCUS" : "FOCUS"; b.setAttribute("aria-pressed", on ? "true" : "false"); }
  }
  document.getElementById("btn-focus").addEventListener("click", () => {
    setFocus(!workspaceEl.classList.contains("focus"));
  });
  document.getElementById("btn-full").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewport.requestFullscreen();
    } catch { setFocus(true); } // fallback: in-page focus
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) return;
    setFocus(true); // hide panels while native-fullscreen too
  });

  /* ---------- items ---------- */
  function esc(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------- section nesting depth: full-containment chain, capped ----------
     A section inside another darkens one step per level; innermost wins via
     smallest containing area. Partial overlaps don't count. */
  const NEST_TOL = 4, NEST_MAX = 3;
  function sectionDepthMap(items) {
    const rects = (items || []).filter((it) => it.type === "rect" && it.visible !== false);
    const parent = new Map();
    for (const r of rects) {
      let best = null, bestArea = Infinity;
      for (const s of rects) {
        if (s.id === r.id) continue;
        if (r.x >= s.x - NEST_TOL && r.y >= s.y - NEST_TOL &&
            r.x + r.w <= s.x + s.w + NEST_TOL && r.y + r.h <= s.y + s.h + NEST_TOL) {
          const area = s.w * s.h;
          if (area < bestArea) { bestArea = area; best = s.id; }
        }
      }
      parent.set(r.id, best);
    }
    const depth = new Map();
    const visit = (id, seen) => {
      if (depth.has(id)) return depth.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      const par = parent.get(id);
      const d = par ? Math.min(NEST_MAX, visit(par, seen) + 1) : 0;
      depth.set(id, d);
      return d;
    };
    for (const r of rects) visit(r.id, new Set());
    return depth;
  }

  /* ---------- section contents: fully-contained closure (any type) ----------
     Moving a section carries these by the same delta. Nested rects carry
     theirs transitively; each item moves exactly once. Same tolerance as
     depth shading so visuals and behavior agree. */
  function containedIds(sectionId, sx, sy, sw, sh) {
    const p = proj();
    if (!p) return [];
    const out = [];
    const seen = new Set([sectionId]);
    const inside = (it, bx, by, bw, bh) =>
      it.x >= bx - NEST_TOL && it.y >= by - NEST_TOL &&
      it.x + it.w <= bx + bw + NEST_TOL && it.y + it.h <= by + bh + NEST_TOL;
    const stack = [{ id: sectionId, x: sx, y: sy, w: sw, h: sh }];
    while (stack.length) {
      const cur = stack.pop();
      for (const it of p.items) {
        if (seen.has(it.id) || it.visible === false) continue;
        if (inside(it, cur.x, cur.y, cur.w, cur.h)) {
          seen.add(it.id);
          out.push(it.id);
          if (it.type === "rect") stack.push({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h });
        }
      }
    }
    return out;
  }

  function renderItems() {
    const p = proj();
    if (!p) return;
    const depths = sectionDepthMap(p.items);
    // PDFs: an <embed> restarts its viewer whenever it leaves the document —
    // even re-appending the same node. So unchanged PDF nodes are NEVER
    // detached here: updated in place, repositioned only if misordered.
    const pdfKeyOf = (it) => String((it.src || "").length) + "|" + (it.name || "");
    const live = new Map();
    [...itemsEl.children].forEach((el) => {
      if (el.dataset && el.dataset.id) live.set(el.dataset.id, el);
    });
    const byId = new Map(p.items.map((x) => [x.id, x]));
    for (const [id, node] of live) {
      const it = byId.get(id);
      if (!it) { node.remove(); live.delete(id); continue; }
      if (it.type === "pdf" && node.dataset.pdfKey === pdfKeyOf(it) && node.querySelector(".pdf-body")) continue; // keep
      node.remove();
      live.delete(id);
    }
    let cur = itemsEl.firstChild;
    const place = (el) => {
      if (el !== cur) itemsEl.insertBefore(el, cur);
      else cur = cur.nextSibling;
    };
      p.items.forEach((it) => {
      if (it.type === "connector" || it.type === "stroke") return; // drawn in #wires
      const kept = live.get(it.id);
      if (kept) {
        kept.className = "citem" + (it.id === selectedId ? " selected" : "");
        kept.style.left = it.x + "px";
        kept.style.top = it.y + "px";
        kept.style.width = it.w + "px";
        kept.style.height = it.h + "px";
        kept.style.opacity = it.visible === false ? "0.25" : "";
        const nm = kept.querySelector(".pdf-nm");
        if (nm) {
          const sizeLbl = embeds.pdfSizeLabel ? embeds.pdfSizeLabel(it.src, it.size) : "";
          nm.textContent = (it.name || "PDF") + (sizeLbl ? " · " + sizeLbl : "");
        }
        try {
          if (embeds.pdfViewUrl) embeds.pdfViewUrl(it.id, it.src);
        } catch {}
        live.delete(it.id);
        place(kept);
        return;
      }
      const el = document.createElement("div");
      el.className = "citem" + (it.id === selectedId ? " selected" : "");
      el.dataset.id = it.id;
      el.style.left = it.x + "px";
      el.style.top = it.y + "px";
      el.style.width = it.w + "px";
      el.style.height = it.h + "px";
      if (it.visible === false) el.style.opacity = "0.25";

      if (it.type === "note") {
        el.innerHTML = `<div class="note-body" contenteditable="false"></div><div class="resize"></div>`;
        const nb = el.querySelector(".note-body");
        nb.textContent = it.text || "";
        if (it.color) nb.dataset.tint = it.color;
      } else if (it.type === "image") {
        el.innerHTML = `<img class="img-body" alt="" draggable="false"/><div class="resize"></div>`;
        const img = el.querySelector("img");
        img.src = it.src || "";
        img.onerror = () => { img.style.display = "none"; };
      } else if (it.type === "pdf") {
        const viewUrl = embeds.pdfViewUrl ? embeds.pdfViewUrl(it.id, it.src) : (it.src || "");
        const sizeLbl = embeds.pdfSizeLabel ? embeds.pdfSizeLabel(it.src, it.size) : "";
        el.innerHTML = `<div class="pdf-card"><embed class="pdf-body" type="application/pdf"/><div class="pdf-fallback">PREVIEW UNAVAILABLE — USE OPEN ↗ OR SAVE ⤓</div><div class="pdf-bar"><span class="pdf-nm"></span><button data-pdf="open">OPEN ↗</button><button data-pdf="save">SAVE ⤓</button></div></div><div class="resize"></div>`;
        if (viewUrl) el.querySelector("embed").src = viewUrl;
        else el.querySelector("embed").style.display = "none";
        el.querySelector(".pdf-nm").textContent = (it.name || "PDF") + (sizeLbl ? " · " + sizeLbl : "");
        el.dataset.pdfKey = String((it.src || "").length) + "|" + (it.name || "");
      } else if (it.type === "md") {
        el.innerHTML = `<div class="md-card"><div class="md-body"></div><div class="md-bar"><span class="md-nm"></span><button data-md="save">SAVE ⤓</button></div></div><div class="resize"></div>`;
        el.querySelector(".md-body").innerHTML = window.SignalMarkdown
          ? window.SignalMarkdown.render(it.text || "")
          : "";
        el.querySelector(".md-nm").textContent = mdFilename(it).replace(/\.md$/i, "");
      } else if (it.type === "link") {
        const failed = it.fetchState === "failed";
        const loading = it.fetchState === "loading";
        const fav = embeds.faviconOf ? embeds.faviconOf(it.url || "") : "";
        el.innerHTML = `
          <div class="link-card ${failed ? "failed" : ""} ${loading ? "loading" : ""}">
            ${it.image ? `<img alt="" draggable="false" src="${esc(it.image)}"/>` : ""}
            <div class="lk-t"></div>
            <div class="lk-d"></div>
            <div class="lk-dom">${fav ? `<img alt="" draggable="false" src="${esc(fav)}"/>` : ""}<code></code></div>
            <div class="lk-f">${failed ? `<button data-lk="retry" class="lk-retry">RETRY</button>` : `<button data-lk="preview">PREVIEW</button>`}<button data-lk="open">OPEN ↗</button></div>
          </div><div class="resize"></div>`;
        el.querySelector(".lk-t").textContent = loading ? "FETCHING PREVIEW…" : (it.title || it.url);
        el.querySelector(".lk-d").textContent = failed ? "PREVIEW FAILED — RETRY OR OPEN EXTERNALLY" : (it.description || "");
        el.querySelector(".lk-dom code").textContent = embeds.domainOf(it.url || "");
        el.querySelectorAll(".link-card > img").forEach((img) => { img.onerror = () => img.remove(); });
        const favImg = el.querySelector(".lk-dom img");
        if (favImg) favImg.onerror = () => favImg.remove();
      } else {
        const bg = it.color === "primary" ? "var(--primary)" : it.color === "secondary" ? "var(--secondary)" : it.color === "signal" ? "var(--signal)" : "var(--surface-alt)";
        const dd = Math.min(3, depths.get(it.id) || 0);
        el.innerHTML = `<div class="shape-rect depth-${dd}" style="background:${bg}">${it.label ? `<span class="shape-label"></span>` : ""}</div><div class="resize"></div>`;
        if (it.label) el.querySelector(".shape-label").textContent = it.label;
      }
      place(el);
    });
    if (embeds.pdfRevokeStale) {
      try { embeds.pdfRevokeStale(p.items.filter((x) => x.type === "pdf").map((x) => x.id)); } catch {}
    }
    document.getElementById("st-count").textContent = p.items.length + " objects";
    document.getElementById("layer-count").textContent = p.items.length;
    const mCount = document.getElementById("mtab-layer-count");
    if (mCount) mCount.textContent = p.items.length;
  }

  function connLabel(it) {
    const p = proj();
    const nm = (id) => {
      const o = p && p.items.find((x) => x.id === id);
      if (!o) return "?";
      const t = o.type === "note" ? (o.text || "note").split("\n")[0]
        : o.type === "link" ? (o.title || o.url || "link")
        : o.type === "pdf" || o.type === "md" ? (o.name || o.type)
        : o.type === "image" ? "image"
        : o.type === "rect" ? ("section " + (o.label || "")) : o.type;
      return String(t).slice(0, 12) || "?";
    };
    return nm(it.from && it.from.id) + " → " + nm(it.to && it.to.id);
  }
  function renderLayers() {
    const p = proj();
    if (!p) return;
    const depths = sectionDepthMap(p.items);
    layersEl.innerHTML = "";
    [...p.items].reverse().forEach((it) => {
      const row = document.createElement("div");
      row.className = "layer" + (it.id === selectedId ? " active" : "");
      row.dataset.kind = it.type;
      const dd = it.type === "rect" ? Math.min(3, depths.get(it.id) || 0) : 0;
      if (dd) row.style.paddingLeft = `calc(8px + ${dd * 14}px)`;
      const nm = it.type === "note" ? (it.text || "note").slice(0, 24)
        : it.type === "link" ? (it.title || it.url || "link").slice(0, 24)
        : it.type === "image" ? "image"
        : it.type === "pdf" ? (it.name || "pdf").slice(0, 24)
        : it.type === "md" ? ((it.name || (it.text || "markdown").split("\n")[0] || "markdown")).slice(0, 24)
        : it.type === "connector" ? connLabel(it).slice(0, 24)
        : it.type === "stroke" ? "stroke"
        : ("SECTION " + (it.label || "")).trim().slice(0, 24);
      row.innerHTML = `<span class="kind">${it.type === "rect" ? ("SECT" + (dd ? "·" + dd : "")) : it.type.toUpperCase().slice(0, 4)}</span><span class="nm"></span>
        <button data-l="hide">${it.visible === false ? "SHOW" : "HIDE"}</button><button data-l="del">×</button>`;
      row.querySelector(".nm").textContent = nm;
      row.addEventListener("click", (e) => {
        const b = e.target.closest("[data-l]");
        if (b) {
          e.stopPropagation();
          if (b.dataset.l === "del") deleteItem(it.id);
          else mutate(() => { it.visible = it.visible === false ? true : false; });
          return;
        }
        selectedId = it.id;
        renderAll();
        // on mobile, picking a layer should reveal it on the canvas
        if (narrowMQ.matches) setMTab("canvas");
      });
      layersEl.appendChild(row);
    });
  }

  function renderInspector() {
    const p = proj();
    const box = document.getElementById("inspector");
    const it = p && p.items.find((x) => x.id === selectedId);
    document.getElementById("insp-kind").textContent = it ? (it.type === "rect" ? "Section" : it.type.charAt(0).toUpperCase() + it.type.slice(1)) : "—";
    if (!it) {
      box.innerHTML = `<div class="insp-empty">No selection.<br><br>Pick Select, Pan, or a + tool from the toolbar.<br><br><span class="sig-0">V select · H pan · N/I/L/P/M/R place · C connect · W pen · X erase · F focus · Del delete · Ctrl+D duplicate · arrows nudge</span></div>`;
      return;
    }
    const showGeom = it.type !== "connector" && it.type !== "stroke";
    box.innerHTML = `
      ${showGeom ? `<div class="insp-group"><h4>GEOMETRY</h4>
        <div class="insp-grid">
          <label>X<input type="number" data-f="x" value="${it.x}"></label>
          <label>Y<input type="number" data-f="y" value="${it.y}"></label>
          <label>W<input type="number" data-f="w" value="${it.w}" min="60"></label>
          <label>H<input type="number" data-f="h" value="${it.h}" min="40"></label>
        </div>
      </div>` : ""}
      <div class="insp-group"><h4>CONTENT</h4><div data-zone="content"></div></div>
      <div class="insp-group"><h4>ARRANGE</h4>
        <div class="insp-row">
          <button data-a="front">FRONT</button><button data-a="back">BACK</button>
        </div>
        <div class="insp-row">
          <button data-a="dupl">DUPLICATE</button><button data-a="hide">${it.visible === false ? "SHOW" : "HIDE"}</button>
        </div>
        <div class="insp-row"><button data-a="del" style="color:var(--danger)">DELETE</button></div>
      </div>`;

    const zone = box.querySelector('[data-zone="content"]');
    const tintRow = (current) => `<div class="tint-row" role="group" aria-label="Color">${TINTS.map((t) =>
      `<button data-tint="${t}" aria-pressed="${(current || "") === t}" title="${t || "none"}" class="tint-${t || "none"}"></button>`).join("")}</div>`;
    if (it.type === "note") {
      zone.innerHTML = `<textarea data-f="text" rows="5"></textarea>
        <label class="sig-0" style="display:block;margin-top:6px">TINT</label>${tintRow(it.color)}`;
      zone.querySelector("textarea").value = it.text || "";
    } else if (it.type === "link") {
      zone.innerHTML = `<label class="sig-0">URL</label><input type="url" data-f="url" value="${esc(it.url || "")}">
        <label class="sig-0" style="display:block;margin-top:6px">TITLE</label><input type="text" data-f="title" value="${esc(it.title || "")}">
        <div class="insp-row"><button data-a="refresh">REFRESH PREVIEW</button><button data-a="preview">PREVIEW ↗</button></div>`;
    } else if (it.type === "image") {
      zone.innerHTML = `<label class="sig-0">SRC</label><input type="url" data-f="src" value="${esc(it.src || "")}">`;
    } else if (it.type === "pdf") {
      const rawSrc = String(it.src || "");
      const stored = rawSrc.startsWith("/api/files/");
      const embedded = /^data:application\/pdf/i.test(rawSrc);
      const sizeLbl = embeds.pdfSizeLabel ? embeds.pdfSizeLabel(it.src, it.size) : "";
      const where = stored ? "SERVER FILE" : embedded ? "EMBEDDED" : "URL";
      zone.innerHTML = `<label class="sig-0">NAME</label><input type="text" data-f="name" value="${esc(it.name || "")}" maxlength="120">
        <div class="sig-0" style="margin-top:6px">FILE: ${esc(where + (sizeLbl ? " · " + sizeLbl : ""))}</div>
        <label class="sig-0" style="display:block;margin-top:6px">REPLACE WITH URL</label><input type="url" data-f="pdfurl" placeholder="https://…/doc.pdf">
        <label class="sig-0" style="display:block;margin-top:6px">REPLACE WITH FILE (MAX 100MB)</label><input type="file" data-f="pdffile" accept="application/pdf,.pdf">
        <div class="insp-row"><button data-a="openpdf">OPEN ↗</button><button data-a="savepdf">SAVE ⤓</button></div>`;
      const urlInp = zone.querySelector('[data-f="pdfurl"]');
      if (urlInp) urlInp.addEventListener("change", () => {
        let u = urlInp.value.trim();
        if (!u) return;
        if (!/^https?:\/\//i.test(u)) u = "https://" + u;
        mutate(() => { it.src = u; it.size = undefined; });
      });
      const fileInp = zone.querySelector('[data-f="pdffile"]');
      if (fileInp) fileInp.addEventListener("change", async () => {
        const f = fileInp.files[0];
        if (!f) return;
        if (f.size > PDF_MAX_BYTES) { signalToast("PDF TOO LARGE — MAX 100MB"); fileInp.value = ""; return; }
        signalToast("UPLOADING PDF…");
        try {
          const res = await uploadPdfFile(f, null);
          mutate(() => { it.src = res.url; it.name = f.name.slice(0, 120); it.size = f.size; });
        } catch (err) { signalToast(err && err.message === "too-large" ? "PDF TOO LARGE — MAX 100MB" : "UPLOAD FAILED — TRY AGAIN"); }
        fileInp.value = "";
      });
    } else if (it.type === "md") {
      zone.innerHTML = `<label class="sig-0">NAME (FILENAME FOR DOWNLOAD)</label><input type="text" data-f="name" value="${esc(it.name || mdFilename(it))}" maxlength="120">
        <label class="sig-0" style="display:block;margin-top:6px">SOURCE (EDIT, THEN CLICK CANVAS TO RE-RENDER)</label><textarea data-f="text" rows="10"></textarea>
        <div class="insp-row"><button data-a="savemd">SAVE ⤓</button></div>`;
      zone.querySelector("textarea").value = it.text || "";
    } else if (it.type === "connector") {
      zone.innerHTML = `<div class="sig-0">FROM → TO (READ-ONLY, FOLLOWS ITEMS)</div>
        <div class="sig-0" style="margin-top:6px">${esc(connLabel(it))}</div>
        <label class="sig-0" style="display:block;margin-top:6px">COLOR</label>${tintRow(it.color)}
        <label class="sig-0" style="display:block;margin-top:6px">WIDTH</label><select data-f="width">
        <option value="2">Thin</option><option value="3">Medium</option><option value="5">Thick</option></select>
        <label class="sig-0" style="display:block;margin-top:6px">ARROW</label><select data-f="arrow">
        <option value="none">None</option><option value="end">End</option><option value="both">Both</option></select>
        <div class="insp-row"><button data-a="reverse">REVERSE</button></div>`;
      zone.querySelector('[data-f="width"]').value = String(wireWidth(it, 3));
      zone.querySelector('[data-f="arrow"]').value = it.arrow || "end";
    } else if (it.type === "stroke") {
      zone.innerHTML = `<label class="sig-0">COLOR</label>${tintRow(it.color)}
        <label class="sig-0" style="display:block;margin-top:6px">WIDTH</label><select data-f="width">
        <option value="2">Thin</option><option value="3">Medium</option><option value="5">Thick</option><option value="8">Bold</option></select>`;
      zone.querySelector('[data-f="width"]').value = String(wireWidth(it, 3));
    } else {
      zone.innerHTML = `<label class="sig-0">SECTION LABEL (GROUPS IDEAS PLACED ON TOP)</label><input type="text" data-f="label" value="${esc(it.label || "")}" maxlength="60">
        <label class="sig-0" style="display:block;margin-top:6px">FILL</label><select data-f="color">
        <option value="">SURFACE</option><option value="primary">PRIMARY</option>
        <option value="secondary">SECONDARY</option><option value="signal">SIGNAL</option></select>`;
      zone.querySelector("select").value = it.color || "";
    }

    box.querySelectorAll("[data-tint]").forEach((b) => {
      b.addEventListener("click", () => {
        mutate(() => { it.color = b.dataset.tint || ""; });
      });
    });
    box.querySelectorAll("[data-f]").forEach((inp) => {
      if (inp.dataset.f === "pdfurl" || inp.dataset.f === "pdffile") return; // handled above
      inp.addEventListener("change", () => {
        const f = inp.dataset.f;
        mutate(() => {
          if (["x", "y", "w", "h"].includes(f)) {
            const n = Number(inp.value);
            if (Number.isNaN(n)) return;
            const ox = it.x, oy = it.y;
            it[f] = Math.round(n);
            // moving a section shell via Inspector carries its contents too
            if (it.type === "rect" && (f === "x" || f === "y")) {
              const dx = it.x - ox, dy = it.y - oy;
              if (dx || dy) {
                for (const cid of containedIds(it.id, ox, oy, it.w, it.h)) {
                  const c = p.items.find((x) => x.id === cid);
                  if (c) { c.x += dx; c.y += dy; }
                }
              }
            }
          }
          else it[f] = inp.value;
          if (f === "url" && !it.title) refreshLinkPreview(it);
        });
      });
    });
    box.querySelectorAll("[data-a]").forEach((b) => {
      b.addEventListener("click", () => {
        const a = b.dataset.a;
        if (a === "del") deleteItem(it.id);
        if (a === "hide") mutate(() => { it.visible = it.visible === false ? true : false; });
        if (a === "dupl") duplicateItem(it.id);
        if (a === "front") mutate(() => { p.items = [...p.items.filter((x) => x.id !== it.id), it]; });
        if (a === "back") mutate(() => { p.items = [it, ...p.items.filter((x) => x.id !== it.id)]; });
        if (a === "refresh") refreshLinkPreview(it, true);
        if (a === "preview" && it.url) embeds.openPreview(it.url);
        if (a === "openpdf") openPdfItem(it);
        if (a === "savepdf") savePdfItem(it);
        if (a === "savemd") saveMdItem(it);
        if (a === "reverse" && it.type === "connector") {
          mutate(() => { const f = it.from; it.from = it.to; it.to = f; });
        }
      });
    });
  }

  function mutate(fn) {
    fn();
    store.touch(pid);
    store.save();
    renderAll();
  }

  /* PDFs: open/save through Blob object URLs — raw data: URLs blank-page. */
  function pdfItemUrl(it) {
    if (!it || !it.src) return "";
    try {
      if (embeds.pdfViewUrl) return embeds.pdfViewUrl(it.id, it.src) || "";
    } catch {}
    return /^data:application\/pdf/i.test(it.src || "") ? "" : (it.src || "");
  }
  function openPdfItem(it) {
    const url = pdfItemUrl(it);
    if (!url) { signalToast("PDF UNAVAILABLE — RE-UPLOAD OR REPLACE URL"); return; }
    const w = window.open(url, "_blank", "noopener");
    if (!w) signalToast("POPUP BLOCKED — USE SAVE ⤓");
  }
  function savePdfItem(it) {
    const url = pdfItemUrl(it);
    if (!url) { signalToast("PDF UNAVAILABLE — RE-UPLOAD OR REPLACE URL"); return; }
    try {
      if (embeds.downloadUrl) embeds.downloadUrl(url, it.name || "document.pdf");
      else {
        const a = document.createElement("a");
        a.href = url; a.download = it.name || "document.pdf";
        document.body.appendChild(a); a.click(); a.remove();
      }
    } catch { signalToast("SAVE FAILED"); }
  }

  /* Markdown: download raw .md source as a file (Blob, client-side only). */
  function mdFilename(it) {
    const raw = String((it && it.name) || "").trim();
    if (raw) {
      const base = raw.split(/[\\/]/).pop().trim();
      if (base) return /\.m(d|arkdown)$/i.test(base) ? base.slice(0, 120) : base.slice(0, 116) + ".md";
    }
    const first = String((it && it.text) || "").split("\n").map((s) => s.trim()).find((s) => s.length);
    if (first) {
      const slug = first.replace(/^#+\s*/, "").replace(/[`*_~[\]()<>:\"/\\|?]+/g, " ").trim()
        .replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      if (slug) return slug + ".md";
    }
    return "note.md";
  }
  function saveMdItem(it) {
    if (!it || typeof it.text !== "string" || !it.text.length) { signalToast("NOTHING TO SAVE"); return; }
    try {
      if (embeds.downloadMarkdown) embeds.downloadMarkdown(it.text, mdFilename(it));
      else {
        const blob = new Blob([it.text], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = mdFilename(it);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 5000);
      }
    } catch { signalToast("SAVE FAILED"); }
  }

  // Removing an item also removes connectors attached to it.
  function deleteItem(id) {
    const p = proj();
    if (!p) return;
    mutate(() => {
      const gone = new Set([id]);
      p.items.filter((x) => x.type === "connector" &&
        ((x.from && x.from.id === id) || (x.to && x.to.id === id)))
        .forEach((c) => gone.add(c.id));
      p.items = p.items.filter((x) => !gone.has(x.id));
      if (selectedId && gone.has(selectedId)) selectedId = null;
    });
  }

  function duplicateItem(id) {    const p = proj();
    const it = p.items.find((x) => x.id === id);
    if (!it) return;
    mutate(() => {
      const c = JSON.parse(JSON.stringify(it));
      c.id = store.uid();
      if (typeof c.x === "number") c.x += 24;
      if (typeof c.y === "number") c.y += 24;
      p.items.push(c);
      selectedId = c.id;
    });
  }

  async function refreshLinkPreview(it, force) {
    if (!it.url) return;
    if (!force && (it.title || it.fetchState === "ok")) return;
    it.fetchState = "loading";
    renderItems();
    try {
      const meta = await embeds.fetchPreview(it.url);
      mutate(() => {
        if (!it.title || force) it.title = meta.title || it.title || it.url;
        it.description = meta.description || it.description || "";
        it.image = meta.image || it.image || "";
        it.fetchState = "ok";
      });
    } catch {
      mutate(() => { it.fetchState = "failed"; });
      signalToast("PREVIEW FAILED — LINK STILL SAVED");
    }
  }

  /* Wires: connectors (arrows between items) + pen strokes, drawn as
     SVG in world coords. Rebuilt on every render; cheap like items. */
  const wiresEl = document.getElementById("wires");
  function escAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function strokePath(points) {
    if (!points || points.length === 0) return "";
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length; i++) d += `L${points[i][0]},${points[i][1]}`;
    return d;
  }
  function renderWires(preview) {
    if (!wiresEl) return;
    const p = proj();
    if (!p) { wiresEl.innerHTML = ""; return; }
    const defs = `<defs>${TINTS.map((t) => {
      const c = TINT_STROKE[t] || TINT_STROKE[""];
      const id = "ah-" + (t || "base");
      return `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1L9,5L0,9" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/></marker>`;
    }).join("")}</defs>`;
    let html = defs;
    p.items.forEach((it) => {
      if (it.visible === false) return;
      if (it.type === "connector") {
        const ends = wireEndpoints(it);
        if (!ends) return;
        const col = wireColor(it), w = wireWidth(it, 3);
        const sel = it.id === selectedId;
        const marker = it.arrow === "none" ? "" : ` marker-end="url(#ah-${escAttr(it.color || "base")})"`;
        const markerStart = it.arrow === "both" ? ` marker-start="url(#ah-${escAttr(it.color || "base")})"` : "";
        html += `<line class="wire-line${sel ? " selected" : ""}" data-wire="${it.id}" x1="${ends.a.x}" y1="${ends.a.y}" x2="${ends.b.x}" y2="${ends.b.y}" stroke="${col}" stroke-width="${sel ? w + 1.5 : w}"${marker}${markerStart}/>`;
        html += `<line class="wire-hit" data-wire="${it.id}" x1="${ends.a.x}" y1="${ends.a.y}" x2="${ends.b.x}" y2="${ends.b.y}" stroke-width="16"/>`;
      } else if (it.type === "stroke") {
        const d = strokePath(it.points);
        if (!d) return;
        const col = wireColor(it), w = wireWidth(it, 3);
        const sel = it.id === selectedId;
        html += `<path class="wire-line${sel ? " selected" : ""}" data-wire="${it.id}" d="${escAttr(d)}" stroke="${col}" stroke-width="${sel ? w + 1.5 : w}"/>`;
        html += `<path class="wire-hit" data-wire="${it.id}" d="${escAttr(d)}" stroke-width="18"/>`;
      }
    });
    if (preview && preview.d) {
      html += `<path class="wire-preview" d="${escAttr(preview.d)}" stroke="${escAttr(preview.color || TINT_STROKE[""])}" stroke-width="${preview.width || 3}"/>`;
    }
    wiresEl.innerHTML = html;
  }

  function renderAll() { renderItems(); renderWires(); renderLayers(); renderInspector(); applyView(); }

  /* ---------- pointer: pan / move / resize / place + pinch-zoom ---------- */
  let drag = null;
  const pointers = new Map();
  // Pending connector source {id, side} while the connect tool is armed.
  let connFrom = null;
  let pinch = null;
  let pinchQueued = false;
  let pinchFrame = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  // touch sets this when pointerdown changes selection without re-rendering
  // (rebuilding the node under the finger kills the touch stream); flushed on pointerup
  let touchSelDirty = false;
  // mark selection in place without rebuilding DOM mid-gesture
  function markSelectedTouch(itemEl) {
    touchSelDirty = true;
    itemsEl.querySelectorAll(".citem.selected").forEach((el) => { if (el !== itemEl) el.classList.remove("selected"); });
    itemEl.classList.add("selected");
    renderWires(); renderLayers(); renderInspector();
  }
  // Select without rebuilding item nodes at all (keeps PDF viewers alive).
  // Same visual result as renderItems for a pure selection change: only the
  // .selected classes move; counts and content are untouched.
  function selectOnly(id, itemEl) {
    selectedId = id;
    itemsEl.querySelectorAll(".citem.selected").forEach((el) => { if (el !== itemEl) el.classList.remove("selected"); });
    if (itemEl) itemEl.classList.add("selected");
    renderWires(); renderLayers(); renderInspector();
  }
  function deselectOnly() {
    selectedId = null;
    itemsEl.querySelectorAll(".citem.selected").forEach((el) => el.classList.remove("selected"));
    renderWires(); renderLayers(); renderInspector();
  }
  const TOUCH_SLOP = 8;
  const PINCH_MIN_DIST = 40; // ignore sub-40px spreads: factor math is noise-dominated
  const PINCH_MAX_STEP = 0.15; // clamp zoom change per frame so one noisy event can't jump

  // Mouse/pen keep pointer capture (prevents losing drags over iframes);
  // touch must NOT capture — it retargets/suppresses the second finger's
  // stream on several Chromium variants (Brave, DDG WebView) and causes jumps.
  function capturePointer(e) {
    if (e.pointerType === "touch") return;
    try { viewport.setPointerCapture(e.pointerId); } catch {}
  }

  function pinchDist() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function pinchMid() {
    const [a, b] = [...pointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  viewport.addEventListener("pointerdown", (e) => {
    if (!proj()) return;
    viewport.focus?.();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // second finger -> pinch-zoom, cancel single-finger drag
    if (pointers.size === 2) {
      if (drag && drag.moved) { store.touch(pid); store.save(); }
      drag = null;
      viewport.classList.remove("panning");
      // Cache the rect once: re-measuring per move injects URL-bar /
      // sticky-toolbar layout shifts straight into v.x/v.y as jitter.
      const rect = viewport.getBoundingClientRect();
      const d0 = pinchDist();
      const mid = pinchMid();
      const v = view();
      pinch = {
        dist: d0,
        zoom: v.zoom,
        // world point under midpoint stays pinned
        wx: (mid.x - rect.left - v.x) / v.zoom,
        wy: (mid.y - rect.top - v.y) / v.zoom,
        rect: { left: rect.left, top: rect.top },
        armed: d0 >= PINCH_MIN_DIST, // close-together starts stay parked until spread
        moved: false
      };
      // No pointer capture for the second finger (see capturePointer).
      return;
    }
    if (pointers.size > 2) return;
    const itemEl = e.target.closest(".citem");

    // link + pdf/md card buttons
    const lk = e.target.closest("[data-lk]");
    if (lk && itemEl) {
      e.stopPropagation();
      const it = proj().items.find((x) => x.id === itemEl.dataset.id);
      if (it && it.url) {
        if (lk.dataset.lk === "open") window.open(it.url, "_blank", "noopener");
        else if (lk.dataset.lk === "retry") refreshLinkPreview(it, true);
        else embeds.openPreview(it.url);
      }
      return;
    }
    const pdfBtn = e.target.closest("[data-pdf]");
    if (pdfBtn && itemEl) {
      e.stopPropagation();
      const it = proj().items.find((x) => x.id === itemEl.dataset.id);
      if (!it) return;
      if (pdfBtn.dataset.pdf === "save") savePdfItem(it);
      else openPdfItem(it);
      return;
    }
    const mdBtn = e.target.closest("[data-md]");
    if (mdBtn && itemEl) {
      e.stopPropagation();
      const it = proj().items.find((x) => x.id === itemEl.dataset.id);
      if (!it) return;
      saveMdItem(it);
      return;
    }
    // Wire hit (connector / stroke in the SVG overlay). Pen draws over
    // wires, so it skips this and falls through to the pen branches.
    const wire = e.target.closest ? e.target.closest("[data-wire]") : null;
    if (wire && tool !== "pen") {
      e.stopPropagation();
      const it = proj().items.find((x) => x.id === wire.dataset.wire);
      if (!it) return;
      if (tool === "eraser" && it.type === "stroke") {
        deleteItem(it.id);
        return;
      }
      if (tool === "connect") {
        // Tapping a wire while connecting does nothing (endpoints only).
        selectedId = it.id;
        renderWires(); renderLayers(); renderInspector();
        return;
      }
      selectedId = it.id;
      renderWires(); renderLayers(); renderInspector();
      if (tool === "select" && it.type === "stroke") {
        drag = { mode: "stroke", id: it.id, sx: e.clientX, sy: e.clientY, zoom: view().zoom, moved: false,
                 pts: (it.points || []).map(([px, py]) => [px, py]) };
        capturePointer(e);
      }
      return;
    }

    if (e.button === 1 || tool === "pan" || spaceHeld) {
      drag = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y };
      viewport.classList.add("panning");
      capturePointer(e);
      return;
    }

    if (itemEl) {
      const id = itemEl.dataset.id;
      const it = proj().items.find((x) => x.id === id);
      // Connect tool: first click arms the source, second click commits.
      if (tool === "connect" && it && it.type !== "connector" && it.type !== "stroke") {
        const wpt0 = screenToWorld(e.clientX, e.clientY);
        const side = nearestSide(it, wpt0.x, wpt0.y);
        if (!connFrom || connFrom.id === it.id) {
          connFrom = { id: it.id, side };
          signalToast("NOW TAP THE TARGET ITEM");
        } else {
          const from = connFrom;
          connFrom = null;
          mutate(() => {
            const c = { id: store.uid(), type: "connector", from, to: { id: it.id, side }, color: "", width: 3, arrow: "end", visible: true };
            proj().items.push(c);
            selectedId = c.id;
          });
          setTool("select");
          return;
        }
        selectedId = it.id;
        renderWires(); renderLayers(); renderInspector();
        return;
      }
      const alreadySelected = selectedId === id;
      // Pen draws over everything, including on top of items.
      if (tool === "pen") {
        const wpt1 = screenToWorld(e.clientX, e.clientY);
        drag = { mode: "pen", pts: [[wpt1.x, wpt1.y]], moved: true };
        capturePointer(e);
        return;
      }
      if (tool === "eraser") { deselectOnly(); return; }
      // PDF preview stays interactive (scroll/zoom in place): the bar +
      // fallback line are the drag handles, so presses starting on the
      // preview body select only and never start a move-drag.
      if (it && it.type === "pdf" && e.target.closest && e.target.closest(".pdf-body")) {
        if (!alreadySelected) {
          if (e.pointerType === "touch") markSelectedTouch(itemEl);
          else selectOnly(id, itemEl);
        }
        return;
      }
      // resize handle — capture geometry, don't rebuild DOM mid-gesture
      if (e.target.classList.contains("resize")) {
        if (!alreadySelected) {
          if (e.pointerType === "touch") markSelectedTouch(itemEl);
          else selectOnly(id, itemEl);
        }
        drag = { mode: "resize", id, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h, zoom: view().zoom };
        capturePointer(e);
        return;
      }
      // note text: mouse/pen keep click-again-to-type; touch uses double-tap
      // so a single-finger press can always start a drag on mobile
      if (it.type === "note" && e.target.classList.contains("note-body")) {
        if (alreadySelected && tool === "select" && e.pointerType !== "touch") {
          enterNoteEdit(e.target);
          return;
        }
        selectedId = id;
        if (e.pointerType === "touch") {
          if (!alreadySelected) markSelectedTouch(itemEl);
          else { renderLayers(); renderInspector(); }
        } else if (!alreadySelected) {
          selectOnly(id, itemEl);
        }
        if (tool === "select") {
          drag = { mode: "move", id, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, zoom: view().zoom };
          capturePointer(e);
        }
        return;
      }
      if (tool === "select") {
        if (!alreadySelected) {
          if (e.pointerType === "touch") markSelectedTouch(itemEl);
          else selectOnly(id, itemEl);
        }
        drag = { mode: "move", id, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, zoom: view().zoom };
        capturePointer(e);
      } else {
        if (!alreadySelected) {
          if (e.pointerType === "touch") markSelectedTouch(itemEl);
          else selectOnly(id, itemEl);
        }
      }
      return;
    }

    // background click → place or deselect
    const wpt = screenToWorld(e.clientX, e.clientY);
    if (tool === "note") placeNote(wpt);
    else if (tool === "rect") { pendingPoint = wpt; openSectionDialog(); }
    else if (tool === "image") { pendingPoint = wpt; openImageDialog(); }
    else if (tool === "link") { pendingPoint = wpt; openLinkDialog(); }
    else if (tool === "pdf") { pendingPoint = wpt; openPdfDialog(); }
    else if (tool === "md") { pendingPoint = wpt; openMdDialog(); }
    else if (tool === "connect") {
      // Tapping empty canvas cancels a pending connection.
      if (connFrom) { connFrom = null; renderWires(); }
      deselectOnly();
    }
    else if (tool === "pen") {
      drag = { mode: "pen", pts: [[wpt.x, wpt.y]], moved: true };
      capturePointer(e);
      return;
    }
    else if (tool === "eraser") deselectOnly();
    else deselectOnly();

    // bg-pan with left button when select tool? No — but start marquee-less pan on drag
    if (tool === "select" && !itemEl) {
      drag = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: view().x, vy: view().y, maybe: true };
      capturePointer(e);
    }
  });

  // One rAF-paced pinch application per frame: the two fingers' pointermove
  // events interleave (each updates one finger), so applying per-event re-solves
  // from half-updated positions and reads as jitter. Coalesce to latest pair.
  function queuePinchFrame() {
    if (pinchQueued) return;
    pinchQueued = true;
    pinchFrame = requestAnimationFrame(applyPinchFrame);
  }
  function applyPinchFrame() {
    pinchQueued = false;
    pinchFrame = 0;
    if (!pinch || pointers.size !== 2 || !proj()) return;
    const curDist = pinchDist();
    // FALLBACK: ignore invalid frames instead of applying them. A dropped
    // frame is invisible; a NaN/zero frame corrupts zoom+pan and reads as a jump.
    if (!Number.isFinite(curDist) || curDist <= 0) return;
    // Park close-together starts until fingers spread past the noise floor.
    if (!pinch.armed) {
      if (curDist < PINCH_MIN_DIST) return;
      const mid0 = pinchMid();
      const v0 = view();
      pinch.dist = curDist;
      pinch.zoom = v0.zoom;
      pinch.wx = (mid0.x - pinch.rect.left - v0.x) / v0.zoom;
      pinch.wy = (mid0.y - pinch.rect.top - v0.y) / v0.zoom;
      pinch.armed = true;
      return;
    }
    if (!Number.isFinite(pinch.dist) || pinch.dist <= 0) { pinch.dist = curDist; return; }
    let factor = curDist / pinch.dist;
    if (!Number.isFinite(factor) || factor <= 0) return; // fallback: drop frame
    // Clamp per-frame delta: small stable steps instead of one noise-amplified jump.
    factor = Math.min(1 + PINCH_MAX_STEP, Math.max(1 - PINCH_MAX_STEP, factor));
    const v = view();
    const newZoom = Math.min(4, Math.max(0.25, pinch.zoom * factor));
    if (!Number.isFinite(newZoom)) return; // fallback: drop frame
    const mid = pinchMid();
    const nx = (mid.x - pinch.rect.left) - pinch.wx * newZoom;
    const ny = (mid.y - pinch.rect.top) - pinch.wy * newZoom;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return; // fallback: drop frame
    v.zoom = newZoom;
    v.x = nx;
    v.y = ny;
    // Re-base so the next frame is a small relative step from here.
    pinch.dist = curDist;
    pinch.zoom = newZoom;
    pinch.moved = true;
    applyView();
  }

  // Window-level: with no touch capture, moves target the original child
  // (.citem/.note-body), which would never reach a viewport-only listener.
  window.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    else if (!(e.target && viewport.contains(e.target))) return;
    // pinch-zoom: coalesced, clamped, NaN-guarded (see applyPinchFrame)
    if (pinch && pointers.size === 2) {
      queuePinchFrame();
      return;
    }
    if (!drag) {
      // hover coords only when actually over the canvas
      if (e.target && viewport.contains(e.target)) {
        const wpt = screenToWorld(e.clientX, e.clientY);
        const coordEl = document.getElementById("st-coords");
        if (coordEl) coordEl.textContent = `X ${Math.round(wpt.x)} · Y ${Math.round(wpt.y)}`;
      }
      // Connector rubber band follows the cursor while armed.
      if (connFrom && tool === "connect" && !pinch && proj()) {
        const p = proj();
        const a = p.items.find((x) => x.id === connFrom.id);
        if (a && e.target && viewport.contains(e.target)) {
          const wpt = screenToWorld(e.clientX, e.clientY);
          const s = anchorOf(a, connFrom.side);
          renderWires({ d: `M${s.x},${s.y}L${Math.round(wpt.x)},${Math.round(wpt.y)}`, color: TINT_STROKE[""], width: 2 });
        }
      }
      return;
    }
    // touch slop: ignore sub-8px jitter so taps don't drift objects
    if (e.pointerType === "touch" && !drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < TOUCH_SLOP) return;
    }
    if (e.target && viewport.contains(e.target)) {
      const wpt = screenToWorld(e.clientX, e.clientY);
      const coordEl = document.getElementById("st-coords");
      if (coordEl) coordEl.textContent = `X ${Math.round(wpt.x)} · Y ${Math.round(wpt.y)}`;
    }
    if (drag.mode === "pan") {
      view().x = drag.vx + (e.clientX - drag.sx);
      view().y = drag.vy + (e.clientY - drag.sy);
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) >= TOUCH_SLOP) drag.moved = true;
      applyView();
    } else if (drag.mode === "move") {
      const p = proj();
      const it = p.items.find((x) => x.id === drag.id);
      if (!it) return;
      const rawX = drag.ox + (e.clientX - drag.sx) / drag.zoom;
      const rawY = drag.oy + (e.clientY - drag.sy) / drag.zoom;
      const s = snapPoint(rawX, rawY, it.w, it.h, it.id);
      const oldX = it.x, oldY = it.y;
      it.x = s.x;
      it.y = s.y;
      const dx = it.x - oldX, dy = it.y - oldY;
      drag.moved = true;
      const el = itemsEl.querySelector(`[data-id="${it.id}"]`);
      if (el) { el.style.left = it.x + "px"; el.style.top = it.y + "px"; }
      if (it.type === "rect" && (dx || dy)) {
        for (const cid of containedIds(it.id, oldX, oldY, it.w, it.h)) {
          const c = p.items.find((x) => x.id === cid);
          if (!c) continue;
          c.x += dx; c.y += dy;
          const cel = itemsEl.querySelector(`[data-id="${cid}"]`);
          if (cel) { cel.style.left = c.x + "px"; cel.style.top = c.y + "px"; }
        }
      }
      markSnapTarget(s.targetId);
      renderWires();
    } else if (drag.mode === "resize") {
      const p = proj();
      const it = p.items.find((x) => x.id === drag.id);
      if (!it) return;
      it.w = Math.max(60, Math.round(drag.w + (e.clientX - drag.sx) / drag.zoom));
      it.h = Math.max(40, Math.round(drag.h + (e.clientY - drag.sy) / drag.zoom));
      drag.moved = true;
      const el = itemsEl.querySelector(`[data-id="${it.id}"]`);
      if (el) { el.style.width = it.w + "px"; el.style.height = it.h + "px"; }
      renderWires();
    } else if (drag.mode === "pen") {
      const wpt = screenToWorld(e.clientX, e.clientY);
      const pts = drag.pts;
      const last = pts[pts.length - 1];
      // 4px world-space filter keeps paths smooth without point spam.
      if (Math.hypot(wpt.x - last[0], wpt.y - last[1]) >= 4) {
        pts.push([Math.round(wpt.x), Math.round(wpt.y)]);
        renderWires({ d: strokePath(pts), color: TINT_STROKE[""], width: 3 });
      }
    } else if (drag.mode === "stroke") {
      const p = proj();
      const it = p && p.items.find((x) => x.id === drag.id);
      if (!it) return;
      const dx = Math.round((e.clientX - drag.sx) / drag.zoom);
      const dy = Math.round((e.clientY - drag.sy) / drag.zoom);
      drag.moved = true;
      it.points = drag.pts.map(([px, py]) => [px + dx, py + dy]);
      renderWires();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        if (pinch.moved) { store.touch(pid); store.save(); }
        pinch = null;
        // drop any coalesced frame for the finished gesture
        pinchQueued = false;
        if (pinchFrame) { cancelAnimationFrame(pinchFrame); pinchFrame = 0; }
        // survivor finger keeps the gesture alive as a pan instead of going dead
        const rest = [...pointers.values()][0];
        if (rest && e.pointerType === "touch" && proj()) {
          drag = { mode: "pan", sx: rest.x, sy: rest.y, vx: view().x, vy: view().y, maybe: true };
          return;
        }
      }
      // don't run tap logic for pinch fingers
      if (e.pointerType === "touch") { drag = null; viewport.classList.remove("panning"); return; }
    }
    // touch selection deferred mid-gesture: flush first so tap logic below
    // hits the live node, never a detached one
    if (e.pointerType === "touch" && touchSelDirty && proj()) {
      touchSelDirty = false;
      renderItems();
      renderWires();
    }
    if (drag && drag.mode === "pen") {
      // Commit the stroke (pen stays armed for the next one).
      const pts = drag.pts;
      drag = null;
      viewport.classList.remove("panning");
      if (pts && pts.length >= 3) {
        mutate(() => {
          const it = { id: store.uid(), type: "stroke", points: pts, color: "", width: 3, visible: true };
          proj().items.push(it);
          selectedId = it.id;
        });
      } else {
        renderWires();
      }
      return;
    }
    if (drag && drag.mode === "stroke") {
      if (drag.moved) { store.touch(pid); store.save(); }
      renderLayers(); renderInspector();
      drag = null;
      viewport.classList.remove("panning");
      return;
    }
    if (drag && (drag.mode === "move" || drag.mode === "resize" || drag.mode === "pan")) {
      // taps (no move) don't need a save; bg taps already deselected
      if (drag.moved || drag.mode !== "pan") {
        if (drag.moved || drag.mode !== "pan" || !drag.maybe) { store.touch(pid); store.save(); }
        if (drag.mode !== "pan") renderLayers(), renderInspector();
      } else if (drag.mode === "pan" && !drag.maybe) {
        store.touch(pid); store.save();
      }
      // double-tap background on touch: zoom in a step
      if (e.type === "pointerup" && e.pointerType === "touch" && !drag.moved && drag.mode === "pan" && tool === "select") {
        const now = Date.now();
        if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          zoomAt(e.clientX, e.clientY, 1.25);
          lastTap.t = 0;
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      // double-tap a note on touch: enter typing (single taps only select/drag)
      if (e.type === "pointerup" && e.pointerType === "touch" && !drag.moved && drag.mode === "move" && tool === "select") {
        const p = proj();
        const tapped = p && p.items.find((x) => x.id === drag.id);
        if (tapped && tapped.type === "note") {
          const now = Date.now();
          if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
            const fresh = itemsEl.querySelector(`[data-id="${tapped.id}"] .note-body`);
            if (fresh) enterNoteEdit(fresh);
            lastTap.t = 0;
          } else {
            lastTap = { t: now, x: e.clientX, y: e.clientY };
          }
        }
      }
    } else if (e.type === "pointerup" && e.pointerType === "touch" && e.target && e.target.closest) {
      // double-tap note body on touch with no drag active (place tools):
      // re-query the live node — pointerdown may have rebuilt it since
      const stale = e.target.closest(".note-body");
      const holder = stale && stale.closest(".citem");
      const body = holder && itemsEl.querySelector(`[data-id="${holder.dataset.id}"] .note-body`);
      if (body) {
        const now = Date.now();
        if (now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          enterNoteEdit(body);
          lastTap.t = 0;
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    }
    itemsEl.querySelectorAll(".snap-target").forEach((el) => el.classList.remove("snap-target"));
    drag = null;
    viewport.classList.remove("panning");
  }
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);

  viewport.addEventListener("wheel", (e) => {
    if (!proj()) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    } else {
      view().x -= e.deltaX;
      view().y -= e.deltaY;
      applyView();
      store.save();
    }
  }, { passive: false });

  // note editing: single shared entry so click, dblclick and Enter all behave
  function enterNoteEdit(body) {
    if (!body || body.contentEditable === "true") return;
    const itemEl = body.closest(".citem");
    editingId = itemEl ? itemEl.dataset.id : null;
    body.contentEditable = "true";
    body.focus();
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function exitNoteEdit(body, save) {
    if (!body || body.contentEditable !== "true") return;
    body.contentEditable = "false";
    editingId = null;
    if (!save) return;
    const itemEl = body.closest(".citem");
    const p = proj();
    const it = p && p.items.find((x) => x.id === itemEl.dataset.id);
    if (it && it.text !== body.textContent) {
      it.text = body.textContent;
      store.touch(pid);
      store.save();
      renderLayers();
      const ta = document.querySelector('#inspector [data-f="text"]');
      if (ta) ta.value = it.text;
    }
  }
  itemsEl.addEventListener("dblclick", (e) => {
    const body = e.target.closest(".note-body");
    if (body) enterNoteEdit(body);
  });
  // live-save while typing without rebuilding the canvas
  itemsEl.addEventListener("input", (e) => {
    const body = e.target.closest?.(".note-body");
    if (!body) return;
    const itemEl = body.closest(".citem");
    const p = proj();
    const it = p && p.items.find((x) => x.id === itemEl.dataset.id);
    if (it) { it.text = body.textContent; store.touch(pid); store.save(); }
  });
  itemsEl.addEventListener("focusout", (e) => {
    const body = e.target.closest?.(".note-body");
    if (body) exitNoteEdit(body, true);
  });

  /* ---------- placement ---------- */
  function placeNote(wpt) {
    const s = snapPoint(wpt.x, wpt.y, 280, 140, null);
    mutate(() => {
      const it = { id: store.uid(), type: "note", x: s.x, y: s.y, w: 280, h: 140, text: "NEW NOTE", visible: true };
      proj().items.push(it);
      selectedId = it.id;
    });
    setTool("select");
    if (s.targetId) flashSnap(s.targetId);
  }
  // Smallest visible section containing a point (for nested placement).
  function containerAt(x, y, ignoreId) {
    const p = proj();
    if (!p) return null;
    let best = null, bestArea = Infinity;
    for (const it of p.items) {
      if (it.type !== "rect" || it.id === ignoreId || it.visible === false) continue;
      if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
        const area = it.w * it.h;
        if (area < bestArea) { bestArea = area; best = it; }
      }
    }
    return best;
  }
  // One-time rescue for boards saved while new sections landed behind their
  // parents: lift buried inner sections directly above their container.
  // Only fixes containment inversions; all other manual order is kept.
  function restackProject(p) {
    if (!p || !Array.isArray(p.items)) return false;
    let changed = false;
    for (let pass = 0; pass < 10; pass++) {
      let moved = false;
      const items = p.items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type !== "rect" || it.visible === false) continue;
        let parentIdx = -1, parentArea = Infinity;
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          const s = items[j];
          if (s.type !== "rect" || s.visible === false) continue;
          if (it.x >= s.x - NEST_TOL && it.y >= s.y - NEST_TOL &&
              it.x + it.w <= s.x + s.w + NEST_TOL && it.y + it.h <= s.y + s.h + NEST_TOL) {
            const area = s.w * s.h;
            if (area < parentArea) { parentArea = area; parentIdx = j; }
          }
        }
        if (parentIdx !== -1 && parentIdx > i) {
          items.splice(parentIdx + 1, 0, it);
          items.splice(i, 1);
          changed = moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return changed;
  }
  function placeSection(wpt, label) {
    // Dropped inside a section: stay where clicked but fit fully within the
    // parent (so nesting depth + shade always apply), and paint directly
    // above the parent; in open canvas keep edge-snap + behind-cards.
    const parent = containerAt(wpt.x, wpt.y, null);
    let s;
    if (parent) {
      const pad = 8;
      const nx = Math.min(Math.max(Math.round(wpt.x), parent.x + pad), parent.x + parent.w - pad - 340);
      const ny = Math.min(Math.max(Math.round(wpt.y), parent.y + pad), parent.y + parent.h - pad - 220);
      s = { x: nx, y: ny, targetId: parent.id };
    } else {
      s = snapPoint(wpt.x, wpt.y, 340, 220, null);
    }
    mutate(() => {
      const it = { id: store.uid(), type: "rect", x: s.x, y: s.y, w: 340, h: 220, color: "", label: String(label || "New section").slice(0, 60), visible: true };
      const items = proj().items;
      if (parent) {
        const pi = items.findIndex((x) => x.id === parent.id);
        items.splice(pi === -1 ? items.length : pi + 1, 0, it);
      } else {
        let li = -1;
        for (let i = 0; i < items.length; i++) if (items[i].type === "rect") li = i;
        items.splice(li + 1, 0, it);
      }
      selectedId = it.id;
    });
    setTool("select");
    if (s.targetId) flashSnap(s.targetId);
  }
  function placeImage(src) {
    const s = snapPoint(pendingPoint.x, pendingPoint.y, 320, 220, null);
    mutate(() => {
      const it = { id: store.uid(), type: "image", x: s.x, y: s.y, w: 320, h: 220, src, visible: true };
      proj().items.push(it);
      selectedId = it.id;
    });
    setTool("select");
    if (s.targetId) flashSnap(s.targetId);
  }
  function placeLink(url, title) {
    const s = snapPoint(pendingPoint.x, pendingPoint.y, 300, 230, null);
    const it = { id: store.uid(), type: "link", x: s.x, y: s.y, w: 300, h: 230, url, title: title || "", description: "", image: "", fetchState: "loading", visible: true };
    mutate(() => { proj().items.push(it); selectedId = it.id; });
    setTool("select");
    if (s.targetId) flashSnap(s.targetId);
    refreshLinkPreview(it, true);
  }
  const PDF_MAX_BYTES = 100 * 1024 * 1024;
  // File-backed upload: bytes stream to /api/files (progress via XHR —
  // fetch has no upload progress). Server caps at 100MB / ~5GB total.
  function uploadPdfFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const id = (store.uid() + Date.now().toString(36)).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || ("f" + Date.now().toString(36));
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", "/api/files/" + id);
      xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name || "document.pdf"));
      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) { try { onProgress(Math.round((e.loaded / e.total) * 100)); } catch {} }
        };
      }
      xhr.onload = () => {
        if (xhr.status === 200) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error("bad-response")); }
        }
        else if (xhr.status === 413) reject(new Error("too-large"));
        else reject(new Error("http " + xhr.status));
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.onabort = () => reject(new Error("aborted"));
      xhr.send(file);
    });
  }
  function placePdf(src, name, size) {
    const s = snapPoint(pendingPoint.x, pendingPoint.y, 340, 440, null);
    mutate(() => {
      const it = { id: store.uid(), type: "pdf", x: s.x, y: s.y, w: 340, h: 440, src, name: (name || "PDF").slice(0, 120), size: (typeof size === "number" && size >= 0) ? Math.round(size) : undefined, visible: true };
      proj().items.push(it);
      selectedId = it.id;
    });
    setTool("select");
    if (s.targetId) flashSnap(s.targetId);
  }
  function placeMd(text, name) {
    const s = snapPoint(pendingPoint.x, pendingPoint.y, 320, 240, null);
    mutate(() => {
      const it = { id: store.uid(), type: "md", x: s.x, y: s.y, w: 320, h: 240, text: text || "# NEW DOC", name: String(name || "").slice(0, 120) || undefined, visible: true };
      if (!it.name) delete it.name;
      proj().items.push(it);
      selectedId = it.id;
    });
    setTool("select");
    if (s.targetId) flashSnap(s.targetId);
  }

  /* dialogs */
  const dlgLink = document.getElementById("dlg-link");
  const dlgImage = document.getElementById("dlg-image");
  const dlgPdf = document.getElementById("dlg-pdf");
  const dlgMd = document.getElementById("dlg-md");
  const dlgSection = document.getElementById("dlg-section");
  function openLinkDialog() {
    document.getElementById("link-url").value = "";
    document.getElementById("link-title").value = "";
    dlgLink.showModal();
    setTimeout(() => document.getElementById("link-url").focus(), 50);
  }
  function openImageDialog() {
    document.getElementById("img-url").value = "";
    document.getElementById("img-file").value = "";
    dlgImage.showModal();
  }
  function openPdfDialog() {
    if (!dlgPdf) return;
    document.getElementById("pdf-url").value = "";
    document.getElementById("pdf-file").value = "";
    dlgPdf.showModal();
  }
  function openMdDialog() {
    if (!dlgMd) return;
    document.getElementById("md-text").value = "";
    document.getElementById("md-file").value = "";
    document.getElementById("md-file").dataset.name = "";
    dlgMd.showModal();
    setTimeout(() => document.getElementById("md-text").focus(), 50);
  }
  function openSectionDialog() {
    if (!dlgSection) { placeSection(pendingPoint, "New section"); return; }
    document.getElementById("section-label").value = "";
    dlgSection.showModal();
    setTimeout(() => document.getElementById("section-label").focus(), 50);
  }
  document.getElementById("section-label").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("dlg-section-ok").click();
  });
  document.getElementById("dlg-link-cancel").addEventListener("click", () => dlgLink.close());
  document.getElementById("dlg-link-ok").addEventListener("click", () => {
    let url = document.getElementById("link-url").value.trim();
    const title = document.getElementById("link-title").value.trim();
    if (!url) { signalToast("URL REQUIRED"); return; }
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    dlgLink.close();
    placeLink(url, title);
  });
  document.getElementById("dlg-section-cancel").addEventListener("click", () => { dlgSection.close(); setTool("select"); });
  document.getElementById("dlg-section-ok").addEventListener("click", () => {
    const label = document.getElementById("section-label").value.trim() || "New section";
    dlgSection.close();
    placeSection(pendingPoint, label);
  });
  document.getElementById("dlg-image-cancel").addEventListener("click", () => dlgImage.close());
  document.getElementById("dlg-image-ok").addEventListener("click", async () => {
    const file = document.getElementById("img-file").files[0];
    const url = document.getElementById("img-url").value.trim();
    try {
      if (file) {
        const dataUrl = await embeds.fileToDataURL(file);
        dlgImage.close();
        placeImage(dataUrl);
      } else if (url) {
        dlgImage.close();
        placeImage(url);
      } else signalToast("PICK A FILE OR PASTE URL");
    } catch { signalToast("INPUT CORRUPTED — IMAGE FAILED"); }
  });
  document.getElementById("dlg-pdf-cancel").addEventListener("click", () => dlgPdf.close());
  document.getElementById("dlg-pdf-ok").addEventListener("click", async () => {
    const file = document.getElementById("pdf-file").files[0];
    let url = document.getElementById("pdf-url").value.trim();
    const okBtn = document.getElementById("dlg-pdf-ok");
    try {
      if (file) {
        if (file.size > PDF_MAX_BYTES) { signalToast("PDF TOO LARGE — MAX 100MB"); return; }
        okBtn.disabled = true;
        okBtn.textContent = "UPLOADING 0%";
        const res = await uploadPdfFile(file, (pct) => { okBtn.textContent = "UPLOADING " + pct + "%"; });
        okBtn.disabled = false;
        okBtn.textContent = "PLACE";
        dlgPdf.close();
        placePdf(res.url, file.name, file.size);
      } else if (url) {
        if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        dlgPdf.close();
        placePdf(url, url.split("/").pop() || "PDF");
      } else signalToast("PICK A FILE OR PASTE URL");
    } catch (err) {
      okBtn.disabled = false;
      okBtn.textContent = "PLACE";
      signalToast(err && err.message === "too-large" ? "PDF TOO LARGE — MAX 100MB" : "UPLOAD FAILED — TRY AGAIN");
    }
  });
  document.getElementById("dlg-md-cancel").addEventListener("click", () => dlgMd.close());
  document.getElementById("md-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      document.getElementById("md-text").value = await embeds.readTextFile(file);
      e.target.dataset.name = file.name || "";
    } catch { signalToast("INPUT CORRUPTED — MD FAILED"); }
  });
  document.getElementById("dlg-md-ok").addEventListener("click", () => {
    const text = document.getElementById("md-text").value;
    if (!text.trim()) { signalToast("MARKDOWN REQUIRED"); return; }
    const name = document.getElementById("md-file").dataset.name
      || document.getElementById("md-file").files[0]?.name || "";
    dlgMd.close();
    placeMd(text, name);
    document.getElementById("md-file").dataset.name = "";
  });

  // drag-drop images + PDFs + markdown onto canvas
  viewport.addEventListener("dragover", (e) => e.preventDefault());
  viewport.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!proj()) return;
    const wpt = screenToWorld(e.clientX, e.clientY);
    pendingPoint = wpt;
    const files = [...(e.dataTransfer.files || [])];
    const pdfFile = files.find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || ""));
    const mdFile = files.find((f) => /\.m(d|arkdown)$/i.test(f.name || "") || f.type === "text/markdown");
    const imgFile = files.find((f) => f.type.startsWith("image/"));
    try {
      if (pdfFile) {
        if (pdfFile.size > PDF_MAX_BYTES) { signalToast("PDF TOO LARGE — MAX 100MB"); return; }
        signalToast("UPLOADING PDF…");
        const res = await uploadPdfFile(pdfFile, null);
        placePdf(res.url, pdfFile.name, pdfFile.size);
        return;
      }
      if (mdFile) { placeMd(await embeds.readTextFile(mdFile), mdFile.name); return; }
      if (imgFile) { placeImage(await embeds.fileToDataURL(imgFile)); return; }
    } catch (err) { signalToast(err && err.message === "too-large" ? "PDF TOO LARGE — MAX 100MB" : "UPLOAD FAILED — TRY AGAIN"); return; }
    {
      const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      if (url && /^https?:\/\//.test(url.trim())) {
        if (/\.pdf(\?|$)/i.test(url)) placePdf(url.trim(), url.trim().split("/").pop());
        else if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)) placeImage(url.trim());
        else placeLink(url.trim(), "");
      }
    }
  });

  /* ---------- keyboard ---------- */
  window.addEventListener("keydown", (e) => {
    // Escape always exits note editing first, even from inside the text
    if (e.key === "Escape" && editingId) {
      const body = itemsEl.querySelector(`[data-id="${editingId}"] .note-body`);
      if (body) { e.preventDefault(); exitNoteEdit(body, true); body.blur(); return; }
    }
    if (e.key === " " && proj() && viewCanvas.classList.contains("active")) {
      if (/INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.target.isContentEditable) return; // typing inside a note: let the space through
      spaceHeld = true;
      e.preventDefault();
    }
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || e.target.isContentEditable) return;
    if (!viewCanvas.classList.contains("active") || !proj()) return;
    // commit an in-progress note edit before shortcuts act
    const activeBody = document.activeElement?.closest?.(".note-body");
    if (activeBody) exitNoteEdit(activeBody, true);
    const k = e.key.toLowerCase();
    if (k === "v") setTool("select");
    else if (k === "h") setTool("pan");
    else if (k === "n") setTool("note");
    else if (k === "i") setTool("image");
    else if (k === "l") setTool("link");
    else if (k === "p") setTool("pdf");
    else if (k === "m") setTool("md");
    else if (k === "r") setTool("rect");
    else if (k === "c" && !e.ctrlKey && !e.metaKey) setTool("connect");
    else if (k === "w" && !e.ctrlKey && !e.metaKey) setTool("pen");
    else if (k === "x" && !e.ctrlKey && !e.metaKey) setTool("eraser");
    else if (k === "f" && !e.ctrlKey && !e.metaKey) setFocus(!workspaceEl.classList.contains("focus"));
    else if (k === "enter" && selectedId) {
      const it = proj().items.find((x) => x.id === selectedId);
      if (it && it.type === "note") {
        const body = itemsEl.querySelector(`[data-id="${it.id}"] .note-body`);
        if (body) { e.preventDefault(); enterNoteEdit(body); return; }
      }
    }
    else if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k) && selectedId) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const it = proj().items.find((x) => x.id === selectedId);
      if (it && it.type !== "connector") mutate(() => {
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
        const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
          if (it.type === "rect" && (dx || dy)) {
            const carry = containedIds(it.id, it.x, it.y, it.w, it.h);
            it.x += dx; it.y += dy;
            const p = proj();
            for (const cid of carry) {
              const c = p.items.find((x) => x.id === cid);
              if (c) { c.x += dx; c.y += dy; }
            }
          } else if (it.type === "stroke") {
            it.points = (it.points || []).map(([px, py]) => [px + dx, py + dy]);
          } else {
            it.x += dx; it.y += dy;
          }
      });
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      e.preventDefault();
      deleteItem(selectedId);
    } else if (k === "d" && (e.ctrlKey || e.metaKey) && selectedId) {
      e.preventDefault();
      duplicateItem(selectedId);
    } else if (e.key === "Escape") {
      if (connFrom) { connFrom = null; renderWires(); setTool("select"); return; }
      if (selectedId) deselectOnly();
      else back();
    } else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const v = view(); v.zoom = 1; applyView();
    }
  });
  window.addEventListener("keyup", (e) => { if (e.key === " ") spaceHeld = false; });

  window.SignalCanvas = { open, back, renderAll };
})();
