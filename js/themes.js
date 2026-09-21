/* Backup (export/import) — decoupled from component logic. Single dark theme. */
(function () {
  const store = window.SignalStore;

  document.getElementById("btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.data(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "signal-ideas-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("btn-import").addEventListener("click", () =>
    document.getElementById("import-file").click());
  document.getElementById("import-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const next = JSON.parse(r.result);
        if (!next.projects) throw new Error("bad file");
        store.replaceAll(next);
        window.dispatchEvent(new CustomEvent("signal:data"));
        signalToast("Import ok");
      } catch { signalToast("That file could not be read"); }
    };
    r.readAsText(f);
    e.target.value = "";
  });
})();
