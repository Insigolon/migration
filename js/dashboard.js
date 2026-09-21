/* Dashboard — project blocks: create / label / enter */
(function () {
  const store = window.SignalStore;
  const grid = document.getElementById("project-grid");
  const empty = document.getElementById("empty-state");
  const search = document.getElementById("search");
  const dlg = document.getElementById("dlg-project");
  const labelInput = document.getElementById("proj-label");
  let editingId = null;
  let filter = "";

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function render() {
    const projects = store.data().projects.filter((p) =>
      p.label.toLowerCase().includes(filter.toLowerCase()));
    document.getElementById("project-count").textContent = store.data().projects.length;
    document.getElementById("hero-total-objects").textContent =
      store.data().projects.reduce((n, p) => n + p.items.length, 0) + " objects";

    grid.innerHTML = "";
    empty.hidden = store.data().projects.length !== 0;

    // Pinned special entry: the standalone Semester Command Center page.
    // Hardcoded (not a stored project): it can't be deleted, renamed, or
    // replicated — this is the only special entry by design.
    if ("semester command center".includes(filter.toLowerCase())) {
      const sem = document.createElement("div");
      sem.className = "pblock";
      sem.tabIndex = 0;
      sem.setAttribute("role", "button");
      sem.setAttribute("aria-label", "Open Semester Command Center");
      sem.innerHTML = `
        <div>
          <div class="sig-0">Sem-CC · standalone page</div>
          <div class="pblock-title"></div>
          <div class="pblock-stats">Opens here</div>
        </div>
        <div class="pblock-foot">
          <span class="pblock-enter">Open →</span>
        </div>`;
      sem.querySelector(".pblock-title").textContent = "Semester Command Center";
      const go = () => { window.location.href = "/Sem-CC/"; };
      sem.addEventListener("click", go);
      sem.addEventListener("keydown", (e) => {
        if (e.key === "Enter") go();
      });
      grid.appendChild(sem);
    }

    projects.forEach((p) => {
      const el = document.createElement("div");
      el.className = "pblock";
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", "Enter project " + p.label);
      el.innerHTML = `
        <div>
          <div class="sig-0">Updated ${fmtDate(p.updatedAt)}</div>
          <div class="pblock-title"></div>
          <div class="pblock-stats">${p.items.length} objects</div>
        </div>
        <div class="pblock-foot">
          <span class="pblock-enter">Open →</span>
          <span class="pblock-actions">
            <button data-act="rename" title="Rename">Rename</button>
            <button data-act="del" title="Delete">Delete</button>
          </span>
        </div>`;
      el.querySelector(".pblock-title").textContent = p.label;
      el.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]");
        if (act) {
          e.stopPropagation();
          if (act.dataset.act === "del" && confirm(`Delete "${p.label}" and its ${p.items.length} objects?`)) {
            store.deleteProject(p.id);
            render();
          } else if (act.dataset.act === "rename") {
            openDialog(p.id, p.label);
          }
          return;
        }
        window.SignalCanvas.open(p.id);
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") window.SignalCanvas.open(p.id);
      });
      grid.appendChild(el);
    });
  }

  function openDialog(id, label) {
    editingId = id || null;
    document.getElementById("dlg-project-title").textContent = id ? "Rename project" : "New project";
    labelInput.value = label || "";
    dlg.showModal();
    setTimeout(() => labelInput.focus(), 50);
  }

  document.getElementById("btn-new").addEventListener("click", () => openDialog(null));
  document.getElementById("btn-new-2").addEventListener("click", () => openDialog(null));
  document.getElementById("dlg-project-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("dlg-project-ok").addEventListener("click", () => {
    const v = labelInput.value.trim();
    if (!v) { signalToast("LABEL REQUIRED"); return; }
    if (editingId) store.renameProject(editingId, v);
    else {
      const p = store.createProject(v);
      render();
      window.SignalCanvas.open(p.id);
    }
    dlg.close();
    render();
  });
  labelInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("dlg-project-ok").click();
  });

  search.addEventListener("input", () => { filter = search.value; render(); });
  window.addEventListener("signal:data", render);
  store.onChange(() => render());

  render();
})();
