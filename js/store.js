/* Store — shared server document with localStorage cache/fallback.
   Same device data everywhere: every save PUTs to /api/data (last-write-wins),
   every boot pulls the server copy if newer. Offline / file:// -> local only. */
(function () {
  const KEY = "signal-ideas-v1";
  const API = "/api/data";
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  function blank() {
    return { version: 1, theme: "light", projects: [] };
  }

  function seed() {
    const b = blank();
    const p = {
      id: uid(), label: "EXAMPLE // SOLAR DRONE",
      createdAt: Date.now(), updatedAt: Date.now(),
      view: { x: 0, y: 0, zoom: 1 },
      items: [
        { id: uid(), type: "note", x: 60, y: 60, w: 280, h: 140, text: "MOTOR TEST RIG\n— check thrust numbers\n— log RPM + prop size", visible: true },
        { id: uid(), type: "link", x: 380, y: 60, w: 300, h: 220, url: "https://penpot.app", title: "Penpot — reference", description: "Open-source design tool. Layout reference for this canvas.", image: "", visible: true, fetchState: "seed" },
        { id: uid(), type: "rect", x: 60, y: 240, w: 200, h: 120, label: "TEST ZONE", visible: true }
      ]
    };
    b.projects.push(p);
    return b;
  }

  function migrate(d) {
    if (!d || !Array.isArray(d.projects)) return blank();
    const out = Object.assign(blank(), d);
    // Legacy appearance values collapse to the light/dark system.
    out.theme = out.theme === "dark" ? "dark" : "light";
    delete out.density;
    out.projects.forEach((p) => {
      (p.items || []).forEach((it) => {
        if (it.type === "ellipse") it.type = "rect";
        if (it.type === "diamond") it.type = "rect";
        if (it.type === "pdf" && typeof it.src !== "string") it.src = "";
        if (it.type === "pdf" && typeof it.name !== "string") it.name = "PDF";
        if (it.type === "md" && typeof it.text !== "string") it.text = "# DOC";
        if (it.type === "md" && it.name !== undefined && typeof it.name !== "string") delete it.name;
        if (it.type === "note" && typeof it.color !== "string") it.color = "";
        if (it.type === "connector") {
          if (!it.from || typeof it.from.id !== "string") it.from = { id: "", side: "e" };
          if (!it.to || typeof it.to.id !== "string") it.to = { id: "", side: "w" };
          if (typeof it.color !== "string") it.color = "";
          if (!["none", "end", "both"].includes(it.arrow)) it.arrow = "end";
          it.width = [2, 3, 5].includes(Number(it.width)) ? Number(it.width) : 3;
        }
        if (it.type === "stroke") {
          if (!Array.isArray(it.points)) it.points = [];
          if (typeof it.color !== "string") it.color = "";
          it.width = [2, 3, 5, 8].includes(Number(it.width)) ? Number(it.width) : 3;
        }
      });
      if (!p.view) p.view = { x: 60, y: 40, zoom: 1 };
    });
    return out;
  }

  // cache shape: {rev, data}
  function loadCache() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { rev: 0, data: seed(), fresh: false };
      const c = JSON.parse(raw);
      // legacy cache (bare doc, pre-sync): adopt as rev 0
      if (c && Array.isArray(c.projects)) return { rev: 0, data: migrate(c), fresh: true };
      if (c && c.data) return { rev: c.rev | 0, data: migrate(c.data), fresh: true };
    } catch (e) {
      console.warn("store cache load failed", e);
    }
    return { rev: 0, data: seed(), fresh: false };
  }

  function persistCache() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ rev, data }));
    } catch (e) {
      toast("STORAGE FULL — EXPORT + REMOVE LARGE IMAGES");
      console.warn(e);
    }
  }

  let cache = loadCache();
  let rev = cache.rev;
  let data = cache.data;
  let t = null;
  let serverOk = false;
  const subs = new Set();

  function setSaveState(s) {
    const el = document.getElementById("canvas-save-state");
    if (el) el.textContent = s;
  }

  async function pushToServer() {
    try {
      const res = await fetch(API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base: rev, data })
      });
      if (!res.ok) throw new Error("http " + res.status);
      const json = await res.json();
      rev = json.rev | 0;
      serverOk = true;
      persistCache();
      setSaveState("Synced");
    } catch (e) {
      serverOk = false;
      setSaveState("Local only");
    }
    subs.forEach((fn) => fn(data));
  }

  function save(immediate) {
    setSaveState("Saving…");
    persistCache();
    if (immediate) { clearTimeout(t); pushToServer(); return; }
    clearTimeout(t);
    t = setTimeout(pushToServer, 500);
  }

  // boot: pull server copy if newer; push local seed up if server empty.
  // Always ends with signal:ready so first paint can swap skeletons
  // for real rows (dashboard listens; a timeout there is the backstop).
  function bootReady() {
    window.dispatchEvent(new CustomEvent("signal:ready"));
  }
  (async function pullOnBoot() {
    try {
      const res = await fetch(API, { headers: { "Accept": "application/json" } });
      if (!res.ok) throw new Error("http " + res.status);
      const srv = await res.json();
      serverOk = true;
      if (srv && srv.data && (srv.rev | 0) > rev) {
        rev = srv.rev | 0;
        data = migrate(srv.data);
        persistCache();
        setSaveState("Synced");
        window.dispatchEvent(new CustomEvent("signal:data"));
        subs.forEach((fn) => fn(data));
        signalToast("Synced from server");
      } else if (srv && !srv.data && data.projects.length) {
        save(true); // first device seeds the shared copy
      } else {
        setSaveState("Synced");
      }
    } catch (e) {
      serverOk = false;
      setSaveState("Local only");
    } finally {
      bootReady();
    }
  })();

  // converge while open in two tabs/devices: re-pull every 30s when idle
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(API);
      if (!res.ok) return;
      const srv = await res.json();
      if (srv && srv.data && (srv.rev | 0) > rev) {
        rev = srv.rev | 0;
        data = migrate(srv.data);
        persistCache();
        setSaveState("Synced");
        window.dispatchEvent(new CustomEvent("signal:data"));
        if (window.SignalCanvas) window.SignalCanvas.renderAll();
        signalToast("Synced from server");
      }
    } catch { /* stay local, no noise */ }
  }, 30000);

  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  window.SignalStore = {
    data: () => data,
    onChange(fn) { subs.add(fn); },
    save, toast, uid,
    serverOk: () => serverOk,
    setTheme(d) { data.theme = d === "dark" ? "dark" : "light"; save(); },
    createProject(label) {
      const p = { id: uid(), label: (label || "Untitled").slice(0, 60), createdAt: Date.now(), updatedAt: Date.now(), view: { x: 0, y: 0, zoom: 1 }, items: [] };
      data.projects.unshift(p);
      save(true);
      return p;
    },
    renameProject(id, label) {
      const p = data.projects.find((p) => p.id === id);
      if (p) { p.label = String(label || "Untitled").slice(0, 60); p.updatedAt = Date.now(); save(true); }
    },
    deleteProject(id) {
      data.projects = data.projects.filter((p) => p.id !== id);
      save(true);
    },
    getProject(id) { return data.projects.find((p) => p.id === id); },
    touch(id) {
      const p = data.projects.find((p) => p.id === id);
      if (p) { p.updatedAt = Date.now(); save(); }
    },
    replaceAll(next) { data = migrate(next); save(true); }
  };
  window.signalToast = toast;
})();
