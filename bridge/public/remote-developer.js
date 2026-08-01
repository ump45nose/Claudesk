(() => {
  "use strict";

  const params = new URLSearchParams(globalThis.location.search);
  const kind = params.get("kind");
  const artifactsView = params.get("view") === "artifacts";
  const watchArtifacts = params.get("watch") === "1";
  const state = document.getElementById("state");
  const title = document.getElementById("title");
  const filePanel = document.getElementById("file-panel");
  const artifactPanel = document.getElementById("artifact-panel");
  const editor = document.getElementById("editor");
  const save = document.getElementById("save");
  const reloadMcp = document.getElementById("reload-mcp");
  const fileMeta = document.getElementById("file-meta");
  const artifacts = document.getElementById("artifacts");
  let currentFile = null;
  let artifactWatchCount = 0;
  let artifactWatchTimer = null;

  const titles = {
    "app-config": "App configuration",
    "developer-config": "Developer configuration",
    "mcp-log": "MCP log",
  };

  function setState(message, error = false) {
    state.textContent = message;
    state.style.color = error ? "#b4442f" : "";
  }

  async function api(path, options) {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...options,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload.value;
  }

  function formatBytes(value) {
    if (!Number.isFinite(value)) return "";
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  }

  async function loadFile() {
    setState("Loading…");
    try {
      currentFile = await api(`/api/remote/developer/file?kind=${encodeURIComponent(kind)}`);
      editor.value = currentFile.content || "";
      editor.readOnly = currentFile.readOnly === true;
      save.hidden = currentFile.readOnly === true;
      reloadMcp.hidden = kind !== "app-config";
      const details = [
        currentFile.name,
        currentFile.exists === false ? "new file" : null,
        currentFile.truncated ? "showing the newest 2 MiB" : null,
        currentFile.mtimeMs ? new Date(currentFile.mtimeMs).toLocaleString() : null,
      ].filter(Boolean);
      fileMeta.textContent = details.join(" · ");
      setState(currentFile.readOnly ? "Read only" : "Ready");
    } catch (error) {
      editor.value = "";
      fileMeta.textContent = "";
      setState(error.message, true);
    }
  }

  async function saveFile() {
    save.disabled = true;
    setState("Saving…");
    try {
      currentFile = await api("/api/remote/developer/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, content: editor.value }),
      });
      editor.value = currentFile.content;
      setState("Saved");
    } catch (error) {
      setState(error.message, true);
    } finally {
      save.disabled = false;
    }
  }

  async function reloadMcpConfiguration() {
    reloadMcp.disabled = true;
    setState("Reloading MCP…");
    try {
      await api("/api/remote/main-menu-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reload-mcp-configuration" }),
      });
      setState("MCP configuration reloaded");
    } catch (error) {
      setState(error.message, true);
    } finally {
      reloadMcp.disabled = false;
    }
  }

  function downloadText() {
    const blob = new Blob([editor.value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = currentFile?.name || `${kind || "developer-file"}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function loadArtifacts() {
    setState("Loading…");
    artifacts.replaceChildren();
    try {
      const files = await api("/api/remote/developer/artifacts");
      if (!files.length) {
        const empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "No trace or heap files have been generated yet.";
        artifacts.append(empty);
      }
      for (const file of files) {
        const row = document.createElement("div");
        row.className = "artifact";
        const description = document.createElement("div");
        const name = document.createElement("div");
        name.className = "artifact-name";
        name.textContent = file.name;
        const detail = document.createElement("div");
        detail.className = "artifact-detail";
        detail.textContent = `${formatBytes(file.size)} · ${new Date(file.mtimeMs).toLocaleString()}`;
        description.append(name, detail);
        const download = document.createElement("a");
        download.className = "button-link secondary";
        download.textContent = "Download";
        download.href = `/api/remote/developer/artifact?name=${encodeURIComponent(file.name)}`;
        row.append(description, download);
        artifacts.append(row);
      }
      setState(`${files.length} file${files.length === 1 ? "" : "s"}`);
      if (watchArtifacts && artifactWatchCount < 60) {
        artifactWatchCount += 1;
        clearTimeout(artifactWatchTimer);
        artifactWatchTimer = setTimeout(loadArtifacts, 5000);
      }
    } catch (error) {
      setState(error.message, true);
    }
  }

  document.getElementById("back").addEventListener("click", () => {
    if (history.length > 1) history.back();
    else globalThis.location.assign("/");
  });
  document.getElementById("refresh").addEventListener("click", loadFile);
  document.getElementById("save").addEventListener("click", saveFile);
  document.getElementById("reload-mcp").addEventListener("click", reloadMcpConfiguration);
  document.getElementById("download-text").addEventListener("click", downloadText);
  document.getElementById("refresh-artifacts").addEventListener("click", loadArtifacts);

  if (artifactsView) {
    title.textContent = "Trace and heap files";
    artifactPanel.hidden = false;
    loadArtifacts();
  } else if (titles[kind]) {
    title.textContent = titles[kind];
    filePanel.hidden = false;
    loadFile();
  } else {
    setState("Unknown developer file", true);
  }
})();
