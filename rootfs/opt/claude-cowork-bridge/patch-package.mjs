import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [packagePath] = process.argv.slice(2);
if (!packagePath) throw new Error("package.json path is required");

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
if (packageJson.name !== "@ant/desktop") {
  throw new Error(`unexpected official package name: ${packageJson.name || "missing"}`);
}
if (!packageJson.main) throw new Error("official package main entry is missing");
packageJson.claudeCoworkBridgeOriginalMain = packageJson.main;
packageJson.main = "bridge-wrapper/loader.cjs";
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

const buildDir = join(dirname(packagePath), ".vite", "build");
const buildFiles = (await readdir(buildDir)).filter((name) =>
  (name.startsWith("index.chunk-") || name.startsWith("index2.chunk-"))
  && name.endsWith(".js")
);

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`Desktop 1.28929.0 patch target missing: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) {
    throw new Error(`Desktop 1.28929.0 patch target is ambiguous: ${label}`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

async function findChunk(label, requiredText) {
  const matches = [];
  for (const name of buildFiles) {
    const path = join(buildDir, name);
    const source = await readFile(path, "utf8");
    if (requiredText.every((text) => source.includes(text))) matches.push({ path, source });
  }
  if (matches.length !== 1) throw new Error(`expected one current ${label} chunk, found ${matches.length}`);
  return matches[0];
}

const chatRewindGuard = 'if(n.sessionType)return r.o.warn(`[Rewind] Rejected for session ${e} — sessionType=${n.sessionType} not supported`),null;';
const rewindChunk = await findChunk("Chat rewind guard", [chatRewindGuard]);
await writeFile(
  rewindChunk.path,
  replaceOnce(
    rewindChunk.source,
    chatRewindGuard,
    `if(n.sessionType&&n.sessionType!=="chat")${chatRewindGuard.slice("if(n.sessionType)".length)}`,
    "Chat rewind guard",
  ),
  "utf8",
);

if (process.env.CLAUDE_COWORK_HOST_BASH !== "1") process.exit(0);

const schedulerAnchor = "isReadyToDispatch:p.n,onNotReadyToDispatch:";
const schedulerChunk = await findChunk("scheduled task readiness", [schedulerAnchor, "VM not ready (tick"]);
await writeFile(
  schedulerChunk.path,
  replaceOnce(
    schedulerChunk.source,
    schedulerAnchor,
    'isReadyToDispatch:()=>process.env.CLAUDE_COWORK_HOST_BASH==="1"?Promise.resolve(!0):p.n(),onNotReadyToDispatch:',
    "scheduled task readiness",
  ),
  "utf8",
);

const helperAnchor = 'function Je(e){return{content:[{type:`text`,text:e}]}}';
const optionsAnchor = "tt({sessionId:r,sessionType:a,vmProcessName:h,computeBashMounts:Y,";
const handlerAnchor = "async(n,i)=>{let o=Date.now(),s=e.ensureVmReady(),";
const isolatedDescription = 'Run a shell command in the session\'s isolated Linux workspace. Your connected folders are mounted under /sessions/<session>/mnt/ — the Shell access section of your system prompt lists the exact path for each folder. Each bash call is independent (no cwd/env carryover). Use absolute paths. The workspace boots in the background and may not be ready on the first call; if so, you\'ll see \'Workspace still starting\' — wait a few seconds and retry.';
const containerDescription = 'Run a shell command directly in the Claude Desktop Linux container as the desktop service user. File tools and bash use the same absolute container paths. Each bash call is independent and starts in the current session outputs directory.';
const helper = `${helperAnchor}function claudeCoworkHostBashEnv(){const e={};for(const o of["PATH","HOME","USER","LOGNAME","SHELL","TERM","TZ","LANG","LC_ALL","TMPDIR","NODE_EXTRA_CA_CERTS","NODE_USE_SYSTEM_CA"])typeof process.env[o]==="string"&&(e[o]=process.env[o]);return e.PATH||(e.PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),e.HOME||(e.HOME="/config"),e.SHELL="/bin/bash",e.TMPDIR="/tmp",e}function claudeCoworkRunHostBash(e,o,n,r){return new Promise((a,i)=>{if(r!=null&&r.aborted){i(new Error("Cancelled."));return}let s="",m=!1;const h=w.spawn("/bin/bash",["-lc",e],{cwd:o,env:claudeCoworkHostBashEnv(),stdio:["ignore","pipe","pipe"],windowsHide:!0}),p=()=>{m||(m=!0,clearTimeout(f),r==null||r.removeEventListener("abort",g))},y=l=>{if(m)return;s+=l.toString("utf8"),Buffer.byteLength(s,"utf8")>Z&&(h.kill("SIGKILL"),p(),i(new Error("Command output exceeded 1 MB")))},g=()=>{h.kill("SIGTERM"),p(),i(new Error("Cancelled."))},f=setTimeout(()=>{h.kill("SIGKILL"),p(),i(new Error(\`Command timed out after \${n}ms\`))},n);h.stdout.on("data",y),h.stderr.on("data",y),h.once("error",l=>{p(),i(l)}),h.once("close",(l,w)=>{m||(p(),a({exitCode:Number.isInteger(l)?l:w?128:1,output:s}))}),r==null||r.addEventListener("abort",g,{once:!0})})}`;
const handlerReplacement = 'async(n,i)=>{let o=Date.now();if(process.env.CLAUDE_COWORK_HOST_BASH==="1")try{let r=await claudeCoworkRunHostBash(n.command,e.hostCwd,n.timeout_ms??Re,i?.signal),a=r.output.length>0?r.output:`(no output)`;return t.o.info(`${X} container bash done: exit=${r.exitCode}, duration=${Date.now()-o}ms, outputBytes=${r.output.length}`),r.exitCode===0?Je(a):Q(`Exit code ${r.exitCode}\\n${a}`)}catch(r){let a=r instanceof Error?r.message:String(r);return t.o.warn(`${X} container bash failed:`,r),Q(a)}let s=e.ensureVmReady(),';
const hostChunk = await findChunk("workspace Bash", [helperAnchor, handlerAnchor, optionsAnchor]);
let hostSource = replaceOnce(hostChunk.source, helperAnchor, helper, "host Bash helper");
hostSource = replaceOnce(hostSource, handlerAnchor, handlerReplacement, "workspace Bash handler");
hostSource = replaceOnce(
  hostSource,
  optionsAnchor,
  "tt({sessionId:r,sessionType:a,vmProcessName:h,hostCwd:y,computeBashMounts:Y,",
  "host cwd wiring",
);
hostSource = replaceOnce(
  hostSource,
  `\`${isolatedDescription}\``,
  `\`${containerDescription}\``,
  "workspace Bash description",
);
await writeFile(hostChunk.path, hostSource, "utf8");

const startVmAnchor = 'Me=()=>De&&!ke?Promise.resolve():(Ae||(Ae=ge.f(),Ae.catch(()=>{De&&(Ae=void 0)})),Ae);';
const cachedPromptAnchor = "de=!bo(M,ae)||So(M,N,P)||xo(M,!ue)||Co(M,re)";
const sessionChunk = await findChunk("session startup", [startVmAnchor, cachedPromptAnchor]);
let sessionSource = replaceOnce(
  sessionChunk.source,
  startVmAnchor,
  `Me=()=>process.env.CLAUDE_COWORK_HOST_BASH==="1"?Promise.resolve():${startVmAnchor.slice("Me=()=>".length)}`,
  "session VM startup",
);
sessionSource = replaceOnce(
  sessionSource,
  cachedPromptAnchor,
  `de=process.env.CLAUDE_COWORK_HOST_BASH==="1"||${cachedPromptAnchor.slice(3)}`,
  "cached VM prompt invalidation",
);
await writeFile(sessionChunk.path, sessionSource, "utf8");

const vmCoreAnchor = "async function Ft(e,n,r,o){let c=$(),g=Date.now(),";
const vmCoreChunk = await findChunk("VM core startup", [vmCoreAnchor]);
await writeFile(
  vmCoreChunk.path,
  replaceOnce(
    vmCoreChunk.source,
    vmCoreAnchor,
    'async function Ft(e,n,r,o){if(process.env.CLAUDE_COWORK_HOST_BASH==="1")return;let c=$(),g=Date.now(),',
    "VM core startup",
  ),
  "utf8",
);

const promptStart = 'B(`host_loop_shell`,`\\n\\n## Shell access';
const promptEnd = ")}return z.base=V.length";
const promptChunk = await findChunk("host-loop prompt", [promptStart, promptEnd]);
const promptStartIndex = promptChunk.source.indexOf(promptStart);
const promptEndIndex = promptChunk.source.indexOf(promptEnd, promptStartIndex);
const containerPrompt = 'B(`host_loop_shell`,`\\n\\n## Shell access\\n\\nShell commands use \\`mcp__${b.Tt}__${b.wt}\\` and run directly inside the Claude Desktop Linux container as the desktop service user. Each call is independent — no cwd or environment carryover.\\n\\nThe shell starts in \\`${G}\\`. File tools and bash use the same absolute container paths; do not translate paths to \\`/sessions/.../mnt/\\`. Persistent user files belong under \\`/workspace\\` or the current session outputs directory. Do not inspect credentials or unrelated files under \\`/config\\`.\\n`)';
let promptSource = `${promptChunk.source.slice(0, promptStartIndex)}${containerPrompt}${promptChunk.source.slice(promptEndIndex + 1)}`;
promptSource = replaceOnce(
  promptSource,
  'Shell commands run via \\`mcp__${b.Tt}__${b.wt}\\` in an isolated Linux environment where those folders are mounted under \\`${i}/mnt/\\`.',
  'Shell commands run via \\`mcp__${b.Tt}__${b.wt}\\` directly inside the Claude Desktop Linux container. File tools and bash use the same absolute container paths.',
  "subagent host Bash prompt",
);
await writeFile(promptChunk.path, promptSource, "utf8");
