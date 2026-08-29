(() => {
  "use strict";

  // Chromium exposes getRandomValues on an HTTP LAN origin, but reserves
  // randomUUID for secure contexts. The official ion-dist assumes the latter
  // exists during module initialization, so provide the same RFC 4122 v4
  // result without weakening randomness or modifying the official bundle.
  if (
    globalThis.crypto
    && typeof globalThis.crypto.getRandomValues === "function"
    && typeof globalThis.crypto.randomUUID !== "function"
  ) {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value() {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
        return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
      },
      writable: true,
    });
  }

  // SubtleCrypto is also restricted to secure contexts. The official UI only
  // needs digest during its common HTTP bootstrap path; keep the compatibility
  // surface deliberately narrow and execute the allowlisted hash on the NAS.
  if (globalThis.crypto && !globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, "subtle", {
      configurable: true,
      value: Object.freeze({
        async digest(algorithm, data) {
          const name = typeof algorithm === "string" ? algorithm : algorithm?.name;
          let bytes;
          if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
          } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else {
            throw new TypeError("digest data must be a BufferSource");
          }
          let binary = "";
          for (let offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
          }
          const result = await bridgeRequest(
            "/api/remote/crypto/digest",
            {
              algorithm: name,
              dataBase64: btoa(binary),
            },
            { retryable: true },
          );
          return Uint8Array.from(
            atob(result.dataBase64),
            (character) => character.charCodeAt(0),
          ).buffer;
        },
      }),
    });
  }

  const config = globalThis.__CLAUDE_REMOTE_BOOTSTRAP__;
  if (!config || config.transport !== "official-ion-dist-remote-ipc") return;

  const mobileClient = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || globalThis.navigator.userAgentData?.mobile === true
    || (
      /Macintosh/i.test(navigator.userAgent)
      && globalThis.navigator.maxTouchPoints > 1
    );
  if (mobileClient) document.documentElement.classList.add("claude-remote-mobile");
  if (config.codeActionsEnabled) document.documentElement.classList.add("claude-remote-code-enabled");

  // Claude Code persists its new-session target independently from the
  // Desktop IPC stores. A fresh browser otherwise starts with no folder and
  // the official picker treats the phone as the local machine, recursively
  // uploading the selected directory. Seed only an absent (or legacy browser
  // upload) selection with the NAS workspace. Preserve any other NAS path the
  // user has deliberately selected.
  try {
    const storageKey = "ccd-session-store";
    const rawValue = globalThis.localStorage.getItem(storageKey);
    const parsedValue = rawValue ? JSON.parse(rawValue) : { state: {}, version: 2 };
    const persisted = parsedValue && typeof parsedValue === "object"
      ? parsedValue
      : { state: {}, version: 2 };
    const state = persisted.state && typeof persisted.state === "object"
      ? { ...persisted.state }
      : {};
    const selectedFolder = typeof state.selectedFolder === "string"
      ? state.selectedFolder
      : "";
    const browserUploadSelection = selectedFolder.startsWith("/workspace/RemoteUploads/");
    let changed = false;

    if (!selectedFolder || browserUploadSelection) {
      state.worker = { type: "environment", id: "__local__" };
      state.selectedFolder = "/workspace";
      state.currentHostKey = "local";
      state.selectedRepos = [];
      changed = true;
    }

    const folderByHost = state.folderByHost && typeof state.folderByHost === "object"
      ? { ...state.folderByHost }
      : {};
    if (!folderByHost.local || browserUploadSelection) {
      folderByHost.local = state.selectedFolder || "/workspace";
      state.folderByHost = folderByHost;
      changed = true;
    }

    if (changed) {
      globalThis.localStorage.setItem(storageKey, JSON.stringify({
        ...persisted,
        state,
        version: 2,
      }));
    }
  } catch {
    // A blocked storage area must not prevent the official renderer booting.
    // The route-scoped FileSystem fallback below still resolves to /workspace.
  }

  // ion-dist deliberately identifies the Desktop runtime by requiring both a
  // Claude/<version> user-agent token and claudeAppBindings. A normal browser
  // has neither, so the official Cowork route reports disabled_by_enterprise
  // even when the account and Desktop boot feature both allow Cowork.
  //
  // Publish only the identity and binding lifecycle used by ion-dist. Native
  // capabilities still have to pass the exact server-side IPC allowlist.
  const desktopVersion = String(config.desktopRuntime?.version || "");
  if (!/^[0-9A-Za-z.+-]{1,64}$/.test(desktopVersion)) {
    throw new Error("Remote Desktop bridge received an invalid Desktop version");
  }
  const originalUserAgent = globalThis.navigator.userAgent;
  const desktopUserAgent = /claude(?:nest|gov)?\//i.test(originalUserAgent)
    ? originalUserAgent
    : `${originalUserAgent} Claude/${desktopVersion}`;
  Object.defineProperty(globalThis.navigator, "userAgent", {
    configurable: false,
    enumerable: true,
    get: () => desktopUserAgent,
  });

  const desktopBindings = new Map();
  Object.defineProperty(globalThis, "claudeAppBindings", {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      registerBinding(name, callback) {
        if (typeof name !== "string" || typeof callback !== "function") {
          throw new TypeError("Desktop binding requires a name and callback");
        }
        desktopBindings.set(name, callback);
      },
      unregisterBinding(name) {
        desktopBindings.delete(name);
      },
    }),
    writable: false,
  });

  // The native preload publishes these flags before ion-dist starts. Without
  // them, the official 3P route selector removes Chat and falls through from
  // Cowork to Claude Code. Relay only the Chat/Cowork flags selected by the
  // trusted Desktop wrapper so the browser follows the same official route.
  const desktopBootFeatures = Object.fromEntries(
    Object.entries(config.desktopBootFeatures || {}).map(([name, feature]) => [
      name,
      Object.freeze({ ...feature }),
    ]),
  );
  Object.defineProperty(globalThis, "desktopBootFeatures", {
    configurable: false,
    enumerable: false,
    value: Object.freeze(desktopBootFeatures),
    writable: false,
  });

  const listenerCallbacks = new Map();
  const latestTranscriptEvents = new Map();
  const storeCallbacks = new Map();
  const storeState = new Map(Object.entries(config.initialStores || {}));
  let events = null;
  let eventStreamKey = "";
  let eventStreamGeneration = 0;
  let eventReconnectTimer = null;
  let eventReconnectDelayMs = 1000;
  const undefinedSentinelKey = "__claudeRemoteUndefinedV1";

  function encodeIpcValue(value) {
    if (value === undefined) return { [undefinedSentinelKey]: true };
    if (Array.isArray(value)) return value.map(encodeIpcValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, encodeIpcValue(item)]),
      );
    }
    return value;
  }

  async function bridgeRequest(path, body, { retryable = false } = {}) {
    let lastError = null;
    const attempts = retryable ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) {
          const error = new Error(
            payload.error || `Remote Desktop bridge returned HTTP ${response.status}`,
          );
          error.bridgeRetryable = response.status === 408
            || response.status === 429
            || response.status >= 500;
          throw error;
        }
        return payload.value;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts && error?.bridgeRetryable !== false) {
          await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
        } else {
          break;
        }
      }
    }
    throw lastError || new Error("Remote Desktop bridge is unavailable");
  }

  function rememberChatSessions(value) {
    const sessions = Array.isArray(value) ? value : [value];
    const chatSessionIds = new Set(
      Array.isArray(config.chatSessionIds) ? config.chatSessionIds : [],
    );
    for (const session of sessions) {
      if (session?.sessionType === "chat" && typeof session.sessionId === "string") {
        chatSessionIds.add(session.sessionId);
      }
    }
    config.chatSessionIds = [...chatSessionIds];
  }

  async function invoke(surface, method, args) {
    const value = await bridgeRequest("/api/remote/ipc", {
      surface,
      method,
      args: encodeIpcValue(args),
      argsEncoding: "json-undefined-v1",
    });
    if (
      surface === "LocalAgentModeSessions"
      && (method === "getSession" || method === "getAll")
    ) {
      rememberChatSessions(value);
    }
    return value;
  }

  function invokeSettings(surface, method, args) {
    return bridgeRequest("/api/remote/settings", {
      surface,
      method,
      args: encodeIpcValue(args),
      argsEncoding: "json-undefined-v1",
    });
  }

  function beginRelaunchRecovery() {
    let sawDisconnect = false;
    const startedAt = Date.now();
    const poll = async () => {
      if (Date.now() - startedAt > 120000) return;
      try {
        const response = await fetch("/api/health", {
          cache: "no-store",
          credentials: "same-origin",
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
          sawDisconnect = true;
        } else if (sawDisconnect) {
          globalThis.location.assign("/");
          return;
        }
      } catch {
        sawDisconnect = true;
      }
      setTimeout(poll, 1000);
    };
    setTimeout(poll, 750);
  }

  function relaunchDesktop(args) {
    beginRelaunchRecovery();
    // A successful relaunch tears down the Electron process before its HTTP
    // response is guaranteed to complete. Fire exactly once and treat that
    // transport interruption as expected; retrying could restart it twice.
    void bridgeRequest(
      "/api/remote/settings",
      {
        surface: "Custom3pSetup",
        method: "relaunchApp",
        args: encodeIpcValue(args),
        argsEncoding: "json-undefined-v1",
      },
    ).catch(() => {});
    return Promise.resolve({ restarting: true });
  }

  function listenerKey(surface, method) {
    return `${surface}.${method}`;
  }

  function subscribe(surface, method, callback) {
    if (typeof callback !== "function") return () => {};
    const key = listenerKey(surface, method);
    const callbacks = listenerCallbacks.get(key) || new Set();
    callbacks.add(callback);
    listenerCallbacks.set(key, callbacks);
    if (surface === "LocalAgentModeSessions" && method === "onOnEvent") {
      const descriptor = eventStreamDescriptor();
      const sessionId = new URL(descriptor.url, globalThis.location.href)
        .searchParams.get("sessionId");
      const transcript = sessionId ? latestTranscriptEvents.get(sessionId) : null;
      if (transcript) {
        queueMicrotask(() => {
          if (!callbacks.has(callback)) return;
          try {
            callback({
              type: "transcript_loaded",
              sessionId: transcript.sessionId,
              messages: Array.isArray(transcript.value) ? transcript.value : [],
            });
            if (transcript.isRunning === false) {
              callback({ type: "close", sessionId: transcript.sessionId });
            }
          } catch {}
        });
      }
    }
    return () => callbacks.delete(callback);
  }

  function dispatch(surface, method, payload) {
    for (const callback of listenerCallbacks.get(listenerKey(surface, method)) || []) {
      try {
        callback(payload);
      } catch {}
    }
  }

  async function refreshStore(surface, store) {
    const key = `${surface}.${store}`;
    const value = await bridgeRequest(
      "/api/remote/store",
      { surface, store },
      { retryable: true },
    );
    const previous = storeState.get(key);
    storeState.set(key, value);
    if (JSON.stringify(previous) !== JSON.stringify(value)) {
      for (const callback of storeCallbacks.get(key) || []) {
        try {
          callback(value);
        } catch {}
      }
    }
    return value;
  }

  function makeStore(surface, store) {
    const key = `${surface}.${store}`;
    return {
      getState: () => refreshStore(surface, store),
      getStateSync: () => storeState.get(key) || {},
      onStateChange(callback) {
        if (typeof callback !== "function") return () => {};
        const callbacks = storeCallbacks.get(key) || new Set();
        callbacks.add(callback);
        storeCallbacks.set(key, callbacks);
        return () => callbacks.delete(callback);
      },
    };
  }

  function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const value = String(reader.result || "");
        const separator = value.indexOf(",");
        if (separator < 0) reject(new Error("Browser file encoding failed"));
        else resolve(value.slice(separator + 1));
      }, { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("Browser file read failed")), { once: true });
      reader.readAsDataURL(file);
    });
  }

  function chooseBrowserFiles({ directory = false, multiple = true } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = multiple;
      if (directory) {
        input.setAttribute("webkitdirectory", "");
        input.setAttribute("directory", "");
      }
      input.hidden = true;
      const finish = (files) => {
        globalThis.removeEventListener("focus", handleWindowFocus);
        input.remove();
        resolve(Array.from(files || []));
      };
      const handleWindowFocus = () => {
        setTimeout(() => {
          if (!input.isConnected || input.files?.length) return;
          finish([]);
        }, 500);
      };
      input.addEventListener("change", () => finish(input.files), { once: true });
      input.addEventListener("cancel", () => finish([]), { once: true });
      globalThis.addEventListener("focus", handleWindowFocus, { once: true });
      document.body.append(input);
      input.click();
    });
  }

  async function uploadBrowserFiles(files) {
    if (!files.length) return null;
    const payload = [];
    let totalSize = 0;
    for (const file of files) {
      totalSize += file.size;
      if (totalSize > 50 * 1024 * 1024) {
        throw new Error("The selected files exceed the 50 MiB upload limit");
      }
      payload.push({
        dataBase64: await fileAsBase64(file),
        relativePath: file.webkitRelativePath || file.name,
      });
    }
    return bridgeRequest("/api/remote/files/upload", { files: payload });
  }

  async function browseBrowserFiles(directory) {
    const files = await chooseBrowserFiles({ directory, multiple: true });
    return uploadBrowserFiles(files);
  }

  function openBrowserUrl(url, { downloadName } = {}) {
    const anchor = document.createElement("a");
    anchor.href = url;
    if (downloadName) anchor.download = downloadName;
    else anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function workspaceFileUrl(path, inline = false) {
    return `/api/remote/files/download?path=${encodeURIComponent(String(path || ""))}${inline ? "&inline=1" : ""}`;
  }

  let lastArtifactDownload = { artifactId: "", startedAt: 0 };

  function downloadRemoteArtifact(artifactId) {
    const id = String(artifactId || "");
    const now = Date.now();
    if (!id || (
      lastArtifactDownload.artifactId === id
      && now - lastArtifactDownload.startedAt < 2000
    )) return Promise.resolve(true);
    lastArtifactDownload = { artifactId: id, startedAt: now };
    openBrowserUrl(
      `/api/remote/artifacts/download?id=${encodeURIComponent(id)}`,
      { downloadName: `${id}.html` },
    );
    setTimeout(() => {
      const url = new URL(globalThis.location.href);
      if (url.searchParams.get("coworkArtifact") !== id) return;
      url.searchParams.delete("coworkArtifact");
      globalThis.history.replaceState(globalThis.history.state, "", url);
      globalThis.dispatchEvent(new PopStateEvent("popstate", {
        state: globalThis.history.state,
      }));
    }, 100);
    return Promise.resolve(true);
  }

  function browserMethod(surface, method) {
    if (surface === "FileSystem") {
      if (method === "browseFiles") {
        return async () => (await browseBrowserFiles(false))?.paths ?? null;
      }
      if (method === "browseFolder") {
        return async (title) => {
          const prompt = String(title || "");
          const codeRoute = /^\/code(?:\/|$)/.test(globalThis.location.pathname);
          if (
            /where to create|project location/i.test(prompt)
            || (
              codeRoute
              && /change project directory|^choose a folder$|select a folder for this task/i.test(prompt)
            )
          ) return "/workspace";
          return (await browseBrowserFiles(true))?.root ?? null;
        };
      }
      if (method === "browseFolders") {
        return async () => {
          const root = (await browseBrowserFiles(true))?.root;
          return root ? [root] : null;
        };
      }
      if (method === "getSystemPath") return async () => "/workspace";
      if (method === "writeFileDownload" || method === "writeFileDownloadAndOpen") {
        return async (name, url) => {
          openBrowserUrl(new URL(url, globalThis.location.href).href, { downloadName: String(name || "download") });
          return String(name || "download");
        };
      }
      if (method === "openLocalFile") {
        return async (path) => {
          openBrowserUrl(workspaceFileUrl(path, true));
          return true;
        };
      }
      if (method === "showInFolder") {
        return async (path) => {
          openBrowserUrl(workspaceFileUrl(path, false));
          return true;
        };
      }
    }
    if (surface === "CoworkUserFiles") {
      if (method === "pickTarget") return async () => "/workspace";
      if (method === "reveal") {
        return async () => false;
      }
    }
    if (surface === "CoworkSpaces" && method === "openFile") {
      return async (_spaceId, path) => {
        openBrowserUrl(workspaceFileUrl(path, true));
        return true;
      };
    }
    if (surface === "CoworkArtifacts" && method === "printArtifactToPdf") {
      return async () => {
        globalThis.print();
        return true;
      };
    }
    if (surface === "CoworkArtifacts" && method === "showArtifact") {
      return downloadRemoteArtifact;
    }
    if (
      surface === "CoworkArtifacts"
      && ["hideArtifact", "parkAndCaptureArtifact", "reloadArtifactView"].includes(method)
    ) {
      return async () => null;
    }
    if (surface === "LocalSessions") {
      if (method === "getDetectedProjects") {
        return async (...args) => {
          const detected = await invoke(surface, method, args);
          const projects = Array.isArray(detected) ? detected : [];
          const withoutWorkspace = projects.filter((project) => project?.path !== "/workspace");
          return [{ path: "/workspace", lastActivity: Date.now() }, ...withoutWorkspace];
        };
      }
      if (method === "pickSessionFile" || method === "pickFileAtCwd") {
        return async () => (await browseBrowserFiles(false))?.paths?.[0] ?? null;
      }
    }
    return (...args) => invoke(surface, method, args);
  }

  const root = Object.create(null);
  const surfaceNames = new Set([
    ...Object.keys(config.methods || {}),
    ...Object.keys(config.listeners || {}),
    ...Object.keys(config.stores || {}),
  ]);
  for (const surface of surfaceNames) {
    const api = Object.create(null);
    for (const method of config.methods?.[surface] || []) {
      api[method] = browserMethod(surface, method);
    }
    for (const method of config.listeners?.[surface] || []) {
      api[method] = (callback) => subscribe(surface, method, callback);
    }
    for (const store of config.stores?.[surface] || []) {
      api[store] = makeStore(surface, store);
    }
    root[surface] = Object.freeze(api);
  }

  // BrowserNavigation.requestMainMenuPopup normally opens Electron's native
  // Windows application menu. The browser controller renders the live,
  // read-only menu model obtained from the running official Desktop process.
  if (!root.BrowserNavigation) {
    root.BrowserNavigation = Object.freeze({
      requestMainMenuPopup() {
        globalThis.__CLAUDE_REMOTE_MAIN_MENU__?.open?.();
      },
    });
  }
  Object.defineProperty(globalThis, "claude.web", {
    configurable: false,
    enumerable: false,
    value: Object.freeze(root),
    writable: false,
  });

  if (config.gatewaySettingsEnabled) {
    const settingsRoot = Object.create(null);
    for (const [surface, methods] of Object.entries(config.settingsMethods || {})) {
      const api = Object.create(null);
      for (const method of methods) {
        if (surface === "Custom3pSetup" && method === "openSetupWindow") {
          api[method] = async () => {
            globalThis.location.assign("/setup-desktop-3p");
          };
        } else if (surface === "Custom3pSetup" && method === "setDeploymentMode") {
          api[method] = async (mode) => {
            if (mode !== "3p") throw new Error("Only third-party deployment mode is available");
            globalThis.location.assign("/setup-desktop-3p");
          };
        } else if (surface === "Custom3pSetup" && method === "relaunchApp") {
          api[method] = (...args) => relaunchDesktop(args);
        } else {
          api[method] = (...args) => invokeSettings(surface, method, args);
        }
      }
      settingsRoot[surface] = Object.freeze(api);
    }
    Object.defineProperty(globalThis, "claude.settings", {
      configurable: false,
      enumerable: false,
      value: Object.freeze(settingsRoot),
      writable: false,
    });

    // The current official Linux ion bundle renders the 3P "Inference
    // configuration" user-menu item, but its packaged click helper resolves
    // to a no-op instead of Custom3pSetup.openSetupWindow. Keep the repair in
    // the remote preload (rather than rewriting the official bundle) and only
    // intercept that exact official menu item. Normal Claude Settings remains
    // untouched.
    document.addEventListener("click", (event) => {
      const menuItem = event.target instanceof Element
        ? event.target.closest('[role="menuitem"]')
        : null;
      if (!menuItem) return;
      const label = String(menuItem.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
      if (label !== "inference configuration") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      globalThis.location.assign("/setup-desktop-3p");
    }, true);

    if (globalThis.location.pathname === "/setup-desktop-3p") {
      document.documentElement.classList.add("claude-remote-setup-route");
      const enhanceSetupPage = () => {
        const header = document.querySelector("header");
        if (header && !document.getElementById("claude-remote-setup-back")) {
          const back = document.createElement("button");
          back.id = "claude-remote-setup-back";
          back.type = "button";
          back.setAttribute("aria-label", "Back to Claude");
          back.title = "Back to Claude";
          back.textContent = "←";
          back.addEventListener("click", () => globalThis.location.assign("/"));
          header.prepend(back);
        }
        for (const heading of document.querySelectorAll("h1")) {
          const icon = heading.previousElementSibling;
          if (icon?.querySelector?.('svg[width="104"][height="104"]')) {
            icon.classList.add("claude-remote-relaunch-icon");
          }
        }
      };
      enhanceSetupPage();
      const setupObserver = new MutationObserver(enhanceSetupPage);
      setupObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  function currentRemoteRoute() {
    const pathname = globalThis.location.pathname;
    const routeMatch = pathname.match(
      /^\/(task|chat|cowork|code|local_sessions)(?:\/([A-Za-z0-9_-]+))?(?:\/|$)/,
    );
    const route = routeMatch?.[1] || "";
    const mode = route === "code" || route === "local_sessions"
      ? "code"
      : route === "cowork"
        ? "cowork"
        : "chat";
    let sessionId = routeMatch?.[2] || null;
    if (!sessionId) {
      const search = new URLSearchParams(globalThis.location.search);
      sessionId = search.get("sessionId") || search.get("session_id") || null;
    }
    if (sessionId === "new") sessionId = null;
    return { mode, sessionId };
  }

  function eventStreamDescriptor() {
    const { mode, sessionId } = currentRemoteRoute();
    const params = new URLSearchParams({ mode });
    if (sessionId) params.set("sessionId", sessionId);
    return { key: params.toString(), url: `/api/events?${params.toString()}` };
  }

  function clearEventReconnect() {
    if (eventReconnectTimer !== null) clearTimeout(eventReconnectTimer);
    eventReconnectTimer = null;
  }

  function scheduleEventReconnect(generation) {
    if (generation !== eventStreamGeneration || eventReconnectTimer !== null) return;
    const delay = eventReconnectDelayMs;
    eventReconnectDelayMs = Math.min(Math.round(eventReconnectDelayMs * 1.7), 10000);
    eventReconnectTimer = setTimeout(() => {
      eventReconnectTimer = null;
      if (generation === eventStreamGeneration) connectEvents(true);
    }, delay);
  }

  function connectEvents(force = false) {
    if (!("EventSource" in globalThis)) return;
    const descriptor = eventStreamDescriptor();
    if (
      !force
      && events
      && eventStreamKey === descriptor.key
      && events.readyState !== EventSource.CLOSED
    ) return;
    clearEventReconnect();
    eventStreamGeneration += 1;
    const generation = eventStreamGeneration;
    if (events) events.close();
    eventStreamKey = descriptor.key;
    events = new EventSource(descriptor.url);
    const stream = events;
    stream.addEventListener("open", () => {
      if (events !== stream || generation !== eventStreamGeneration) return;
      eventReconnectDelayMs = 1000;
    });
    stream.addEventListener("error", () => {
      if (
        events !== stream
        || generation !== eventStreamGeneration
        || stream.readyState !== EventSource.CLOSED
      ) return;
      scheduleEventReconnect(generation);
    });
    events.addEventListener("desktop-ipc", (event) => {
      try {
        const payload = JSON.parse(event.data);
        dispatch(payload.surface, payload.method, payload.payload);
      } catch {}
    });
    events.addEventListener("sessions", (event) => {
      try {
        JSON.parse(event.data);
        dispatch("LocalAgentModeSessions", "onOnEvent", {
          type: "initialized",
        });
      } catch {}
    });
    events.addEventListener("transcript", (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (typeof payload.sessionId !== "string" || !payload.sessionId) return;
        latestTranscriptEvents.set(payload.sessionId, payload);
        if (latestTranscriptEvents.size > 16) {
          latestTranscriptEvents.delete(latestTranscriptEvents.keys().next().value);
        }
        dispatch("LocalAgentModeSessions", "onOnEvent", {
          type: "transcript_loaded",
          sessionId: payload.sessionId,
          messages: Array.isArray(payload.value) ? payload.value : [],
        });
        if (payload.isRunning === false) {
          dispatch("LocalAgentModeSessions", "onOnEvent", {
            type: "close",
            sessionId: payload.sessionId,
          });
        }
      } catch {}
    });
  }

  for (const method of ["pushState", "replaceState"]) {
    const original = globalThis.history?.[method]?.bind(globalThis.history);
    if (!original) continue;
    globalThis.history[method] = (...args) => {
      const result = original(...args);
      queueMicrotask(connectEvents);
      return result;
    };
  }
  globalThis.addEventListener("popstate", connectEvents);
  globalThis.addEventListener("hashchange", connectEvents);
  connectEvents();
  setInterval(() => {
    for (const key of storeCallbacks.keys()) {
      const separator = key.indexOf(".");
      const surface = key.slice(0, separator);
      const store = key.slice(separator + 1);
      refreshStore(surface, store).catch(() => {});
    }
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) connectEvents(true);
  });
  globalThis.addEventListener("pageshow", () => connectEvents(true));
  globalThis.addEventListener("online", () => connectEvents(true));

  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      let reloadingForUpdatedWorker = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadingForUpdatedWorker) return;
        reloadingForUpdatedWorker = true;
        location.reload();
      });
      navigator.serviceWorker.register(
        `/service-worker.js?v=${encodeURIComponent(config.release.patchRelease)}`,
        { updateViaCache: "none" },
      ).then((registration) => registration.update()).catch(() => {});
    });
  }
})();
