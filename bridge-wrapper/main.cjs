"use strict";

const http = require("node:http");
const { randomBytes } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } = require("node:fs/promises");
const { basename, dirname, extname, join, normalize, resolve } = require("node:path");
const { app, BrowserWindow, Menu, webContents } = require("electron");

const HOST = "127.0.0.1";
const PORT = Number(process.env.COWORK_BRIDGE_INTERNAL_PORT || 9222);
const ION_ROOT = resolve("/usr/lib/claude-desktop/resources/ion-dist");
const DESKTOP_ICON = "/usr/lib/claude-desktop/resources/icon.png";
const gatewaySettingsEnabled = process.env.CLAUDE_REMOTE_GATEWAY_SETTINGS === "1";
const developerActionsEnabled = process.env.CLAUDE_REMOTE_DEVELOPER_ACTIONS === "1";
const infrastructureActionsEnabled =
  process.env.CLAUDE_REMOTE_INFRASTRUCTURE_ACTIONS === "1";
const codeActionsEnabled = process.env.CLAUDE_REMOTE_CODE_ACTIONS === "1";

const ionMimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
};

const allowedMethods = new Map([
  ["Account", new Set(["setAccountDetails"])],
  ["WebBuild", new Set(["reportCommitHash"])],
  ["ClaudeVM", new Set([
    "checkVirtualMachinePlatform",
    "download",
    "getDownloadStatus",
    "getRunningStatus",
    "isHostLoopDevOverrideActive",
    "isHostLoopModeEnabled",
    "startVM",
  ])],
  ["LocalAgentModeSessions", new Set([
    "archive",
    "getAll",
    "getDefaultWorkspaceFolders",
    "getSession",
    "getSupportedCommands",
    "getTranscript",
    "searchSessions",
    "respondToToolPermission",
    "sendMessage",
    "setFocusedSession",
    "setEffort",
    "setExtendedThinking",
    "setModel",
    "setPermissionMode",
    "start",
    "stop",
    "updateSession",
  ])],
  ["CoworkArtifacts", new Set([
    "getAllArtifacts",
    "getArtifactIndexHtmlPath",
    "getArtifactMetadata",
    "getArtifactThumbnail",
    "hideArtifact",
    "importArtifact",
    "isAutoPublishEnabled",
    "isSharingEnabled",
    "parkAndCaptureArtifact",
    "printArtifactToPdf",
    "refreshImportedArtifact",
    "reloadArtifactView",
    "setArtifactAutoPublish",
    "setArtifactLastModifiedSession",
    "setArtifactMcpTools",
    "setArtifactStarred",
    "shareArtifact",
    "showArtifact",
    "unshareArtifact",
  ])],
  ["CoworkFilePreview", new Set([
    "isEnabled",
    "isEpitaxyPreviewEnabled",
    "isOpenInDefaultAppEnabled",
    "isVmReady",
    "hide",
    "parkAndCapture",
    "show",
  ])],
  ["CoworkMemory", new Set([
    "listAccountMemories",
    "readAccountMemory",
    "readGlobalMemory",
  ])],
  ["CoworkScheduledTasks", new Set([
    "getAllScheduledTasks",
    "getScheduledTaskFileContent",
    "getWatcherHistory",
  ])],
  ["CoworkSpaces", new Set([
    "classifySessions",
    "getAllSpaces",
    "getAutoMemoryDir",
    "getRemoteSessionSpaces",
    "getSpace",
    "listFolderContents",
    "openFile",
    "readFileContents",
    "readSpaceMemoryIndex",
    "summarizeSpace",
  ])],
  ["CoworkUserFiles", new Set(["getInfo"])],
  ["DocumentFunnel", new Set([
    "ensureScratchRoot",
    "injectDocumentContext",
    "ingestSessionDocument",
    "listScratchWorkingFiles",
    "openDownloadExport",
    "revealDownloadExport",
    "runClarkdownConvert",
    "runClarkdownDownloadExport",
    "writeScratchFile",
  ])],
  ["FileSystem", new Set([
    "appInfoForExtension",
    "browseFiles",
    "browseFolder",
    "browseFolders",
    "getLocalFileThumbnail",
    "getSystemPath",
    "listDirectory",
    "listFilesInFolder",
    "openLocalFile",
    "readLocalFile",
    "showInFolder",
    "whichApplication",
    "writeFileDownload",
    "writeFileDownloadAndOpen",
  ])],
  ["OpenDocuments", new Set(["getOpenDocuments", "readOpenDocumentAsBase64"])],
]);

if (infrastructureActionsEnabled) {
  allowedMethods.get("CoworkArtifacts").add("deleteArtifact");
  for (const method of ["deleteAccountMemory", "writeAccountMemory", "writeGlobalMemory"]) {
    allowedMethods.get("CoworkMemory").add(method);
  }
  for (const method of [
    "createScheduledTask",
    "markListenerReady",
    "updateScheduledTask",
    "updateScheduledTaskFileContent",
    "updateScheduledTaskStatus",
  ]) allowedMethods.get("CoworkScheduledTasks").add(method);
  for (const method of [
    "addFolderToSpace",
    "addLinkToSpace",
    "addProjectToSpace",
    "appendRemoteSessionSpaceFolders",
    "copyFilesToSpaceFolder",
    "createSpace",
    "createSpaceFolder",
    "deleteSpace",
    "removeFolderFromSpace",
    "removeLinkFromSpace",
    "removeProjectFromSpace",
    "removeRemoteSessionSpace",
    "setAutoDescription",
    "setRemoteSessionSpace",
    "updateSpace",
  ]) allowedMethods.get("CoworkSpaces").add(method);
  for (const method of ["migrate", "pickTarget", "reveal"]) {
    allowedMethods.get("CoworkUserFiles").add(method);
  }
  for (const method of [
    "exportLocalFileToGoogleDrive",
    "promoteScratchpadFile",
    "savePastedFile",
    "writeLocalFile",
  ]) allowedMethods.get("FileSystem").add(method);
}

if (developerActionsEnabled) {
  for (const method of [
    "authorizeDirectMcpServer",
    "deleteLocalSkill",
    "directMcpCallTool",
    "directMcpListResources",
    "directMcpReadResource",
    "disconnectDirectMcpServer",
    "getDirectMcpServerStatuses",
    "getLocalMcpServers",
    "getLocalSkillFiles",
    "listLocalSkills",
    "mcpAuthenticate",
    "mcpReconnect",
    "mcpSubmitOAuthCallbackUrl",
    "replaceEnabledMcpTools",
    "replaceRemoteMcpServers",
    "saveLocalSkill",
    "setLocalSkillEnabled",
    "setMcpServers",
    "syncSkills",
  ]) {
    allowedMethods.get("LocalAgentModeSessions").add(method);
  }
  allowedMethods.set("CustomPlugins", new Set([
    "addMarketplace",
    "checkPluginHasLocalChanges",
    "getAndClearMigrationIssues",
    "getCachedCommands",
    "getInstallCounts",
    "installLocalOrgPlugin",
    "installPlugin",
    "listAvailablePlugins",
    "listInstalledPlugins",
    "listLocalOrgPlugins",
    "listMarketplaces",
    "listRemotePluginsPage",
    "refreshMarketplace",
    "removeMarketplace",
    "syncLocalOrgPlugins",
    "uninstallPlugin",
    "updatePlugin",
  ]));
  allowedMethods.set("LocalPlugins", new Set([
    "deletePlugin",
    "getDownloadedRemotePlugins",
    "getPluginCliBatch",
    "getPluginCliStatus",
    "getPluginShimOps",
    "getPlugins",
    "listSkillFiles",
    "revokePluginOAuth",
    "setPluginEnabled",
    "setPluginEnvVars",
    "setPluginOAuthClient",
    "setPluginShimPermission",
    "startPluginOAuthFlow",
    "syncRemotePlugins",
    "uploadPlugin",
  ]));
  allowedMethods.set("PluginBridgeMcp", new Set(["listServers"]));
}

if (codeActionsEnabled) {
  allowedMethods.set("LocalSessions", new Set([
    "addDirectories",
    "applyFlagSettings",
    "archive",
    "cancelQueuedMessage",
    "changeCwd",
    "checkStoredTrust",
    "checkTrust",
    "cleanupAutoModeProposalFile",
    "clearSession",
    "createAgent",
    "delete",
    "discardPendingTurn",
    "findLocalSessionIdForBridgeId",
    "forkSession",
    "getAgents",
    "getAll",
    "getBusyShellPtyKeys",
    "getCodeStats",
    "getCommitDiff",
    "getContextUsage",
    "getDefaultEffort",
    "getDefaultPermissionMode",
    "getDetectedProjects",
    "getDiffFileContent",
    "getEffort",
    "getGitCommits",
    "getGitDiff",
    "getGitDiffFilePatch",
    "getGitDiffStats",
    "getGitInfo",
    "getInstalledEditors",
    "getLocalBranches",
    "getLocalMcpServers",
    "getPermissionMode",
    "getPlanForSession",
    "getSession",
    "getSessionMediaStreamUrl",
    "getSessionPanelMediaStreamUrl",
    "getSessionsForScheduledTask",
    "getShellPtyBuffer",
    "getSupportedCommands",
    "getTranscript",
    "getTranscriptTail",
    "getUncommittedChanges",
    "interrupt",
    "isVSCodeInstalled",
    "listSessionDirectory",
    "logCliEvent",
    "mcpAuthenticate",
    "mcpCallTool",
    "mcpListResources",
    "mcpReadResource",
    "mcpReconnect",
    "mcpSubmitOAuthCallbackUrl",
    "openInEditor",
    "openInVSCode",
    "openSessionFileInDefaultApp",
    "pickFileAtCwd",
    "pickSessionFile",
    "prewarmAuth",
    "promoteQueuedMessage",
    "readFileAtCwd",
    "readSessionFile",
    "readSessionImageAsDataUrl",
    "readSessionMediaAsDataUrl",
    "readSessionPanelMediaAsDataUrl",
    "reorderQueuedMessage",
    "replaceEnabledMcpTools",
    "replaceRemoteMcpServers",
    "reportComposerInp",
    "reportStreamRender",
    "reportSwitchTiming",
    "resolveSessionFile",
    "respondToRefusalFallbackPrompt",
    "respondToToolPermission",
    "resizePty",
    "resizeShellPty",
    "resumePreClearSession",
    "rewind",
    "rewindV2",
    "runBashCommand",
    "saveTrust",
    "searchSessions",
    "sendMessage",
    "sendSideChatMessage",
    "setAccountBranchPrefix",
    "setAvailableCodeModels",
    "setEffort",
    "setFastMode",
    "setFocusedSession",
    "setMcpServers",
    "setModel",
    "setPermissionMode",
    "showSessionFileInFolder",
    "showSessionFilePreview",
    "start",
    "startPty",
    "startShellPty",
    "startSideChat",
    "stop",
    "stopPty",
    "stopSessionSummary",
    "stopShellPty",
    "stopSideChat",
    "stopTask",
    "submitFeedback",
    "summarizeSession",
    "summarizeTranscript",
    "unarchive",
    "updateSession",
    "warmSession",
    "writeAutoModeProposalFile",
    "writePty",
    "writeSessionFile",
    "writeShellPty",
  ]));
  allowedMethods.set("LocalSessionEnvironment", new Set(["get", "save"]));
}

const allowedSettingsMethods = gatewaySettingsEnabled
  ? new Map([
      ["Custom3pSetup", new Set([
        "createConfig",
        "deleteConfig",
        "duplicateConfig",
        "exportConfig",
        "getConfigHealth",
        "getLoginDesktop3pStatus",
        "authorizeAndProbeMcpServer",
        "forgetMcpOAuth",
        "listConfigs",
        "probeEgressHosts",
        "probeMcpServer",
        "readConfig",
        "recheckConfigHealth",
        "relaunchApp",
        "renameConfig",
        "revealConfig",
        "scanOrgPlugins",
        "setAppliedConfig",
        "triggerBootstrapAuth",
        "writeConfig",
      ])],
      ["Custom3pHelperRun", new Set([
        "discoverModels",
        "probeInference",
        "runCredentialHelper",
      ])],
    ])
  : new Map();

const allowedSurfaces = new Set(allowedMethods.keys());

const allowedStores = new Map([
  ["LocalAgentModeSessions", new Set([
    "interactiveAuthStore",
    "sessionsBridgeStatusStore",
  ])],
  ["ManagedConfig", new Set(["managedRendererConfigStore"])],
  ["ClaudeVM", new Set(["apiReachabilityStore"])],
]);

const relayedListeners = new Map([
  ["ClaudeVM", new Set([
    "onDownloadProgress",
    "onDownloadStatusChanged",
    "onRunningStatusChanged",
    "onStartupError",
  ])],
  ["LocalAgentModeSessions", new Set([
    "onOnBridgePermissionPreflight",
    "onOnCoworkFromMain",
    "onOnEvent",
    "onOnManagedAskToolNamesChanged",
    "onOnToolPermissionRequest",
  ])],
  ["CoworkArtifacts", new Set(["onOnArtifactsChanged"])],
  ["CoworkScheduledTasks", new Set(["onOnScheduledTaskEvent"])],
  ["CoworkSpaces", new Set(["onOnSpaceEvent"])],
  ["DocumentFunnel", new Set(["onWorkingDocumentsChanged"])],
]);

// Renderer events must be pushed into the main process as they happen. Pulling
// this queue with executeJavaScript() made event delivery contend with normal
// Desktop IPC and could delay completed assistant messages for tens of seconds.
const relayConsoleToken = randomBytes(24).toString("base64url");
const relayConsolePrefix = `__CLAUDE_REMOTE_EVENT_V2__:${relayConsoleToken}:`;
const relayedEventQueue = [];
const relayConsoleContents = new Set();
let registeredRelayContentsId = null;

function enqueueRelayedEvent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  if (!relayedListeners.get(value.surface)?.has(value.method)) return;
  relayedEventQueue.push(value);
  if (relayedEventQueue.length > 2000) {
    relayedEventQueue.splice(0, relayedEventQueue.length - 2000);
  }
}

function attachRelayConsole(contents) {
  if (!contents || contents.isDestroyed() || relayConsoleContents.has(contents.id)) return;
  relayConsoleContents.add(contents.id);
  contents.on("console-message", (_event, ...args) => {
    const details = args.find((item) => item && typeof item === "object" &&
      typeof item.message === "string");
    const message = details?.message || args.find((item) => typeof item === "string");
    if (typeof message !== "string" || !message.startsWith(relayConsolePrefix)) return;
    const serialized = message.slice(relayConsolePrefix.length);
    if (!serialized || serialized.length > 16 * 1024 * 1024) return;
    try {
      enqueueRelayedEvent(JSON.parse(serialized));
    } catch {}
  });
  contents.on("did-finish-load", () => {
    if (registeredRelayContentsId === contents.id) registeredRelayContentsId = null;
  });
  contents.once("destroyed", () => {
    relayConsoleContents.delete(contents.id);
    if (registeredRelayContentsId === contents.id) registeredRelayContentsId = null;
  });
}

if (developerActionsEnabled) {
  relayedListeners.get("LocalAgentModeSessions").add(
    "onOnDirectMcpServerStatusesChanged",
  );
  relayedListeners.set("CustomPlugins", new Set(["onInstallProgress"]));
  relayedListeners.set("LocalPlugins", new Set(["onOnCliOpAlwaysAllowed"]));
  relayedListeners.set("PluginBridgeMcp", new Set(["onChanged"]));
}

if (codeActionsEnabled) {
  relayedListeners.set("LocalSessions", new Set([
    "onOnEvent",
    "onOnToolPermissionRequest",
  ]));
}

// Relay only capability flags backed by an explicitly published remote
// surface. Native-only features remain absent from the browser snapshot.
const relayedBootFeatures = new Set([
  "chatIn3p",
  "chatTab",
  "yukonSilver",
]);
if (codeActionsEnabled) {
  for (const feature of [
    "ccdPlugins",
    "chillingSlothEnterprise",
    "chillingSlothFeat",
    "chillingSlothLocal",
    "launch",
  ]) relayedBootFeatures.add(feature);
}

function findOfficialBootFeatures() {
  for (const loadedModule of Object.values(require.cache)) {
    const getSupportedFeaturesSync =
      loadedModule?.exports?.getSupportedFeaturesSync;
    if (typeof getSupportedFeaturesSync !== "function") continue;
    try {
      const features = getSupportedFeaturesSync();
      if (features && typeof features === "object") return features;
    } catch {
      // The official renderer snapshot below remains a safe fallback while
      // the Desktop main process is still completing startup.
    }
  }
  return null;
}

function sanitizeBootFeatures(source) {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const name of relayedBootFeatures) {
    const feature = source[name];
    if (!feature || typeof feature !== "object") continue;
    const value = {};
    if (typeof feature.status === "string") value.status = feature.status;
    if (typeof feature.maturity === "string") value.maturity = feature.maturity;
    if (typeof feature.reason === "string") value.reason = feature.reason;
    if (typeof feature.unsupportedCode === "string") {
      value.unsupportedCode = feature.unsupportedCode;
    }
    if (typeof value.status === "string") result[name] = value;
  }
  return result;
}

function sanitizeMenuText(value, maxLength = 240) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function serializeNativeMenu(menu, depth = 0) {
  if (!menu || !Array.isArray(menu.items) || depth > 5) return [];
  return menu.items
    .filter((item) => item?.visible !== false)
    .slice(0, 80)
    .map((item) => ({
      accelerator: sanitizeMenuText(item.accelerator, 80) || null,
      checked: Boolean(item.checked),
      enabled: item.enabled !== false,
      label: sanitizeMenuText(item.label),
      role: sanitizeMenuText(item.role, 80) || null,
      submenu: item.submenu ? serializeNativeMenu(item.submenu, depth + 1) : [],
      type: sanitizeMenuText(item.type, 40) || "normal",
    }));
}

function readNativeMainMenu() {
  return serializeNativeMenu(Menu.getApplicationMenu());
}

const lastNativeMenuActionAt = new Map();
let performanceTraceActive = false;

const nativeMenuActions = new Map([
  ["reload-mcp-configuration", ["Reload MCP Configuration"]],
  ["show-dev-tools", ["Show Dev Tools"]],
  ["show-all-dev-tools", ["Show All Dev Tools"]],
  ["toggle-main-process-debugger", ["Enable Main Process Debugger"]],
  ["toggle-performance-trace", ["Record Performance Trace", "Stop Performance Trace"]],
  ["write-main-process-heap-snapshot", ["Write Main Process Heap Snapshot"]],
  ["record-memory-trace", ["Record Memory Trace (auto-stop)"]],
]);

const developerFileKinds = new Map([
  ["mcp-log", { fileName: "mcp.log", readOnly: true, root: "logs" }],
  ["app-config", {
    fileName: "claude_desktop_config.json",
    readOnly: false,
    root: "userData",
  }],
  ["developer-config", {
    fileName: "developer_settings.json",
    readOnly: false,
    root: "userData",
  }],
]);

const developerArtifactPattern = /^(?:desktop-trace|memory-trace)-[A-Za-z0-9_.:-]+\.json$|^main-heap-[A-Za-z0-9_.:-]+\.heapsnapshot$/;

function normalizedMenuLabel(value) {
  return sanitizeMenuText(value)
    .replace(/&(?=\S)/g, "")
    .replace(/\.{3}|…/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findNativeMenuItem(labels) {
  let menu = Menu.getApplicationMenu();
  let item = null;
  for (const label of labels) {
    item = menu?.items?.find((candidate) =>
      normalizedMenuLabel(candidate.label) === normalizedMenuLabel(label)
    );
    if (!item) return null;
    menu = item.submenu;
  }
  return item;
}

async function runNativeMenuAction(action) {
  const labels = nativeMenuActions.get(action);
  if (!labels) {
    throw new Error("native menu action is not allowed");
  }
  if (action !== "reload-mcp-configuration" && !developerActionsEnabled) {
    throw new Error("remote Developer actions are disabled");
  }
  if (action === "reload-mcp-configuration" &&
      !developerActionsEnabled && !gatewaySettingsEnabled) {
    throw new Error("remote MCP reload is disabled");
  }
  const now = Date.now();
  if (now - (lastNativeMenuActionAt.get(action) || 0) < 3000) {
    throw new Error("native menu action is temporarily rate limited");
  }
  const item = labels
    .map((label) => findNativeMenuItem(["Developer", label]))
    .find(Boolean);
  if (!item || item.enabled === false || typeof item.click !== "function") {
    throw new Error("official native menu action is unavailable");
  }
  lastNativeMenuActionAt.set(action, now);
  const invokedLabel = sanitizeMenuText(item.label);
  await item.click(item, BrowserWindow.getFocusedWindow() || undefined, {});
  let phase = "triggered";
  if (action === "toggle-performance-trace") {
    performanceTraceActive = !performanceTraceActive;
    phase = performanceTraceActive ? "started" : "stopped";
  } else if (action === "record-memory-trace") {
    phase = "recording-auto-stop";
  }
  return { action, invokedLabel, phase, triggered: true };
}

function requireDeveloperActions() {
  if (!developerActionsEnabled) {
    throw new Error("remote Developer actions are disabled");
  }
}

function developerFilePath(kind) {
  requireDeveloperActions();
  const spec = developerFileKinds.get(kind);
  if (!spec) throw new Error("developer file kind is not allowed");
  const root = spec.root === "logs" ? app.getPath("logs") : app.getPath("userData");
  return { path: join(root, spec.fileName), spec };
}

async function readDeveloperFile(kind) {
  const { path, spec } = developerFilePath(kind);
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        content: spec.readOnly ? "" : "{}\n",
        exists: false,
        kind,
        name: spec.fileName,
        readOnly: spec.readOnly,
        truncated: false,
      };
    }
    throw error;
  }
  if (!info.isFile()) throw new Error("developer file is not a regular file");
  const maxBytes = spec.readOnly ? 2 * 1024 * 1024 : 1024 * 1024;
  let content;
  let truncated = false;
  if (info.size > maxBytes && spec.readOnly) {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, info.size - maxBytes);
      content = buffer.subarray(0, bytesRead).toString("utf8");
      truncated = true;
    } finally {
      await handle.close();
    }
  } else {
    if (info.size > maxBytes) throw new Error("developer configuration is too large");
    content = await readFile(path, "utf8");
  }
  return {
    content,
    exists: true,
    kind,
    mtimeMs: info.mtimeMs,
    name: spec.fileName,
    readOnly: spec.readOnly,
    truncated,
  };
}

async function writeDeveloperFile(kind, content) {
  const { path, spec } = developerFilePath(kind);
  if (spec.readOnly) throw new Error("developer file is read-only");
  if (typeof content !== "string" || Buffer.byteLength(content) > 1024 * 1024) {
    throw new Error("developer configuration must be text smaller than 1 MiB");
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("developer configuration must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("developer configuration root must be an object");
  }
  if (kind === "developer-config" &&
      "allowDevTools" in parsed && typeof parsed.allowDevTools !== "boolean") {
    throw new Error("allowDevTools must be a boolean");
  }
  const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.remote-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, normalized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return readDeveloperFile(kind);
}

function developerArtifactsDirectory() {
  requireDeveloperActions();
  return join(app.getPath("logs"), "traces");
}

async function listDeveloperArtifacts() {
  const directory = developerArtifactsDirectory();
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !developerArtifactPattern.test(entry.name)) continue;
    const info = await stat(join(directory, entry.name));
    files.push({ mtimeMs: info.mtimeMs, name: entry.name, size: info.size });
  }
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs).slice(0, 100);
}

async function serveDeveloperArtifact(response, name) {
  const directory = developerArtifactsDirectory();
  const safeName = basename(String(name || ""));
  if (safeName !== name || !developerArtifactPattern.test(safeName)) {
    throw new Error("developer artifact name is not allowed");
  }
  const path = join(directory, safeName);
  const info = await stat(path);
  if (!info.isFile()) throw new Error("developer artifact is not a regular file");
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename=${JSON.stringify(safeName)}`,
    "Content-Length": info.size,
    "Content-Type": safeName.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(path).pipe(response);
}

const protocolRules = [
  { methods: new Set(["GET"]), path: /^\/edge-api\/bootstrap$/ },
  { methods: new Set(["GET"]), path: /^\/edge-api\/bootstrap\/[0-9a-f-]+\/app_start$/i },
  { methods: new Set(["GET"]), path: /^\/api\/bootstrap(?:\/[^/?#]+\/(?:current_user_access|system_prompts|cowork_sysprompt_map))?$/ },
  { methods: new Set(["GET", "PUT"]), path: /^\/api\/account_profile$/ },
  { methods: new Set(["GET"]), path: /^\/api\/organizations\/[0-9a-f-]+$/i },
  { methods: new Set(["GET"]), path: /^\/api\/organizations\/[0-9a-f-]+\/(?:feature_settings|cowork_settings|office_settings)$/i },
  { methods: new Set(["POST"]), path: /^\/api\/organizations\/[0-9a-f-]+\/dust\/generate_session_title$/i },
];

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxSize = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxSize) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateInvocation(surface, method, args) {
  if (!allowedSurfaces.has(surface)) throw new Error("Cowork surface is not allowed");
  if (!allowedMethods.get(surface).has(method)) {
    throw new Error("Cowork IPC method is not allowed");
  }
  if (!Array.isArray(args)) throw new Error("args must be an array");
}

function validateSettingsInvocation(surface, method, args) {
  if (!gatewaySettingsEnabled) throw new Error("Remote Gateway settings are disabled");
  if (!allowedSettingsMethods.get(surface)?.has(method)) {
    throw new Error("Gateway settings method is not allowed");
  }
  if (!Array.isArray(args)) throw new Error("args must be an array");
  if (method === "getLoginDesktop3pStatus" && args.length !== 0) {
    throw new Error("getLoginDesktop3pStatus does not accept arguments");
  }
}

function validateStoreRead(surface, store) {
  if (!allowedStores.get(surface)?.has(store)) {
    throw new Error("Desktop store is not allowed");
  }
}

const undefinedSentinelKey = "__claudeRemoteUndefinedV1";

function decodeIpcValue(value, argsEncoding) {
  if (argsEncoding !== "json-undefined-v1") return value;
  if (Array.isArray(value)) {
    return value.map((item) => decodeIpcValue(item, argsEncoding));
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === undefinedSentinelKey && value[undefinedSentinelKey] === true) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        decodeIpcValue(item, argsEncoding),
      ]),
    );
  }
  return value;
}

function validateProtocolRequest(method, pathname) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!protocolRules.some((rule) =>
    rule.methods.has(normalizedMethod) && rule.path.test(pathname)
  )) {
    throw new Error("Desktop protocol path is not allowed");
  }
  return normalizedMethod;
}

function validateAccountProfileUpdate(method, pathname, body) {
  if (method !== "PUT" || pathname !== "/api/account_profile") return;
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("Account profile update must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Account profile update must be an object");
  }
  const allowedKeys = new Set([
    "avatar",
    "conversation_preferences",
    "cowork_global_instructions",
    "work_function",
  ]);
  const keys = Object.keys(parsed);
  if (!keys.length || keys.some((key) => !allowedKeys.has(key))) {
    throw new Error("Account profile update contains a forbidden field");
  }
  for (const key of ["conversation_preferences", "cowork_global_instructions"]) {
    if (key in parsed && (typeof parsed[key] !== "string" || parsed[key].length > 10000)) {
      throw new Error(`${key} must be a string of at most 10000 characters`);
    }
  }
  if ("work_function" in parsed &&
      (typeof parsed.work_function !== "string" || parsed.work_function.length > 128)) {
    throw new Error("work_function must be a string of at most 128 characters");
  }
  if ("avatar" in parsed &&
      (!Number.isInteger(parsed.avatar) || parsed.avatar < 0 || parsed.avatar > 72)) {
    throw new Error("avatar must be an integer between 0 and 72");
  }
}

function rendererCandidates() {
  return webContents.getAllWebContents().filter((item) => {
    if (item.isDestroyed()) return false;
    return item.getType() === "window" && item.getURL().startsWith("app://localhost");
  });
}

async function evaluateInOfficialRenderer(expression) {
  let lastError = null;
  for (const contents of rendererCandidates()) {
    try {
      const value = await contents.executeJavaScript(expression, true);
      if (value !== "__COWORK_BRIDGE_NOT_AVAILABLE__") return value;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("official Cowork renderer is not ready");
}

async function gatewaySettingsRenderer() {
  const findSetupWindow = () => rendererCandidates().find((contents) =>
    contents.getURL().includes("/setup-desktop-3p")
  );
  const existing = findSetupWindow();
  if (existing) return existing;

  const openExpression = `(async () => {
    const openSetupWindow = globalThis["claude.settings"]?.Custom3pSetup?.openSetupWindow;
    if (typeof openSetupWindow !== "function") return false;
    await openSetupWindow();
    return true;
  })()`;
  let opened = false;
  for (const contents of rendererCandidates()) {
    try {
      if (await contents.executeJavaScript(openExpression, true)) {
        opened = true;
        break;
      }
    } catch {}
  }
  if (!opened) throw new Error("official Gateway setup window could not be opened");

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const contents = findSetupWindow();
    if (contents) return contents;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("official Gateway setup window did not become ready");
}

async function inspect() {
  const surfaces = [...allowedSurfaces];
  const methods = Object.fromEntries(
    [...allowedMethods].map(([surface, names]) => [surface, [...names]]),
  );
  const expression = `(() => {
    const root = globalThis["claude.web"];
    if (!root?.LocalAgentModeSessions) return "__COWORK_BRIDGE_NOT_AVAILABLE__";
    const allowed = ${JSON.stringify(methods)};
    return JSON.stringify(Object.fromEntries(
      Object.entries(root)
        .filter(([name]) => ${JSON.stringify(surfaces)}.includes(name))
        .map(([name, api]) => [
          name,
          Object.keys(api).filter(
            (key) => allowed[name]?.includes(key) && typeof api[key] === "function",
          ),
        ]),
    ));
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  return JSON.parse(serialized);
}

async function describe() {
  const expression = `(() => {
    const root = globalThis["claude.web"];
    if (!root?.LocalAgentModeSessions) return "__COWORK_BRIDGE_NOT_AVAILABLE__";
    const describeValue = (value) => {
      if (value === null) return { type: "null" };
      const type = typeof value;
      if (type !== "object") return { type };
      const keys = {};
      for (const key of Object.keys(value)) {
        try {
          keys[key] = typeof value[key];
        } catch {
          keys[key] = "unreadable";
        }
      }
      return { type, keys };
    };
    return JSON.stringify(Object.fromEntries(
      Object.entries(root).map(([surface, api]) => [
        surface,
        Object.fromEntries(Object.keys(api).map((key) => [key, describeValue(api[key])])),
      ]),
    ));
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  return JSON.parse(serialized);
}

async function readBootFeatures() {
  // Desktop passes a one-time feature snapshot to the renderer when creating
  // its window. On Linux that can capture the transient virtualization probe
  // state forever. Prefer the official main-process evaluator, which reads
  // the completed probe and managed configuration on every call.
  const officialFeatures = findOfficialBootFeatures();
  if (officialFeatures) return sanitizeBootFeatures(officialFeatures);

  const expression = `(() => {
    const source = globalThis.desktopBootFeatures;
    if (!source || typeof source !== "object") {
      return "__COWORK_BRIDGE_NOT_AVAILABLE__";
    }
    const allowed = ${JSON.stringify([...relayedBootFeatures])};
    const result = {};
    for (const name of allowed) {
      const feature = source[name];
      if (!feature || typeof feature !== "object") continue;
      const value = {};
      if (typeof feature.status === "string") value.status = feature.status;
      if (typeof feature.maturity === "string") value.maturity = feature.maturity;
      if (typeof feature.reason === "string") value.reason = feature.reason;
      if (typeof feature.unsupportedCode === "string") {
        value.unsupportedCode = feature.unsupportedCode;
      }
      if (typeof value.status === "string") result[name] = value;
    }
    return JSON.stringify(result);
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  return sanitizeBootFeatures(JSON.parse(serialized));
}

async function invoke(surface, method, args, argsEncoding) {
  const decodedArgs = decodeIpcValue(args, argsEncoding);
  validateInvocation(surface, method, decodedArgs);
  const payload = Buffer.from(JSON.stringify({ surface, method, args, argsEncoding })).toString("base64");
  const expression = `(async () => {
    const encodedRequest = atob(${JSON.stringify(payload)});
    const requestBytes = Uint8Array.from(
      encodedRequest,
      (character) => character.charCodeAt(0),
    );
    const request = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
    );
    const decode = (value) => {
      if (request.argsEncoding !== "json-undefined-v1") return value;
      if (Array.isArray(value)) return value.map(decode);
      if (value && typeof value === "object") {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === ${JSON.stringify(undefinedSentinelKey)} && value[${JSON.stringify(undefinedSentinelKey)}] === true) {
          return undefined;
        }
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, decode(item)]),
        );
      }
      return value;
    };
    request.args = decode(request.args);
    const root = globalThis["claude.web"];
    if (!root?.LocalAgentModeSessions) return "__COWORK_BRIDGE_NOT_AVAILABLE__";
    try {
      const fn = root[request.surface]?.[request.method];
      if (typeof fn !== "function") throw new Error("Cowork IPC method is unavailable");
      const value = await fn(...request.args);
      return JSON.stringify({ ok: true, value }, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item
      );
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  const result = JSON.parse(serialized);
  if (!result.ok) throw new Error(result.error || "Cowork IPC call failed");
  return result.value;
}

async function invokeSettings(surface, method, args, argsEncoding) {
  const decodedArgs = decodeIpcValue(args, argsEncoding);
  validateSettingsInvocation(surface, method, decodedArgs);
  const payload = Buffer.from(JSON.stringify({ surface, method, args, argsEncoding })).toString("base64");
  const expression = `(async () => {
    const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(${JSON.stringify(payload)}), (character) => character.charCodeAt(0)),
    ));
    const decode = (value) => {
      if (request.argsEncoding !== "json-undefined-v1") return value;
      if (Array.isArray(value)) return value.map(decode);
      if (value && typeof value === "object") {
        const keys = Object.keys(value);
        if (keys.length === 1 && keys[0] === ${JSON.stringify(undefinedSentinelKey)} && value[${JSON.stringify(undefinedSentinelKey)}] === true) {
          return undefined;
        }
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, decode(item)]),
        );
      }
      return value;
    };
    request.args = decode(request.args);
    const root = globalThis["claude.settings"];
    const fn = root?.[request.surface]?.[request.method];
    if (typeof fn !== "function") return "__COWORK_BRIDGE_NOT_AVAILABLE__";
    try {
      const value = await fn(...request.args);
      return JSON.stringify({ ok: true, value }, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item
      );
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })()`;
  const contents = await gatewaySettingsRenderer();
  const serialized = await contents.executeJavaScript(expression, true);
  if (serialized === "__COWORK_BRIDGE_NOT_AVAILABLE__") {
    throw new Error("Gateway settings IPC is unavailable in the official setup window");
  }
  const result = JSON.parse(serialized);
  if (!result.ok) throw new Error(result.error || "Gateway settings IPC call failed");
  return result.value;
}

async function readStore(surface, store) {
  validateStoreRead(surface, store);
  const payload = Buffer.from(JSON.stringify({ surface, store })).toString("base64");
  const expression = `(async () => {
    const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(${JSON.stringify(payload)}), (character) => character.charCodeAt(0)),
    ));
    try {
      const value = await globalThis["claude.web"]?.[request.surface]?.[request.store]?.getState?.();
      return JSON.stringify({ ok: true, value }, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item
      );
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  const result = JSON.parse(serialized);
  if (!result.ok) throw new Error(result.error || "Desktop store read failed");
  return result.value;
}

async function ensureRelayedEventsRegistered() {
  if (registeredRelayContentsId !== null) {
    const current = webContents.fromId(registeredRelayContentsId);
    if (current && !current.isDestroyed()) return;
    registeredRelayContentsId = null;
  }
  const listeners = Object.fromEntries(
    [...relayedListeners].map(([surface, methods]) => [surface, [...methods]]),
  );
  const expression = `(() => {
    const root = globalThis["claude.web"];
    if (!root?.LocalAgentModeSessions) return "__COWORK_BRIDGE_NOT_AVAILABLE__";
    const relayKey = "__CLAUDE_REMOTE_EVENT_RELAY_V2__";
    if (!globalThis[relayKey]) {
      const relay = { unsubscribers: [] };
      const listeners = ${JSON.stringify(listeners)};
      const consolePrefix = ${JSON.stringify(relayConsolePrefix)};
      for (const [surface, methods] of Object.entries(listeners)) {
        for (const method of methods) {
          const subscribe = root[surface]?.[method];
          if (typeof subscribe !== "function") continue;
          try {
            const unsubscribe = subscribe((payload) => {
              let value = null;
              try {
                value = JSON.parse(JSON.stringify(payload, (_key, item) =>
                  typeof item === "bigint" ? item.toString() : item
                ));
              } catch {
                value = { type: "unserializable-event" };
              }
              console.debug(consolePrefix + JSON.stringify({ surface, method, payload: value }));
            });
            if (typeof unsubscribe === "function") relay.unsubscribers.push(unsubscribe);
          } catch {}
        }
      }
      globalThis[relayKey] = relay;
    }
    return true;
  })()`;
  let lastError = null;
  for (const contents of rendererCandidates()) {
    attachRelayConsole(contents);
    try {
      const registered = await contents.executeJavaScript(expression, true);
      if (registered === true) {
        registeredRelayContentsId = contents.id;
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("official Cowork renderer is not ready");
}

async function drainRelayedEvents() {
  await ensureRelayedEventsRegistered();
  return relayedEventQueue.splice(0);
}

async function fetchOfficialProtocol({ method, pathname, search, headers, bodyBase64 }) {
  const normalizedMethod = validateProtocolRequest(method, pathname);
  const body = Buffer.from(typeof bodyBase64 === "string" ? bodyBase64 : "", "base64");
  validateAccountProfileUpdate(normalizedMethod, pathname, body);
  const safeHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if ([
      "accept",
      "accept-language",
      "anthropic-anonymous-id",
      "anthropic-client-build",
      "anthropic-client-device-id",
      "anthropic-client-platform",
      "anthropic-client-sha",
      "anthropic-client-version",
      "content-type",
      "x-activity-session-id",
    ].includes(name.toLowerCase())) {
      safeHeaders[name] = String(value).slice(0, 1000);
    }
  }
  const requestPayload = {
    method: normalizedMethod,
    url: `app://localhost${pathname}${search || ""}`,
    headers: safeHeaders,
    bodyBase64: body.toString("base64"),
  };
  const payload = Buffer.from(JSON.stringify(requestPayload)).toString("base64");
  const expression = `(async () => {
    const request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(${JSON.stringify(payload)}), (character) => character.charCodeAt(0)),
    ));
    try {
      const body = request.bodyBase64
        ? Uint8Array.from(atob(request.bodyBase64), (character) => character.charCodeAt(0))
        : undefined;
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      return JSON.stringify({
        ok: true,
        value: {
          status: response.status,
          contentType: response.headers.get("content-type") || "application/octet-stream",
          bodyBase64: btoa(binary),
        },
      });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  const result = JSON.parse(serialized);
  if (!result.ok) throw new Error(result.error || "official Desktop protocol request failed");
  return result.value;
}

async function serveIon(response, pathname) {
  const requested = pathname.slice("/ion/".length) || "index.html";
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(ION_ROOT, safePath);
  if (filePath !== ION_ROOT && !filePath.startsWith(`${ION_ROOT}/`)) {
    throw new Error("not found");
  }
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not found");
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": safePath === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
    "Content-Length": body.length,
    "Content-Type": ionMimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function serveDesktopIcon(response) {
  const body = await readFile(DESKTOP_ICON);
  response.writeHead(200, {
    "Cache-Control": "public, max-age=86400",
    "Content-Length": body.length,
    "Content-Type": "image/png",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function generateTitle(message, model) {
  if (typeof message !== "string" || !message.trim()) {
    throw new Error("message must be a non-empty string");
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("model must be a non-empty string");
  }
  const payload = Buffer.from(JSON.stringify({ message, model })).toString("base64");
  const expression = `(async () => {
    const encodedRequest = atob(${JSON.stringify(payload)});
    const requestBytes = Uint8Array.from(
      encodedRequest,
      (character) => character.charCodeAt(0),
    );
    const request = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(requestBytes),
    );
    try {
      const response = await fetch(
        "app://localhost/api/organizations/00000000-0000-4000-8000-000000000001/dust/generate_session_title",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            first_session_message: request.message,
            model: request.model,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error?.message || \`title generation returned HTTP \${response.status}\`);
      }
      if (typeof body?.title !== "string" || !body.title.trim()) {
        throw new Error("official title generation returned an empty title");
      }
      return JSON.stringify({ ok: true, value: body.title.trim() });
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })()`;
  const serialized = await evaluateInOfficialRenderer(expression);
  const result = JSON.parse(serialized);
  if (!result.ok) throw new Error(result.error || "official title generation failed");
  return result.value;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    if (request.method === "GET" && url.pathname.startsWith("/ion/")) {
      await serveIon(response, url.pathname);
      return;
    }
    if (request.method === "GET" && url.pathname === "/desktop-icon.png") {
      await serveDesktopIcon(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const surfaces = await inspect();
      sendJson(response, 200, {
        ok: true,
        coworkReady: Boolean(surfaces.LocalAgentModeSessions?.includes("getAll")),
        surfaces,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/describe") {
      sendJson(response, 200, { ok: true, value: await describe() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/boot-features") {
      sendJson(response, 200, { ok: true, value: await readBootFeatures() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/runtime") {
      sendJson(response, 200, {
        ok: true,
        value: {
          platform: process.platform,
          version: app.getVersion(),
        },
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/main-menu") {
      sendJson(response, 200, { ok: true, value: readNativeMainMenu() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/main-menu-action") {
      const body = await readJson(request);
      sendJson(response, 200, { ok: true, value: await runNativeMenuAction(body.action) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/developer-file") {
      sendJson(response, 200, {
        ok: true,
        value: await readDeveloperFile(url.searchParams.get("kind")),
      });
      return;
    }
    if (request.method === "PUT" && url.pathname === "/developer-file") {
      const body = await readJson(request);
      sendJson(response, 200, {
        ok: true,
        value: await writeDeveloperFile(body.kind, body.content),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/developer-artifacts") {
      sendJson(response, 200, { ok: true, value: await listDeveloperArtifacts() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/developer-artifact") {
      await serveDeveloperArtifact(response, url.searchParams.get("name"));
      return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
      sendJson(response, 200, { ok: true, value: await drainRelayedEvents() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/invoke") {
      // The authenticated outer bridge already validates the surface/method.
      // Preserve enough room for Desktop's base64 image attachment contract.
      const body = await readJson(request, 72 * 1024 * 1024);
      const value = await invoke(
        body.surface,
        body.method,
        body.args || [],
        body.argsEncoding,
      );
      sendJson(response, 200, { ok: true, value });
      return;
    }
    if (request.method === "POST" && url.pathname === "/settings-invoke") {
      const body = await readJson(request);
      const value = await invokeSettings(
        body.surface,
        body.method,
        body.args || [],
        body.argsEncoding,
      );
      sendJson(response, 200, { ok: true, value });
      return;
    }
    if (request.method === "POST" && url.pathname === "/store") {
      const body = await readJson(request);
      sendJson(response, 200, {
        ok: true,
        value: await readStore(body.surface, body.store),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/protocol") {
      const body = await readJson(request);
      sendJson(response, 200, {
        ok: true,
        value: await fetchOfficialProtocol(body),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/generate-title") {
      const body = await readJson(request);
      const value = await generateTitle(body.message, body.model);
      sendJson(response, 200, { ok: true, value });
      return;
    }
    sendJson(response, 404, { ok: false, error: "not found" });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[cowork-wrapper] internal bridge listening on ${HOST}:${PORT}`);
});
