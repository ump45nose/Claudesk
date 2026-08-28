import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const ionRoot = resolve("/usr/lib/claude-desktop/resources/ion-dist");
const stateRoot = resolve("/var/lib/claude-cowork-bridge/renderer");
const release = JSON.parse(readFileSync("/opt/claude-cowork-bridge/release.json", "utf8"));
const installedVersion = process.env.CLAUDE_DESKTOP_VERSION || "";

if (!/^\d+\.\d+\.\d+$/.test(installedVersion)) {
  throw new Error("CLAUDE_DESKTOP_VERSION must be an exact three-part version");
}
if (installedVersion !== release.desktopVersion) {
  throw new Error(
    `release supports Desktop ${release.desktopVersion}, installed ${installedVersion}`,
  );
}
if (!/^\d{8}-\d+$/.test(release.patchRelease)) {
  throw new Error("patchRelease is invalid");
}

const outputRoot = resolve(stateRoot, installedVersion, release.patchRelease);
if (!outputRoot.startsWith(`${stateRoot}/`)) throw new Error("renderer output escaped state root");

const replacements = [
  {
    id: "cowork-edit-feature",
    target: 'ls=Y("cowork_edit_message_button")',
    replacement: "ls=true",
  },
  {
    id: "cowork-rewind-capability",
    target: "Ps=Ce?os&&void 0!==ie:!!x?.rewind",
    replacement: "Ps=void 0!==ie||!!x?.rewind",
  },
  {
    id: "cowork-rewind-execution",
    target: 'if(Ce){if(void 0===ie)return{kind:"error",error:new Error("rewindSession unavailable")};const e=ca(Q,n.uuid);',
    replacement: "if(Ce&&void 0!==ie){const e=ca(Q,n.uuid);",
  },
  {
    id: "cowork-edit-affordance",
    target: "Fs=ls&&!Ce&&!Ts",
    replacement: "Fs=ls&&!Ts",
  },
  {
    id: "cowork-message-edit-visibility",
    target: "D=U&&!m&&!B&&u&&d&&l&&!e.sendFailed&&!R&&(M?j&&r&&!_:!!e.parent_message_uuid)",
    replacement: "D=U&&!m&&!B&&u&&d&&l&&!e.sendFailed&&!R&&(M?v&&!_:v)",
  },
  {
    id: "ask-question-provider",
    target: 'T=(0,od.useCallback)((e,t)=>{if(!n)return;const s=n.questions.find(t=>t.id===e);if(!s)return;const a="multi_select"!==s.type&&"rank_priorities"!==s.type,i=1===n.questions.length,l=c===n.questions.length-1;',
    replacement: 'T=(0,od.useCallback)((e,t,q)=>{if(!n)return;const s=n.questions.find(t=>t.id===e);if(!s)return;const a="multi_select"!==s.type&&"rank_priorities"!==s.type,i=1===n.questions.length,l=void 0===q?c===n.questions.length-1:q;',
  },
  {
    id: "ask-question-pointer",
    target: 'l(F.id,e),U||setTimeout(()=>{S("left"),i(o+1),L()},150)',
    replacement: 'l(F.id,e,U),U||setTimeout(()=>{S("left"),i(o+1),L()},150)',
  },
  {
    id: "ask-question-keyboard",
    target: '(l(F.id,t.id),U||setTimeout(()=>{S("left"),i(o+1),L()},150))',
    replacement: '(l(F.id,t.id,U),U||setTimeout(()=>{S("left"),i(o+1),L()},150))',
  },
  {
    id: "code-edit-icon",
    target: 'icon:"ArrowUndoUp",disabled:void 0!==s,"aria-label":n.formatMessage({defaultMessage:"Rewind to here",id:"jlXY1qCwxf"})',
    replacement: 'icon:"Edit","data-testid":"code-action-bar-edit",disabled:void 0!==s,"aria-label":n.formatMessage({defaultMessage:"Edit",id:"wEQDC6Wv3/"})',
  },
  {
    id: "code-edit-visibility",
    target: 'false,a&&(0,eP.jsx)(UG,{onRewind:a,buttonVariant:c})',
    replacement: 'a&&(0,eP.jsx)(UG,{onRewind:a,buttonVariant:c})',
  },
];

if (process.env.CLAUDE_REMOTE_GATEWAY_SETTINGS === "1") {
  replacements.push({
    id: "gateway-setup-signin-web-guard",
    target: 'g=i&&"app:"===window.location.protocol;',
    replacement: 'g=i&&("app:"===window.location.protocol||globalThis.__CLAUDE_REMOTE_BOOTSTRAP__?.gatewaySettingsEnabled===true);',
  });
  replacements.push({
    id: "gateway-setup-route-web-guard",
    target: 't="undefined"!=typeof window&&"app:"===window.location.protocol;',
    replacement: 't="undefined"!=typeof window&&("app:"===window.location.protocol||globalThis.__CLAUDE_REMOTE_BOOTSTRAP__?.gatewaySettingsEnabled===true);',
  });
}

const requiredMarkers = [
  { id: "cowork-native-edit-handler", value: "editMessage:As&&!i?oa:void 0" },
  { id: "cowork-native-resend", value: "isResend:!0" },
  { id: "code-native-rewind-v2", value: "rewindV2" },
  { id: "ime-keycode-229", value: "229===e.keyCode" },
  { id: "ime-composition-window", value: "Math.abs(e.timeStamp-zp)<500" },
  { id: "toast-auto-dismiss", value: "duration:r=6500" },
];

async function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

function countOccurrences(source, target) {
  let count = 0;
  let offset = 0;
  while ((offset = source.indexOf(target, offset)) >= 0) {
    count += 1;
    offset += target.length;
  }
  return count;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

await rm(stateRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const files = await listJavaScriptFiles(ionRoot);
const sources = new Map();
for (const file of files) sources.set(file, await readFile(file, "utf8"));
const officialSources = new Map(sources);

const patchRecords = [];
for (const spec of replacements) {
  const matches = [];
  for (const [file, source] of sources) {
    const count = countOccurrences(source, spec.target);
    if (count) matches.push({ file, count });
  }
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (total !== 1) {
    throw new Error(`renderer anchor ${spec.id} expected once, found ${total}`);
  }
  const file = matches[0].file;
  const input = sources.get(file);
  const output = input.replace(spec.target, spec.replacement);
  sources.set(file, output);
  patchRecords.push({
    id: spec.id,
    path: relative(ionRoot, file),
    inputSha256: sha256(input),
    outputSha256: sha256(output),
  });
}

const markerRecords = [];
for (const marker of requiredMarkers) {
  const matches = [];
  for (const [file, source] of sources) {
    const count = countOccurrences(source, marker.value);
    if (count) matches.push({ path: relative(ionRoot, file), count });
  }
  const total = matches.reduce((sum, match) => sum + match.count, 0);
  if (total < 1) throw new Error(`required renderer marker ${marker.id} is missing`);
  markerRecords.push({ id: marker.id, value: marker.value, matches });
}

const changedFiles = new Set(patchRecords.map((record) => record.path));
const generatedFiles = [];
for (const relativePath of changedFiles) {
  const destination = resolve(outputRoot, relativePath);
  const officialSource = officialSources.get(resolve(ionRoot, relativePath));
  const generatedSource = sources.get(resolve(ionRoot, relativePath));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, generatedSource, { mode: 0o644 });
  generatedFiles.push({
    path: relativePath,
    inputSha256: sha256(officialSource),
    outputSha256: sha256(generatedSource),
  });
}

const manifest = {
  desktopVersion: installedVersion,
  patchRelease: release.patchRelease,
  basePath: `/renderer/${installedVersion}/${release.patchRelease}`,
  generatedAt: new Date().toISOString(),
  patches: patchRecords,
  files: generatedFiles,
  markers: markerRecords,
};
await writeFile(
  resolve(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
await writeFile(resolve(stateRoot, "current.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o644 });
console.log(`[renderer-prepare] ready ${manifest.basePath}; patches=${patchRecords.length}`);
