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

if (process.env.CLAUDE_COWORK_HOST_BASH !== "1") process.exit(0);

const buildDir = join(dirname(packagePath), ".vite", "build");
const buildFiles = (await readdir(buildDir))
  .filter((name) => name.startsWith("index.chunk-") && name.endsWith(".js"));

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first === -1) throw new Error(`host Bash patch target missing: ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) {
    throw new Error(`host Bash patch target is ambiguous: ${label}`);
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
  if (matches.length !== 1) {
    throw new Error(`expected one ${label} chunk, found ${matches.length}`);
  }
  return matches[0];
}

const hostBashHelperAnchor = 'function Xe(e){return{content:[{type:"text",text:e}]}}';
const hostBashHelper = `${hostBashHelperAnchor}function claudeCoworkHostBashEnv(){const e={};for(const o of["PATH","HOME","USER","LOGNAME","SHELL","TERM","TZ","LANG","LC_ALL","TMPDIR","NODE_EXTRA_CA_CERTS","NODE_USE_SYSTEM_CA"])typeof process.env[o]==="string"&&(e[o]=process.env[o]);return e.PATH||(e.PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),e.HOME||(e.HOME="/config"),e.SHELL="/bin/bash",e.TMPDIR="/tmp",e}function claudeCoworkRunHostBash(e,o,n,r){return new Promise((a,i)=>{if(r!=null&&r.aborted){i(new Error("Cancelled."));return}let s="",m=!1;const h=gt.spawn("/bin/bash",["-lc",e],{cwd:o,env:claudeCoworkHostBashEnv(),stdio:["ignore","pipe","pipe"],windowsHide:!0}),p=()=>{m||(m=!0,clearTimeout(f),r==null||r.removeEventListener("abort",g))},y=l=>{if(m)return;s+=l.toString("utf8"),Buffer.byteLength(s,"utf8")>ne&&(h.kill("SIGKILL"),p(),i(new Error("Command output exceeded 1 MB")))},g=()=>{h.kill("SIGTERM"),p(),i(new Error("Cancelled."))},f=setTimeout(()=>{h.kill("SIGKILL"),p(),i(new Error(\`Command timed out after \${n}ms\`))},n);h.stdout.on("data",y),h.stderr.on("data",y),h.once("error",l=>{p(),i(l)}),h.once("close",(l,w)=>{m||(p(),a({exitCode:Number.isInteger(l)?l:w?128:1,output:s}))}),r==null||r.addEventListener("abort",g,{once:!0})})}`;

const hostHandlerAnchor = 'async(s,m)=>{var F,N,H,j,B,R;const h=Date.now(),p=e.ensureVmReady(),';
const hostHandlerReplacement = 'async(s,m)=>{var F,N,H,j,B,R;const h=Date.now();if(process.env.CLAUDE_COWORK_HOST_BASH==="1")try{const d=await claudeCoworkRunHostBash(s.command,e.hostCwd,s.timeout_ms??fe,m==null?void 0:m.signal),E=d.output.length>0?d.output:"(no output)";return t.logger.info(`${q} container bash done: exit=${d.exitCode}, duration=${Date.now()-h}ms, outputBytes=${d.output.length}`),V(e,t.WORKSPACE_BASH,h,d.exitCode!==0,void 0,{execution_mode:"container_host"}),d.exitCode===0?Xe(E):C(`Exit code ${d.exitCode}\\n${E}`)}catch(d){const E=d instanceof Error?d.message:String(d);return t.logger.warn(`${q} container bash failed:`,d),V(e,t.WORKSPACE_BASH,h,!0,void 0,{execution_mode:"container_host"}),C(E)}const p=e.ensureVmReady(),';
const hostOptionsAnchor = 'to({sessionId:n,sessionType:r,vmProcessName:a,computeBashMounts:ke,';
const hostOptionsReplacement = 'to({sessionId:n,sessionType:r,vmProcessName:a,hostCwd:s,computeBashMounts:ke,';
const isolatedDescription = 'Run a shell command in the session\'s isolated Linux workspace. Your connected folders are mounted under /sessions/<session>/mnt/ — the Shell access section of your system prompt lists the exact path for each folder. Each bash call is independent (no cwd/env carryover). Use absolute paths. The workspace boots in the background and may not be ready on the first call; if so, you\'ll see \'Workspace still starting\' — wait a few seconds and retry.';
const containerDescription = 'Run a shell command directly in the Claude Desktop Linux container as the desktop service user. File tools and bash use the same absolute container paths. Each bash call is independent and starts in the current session outputs directory.';

const hostChunk = await findChunk("workspace Bash", [
  hostBashHelperAnchor,
  hostHandlerAnchor,
  hostOptionsAnchor,
]);
let hostSource = hostChunk.source;
hostSource = replaceOnce(hostSource, hostBashHelperAnchor, hostBashHelper, "host Bash helper");
hostSource = replaceOnce(hostSource, hostHandlerAnchor, hostHandlerReplacement, "workspace Bash handler");
hostSource = replaceOnce(hostSource, hostOptionsAnchor, hostOptionsReplacement, "host cwd wiring");
hostSource = replaceOnce(
  hostSource,
  JSON.stringify(isolatedDescription),
  JSON.stringify(containerDescription),
  "workspace Bash description",
);
await writeFile(hostChunk.path, hostSource, "utf8");

const startVmAnchor = 'const Me=()=>fe&&!Ue?Promise.resolve():(De||(De=o.startVM(),De.catch(()=>{fe&&(De=void 0)})),De);';
const cachedPromptAnchor = 'Y=!ft(P,U)||ln(P,N,V)';
const sessionChunk = await findChunk("session startup", [startVmAnchor, cachedPromptAnchor]);
let sessionSource = replaceOnce(
  sessionChunk.source,
  startVmAnchor,
  `const Me=()=>process.env.CLAUDE_COWORK_HOST_BASH==="1"?Promise.resolve():${startVmAnchor.slice("const Me=()=>".length)}`,
  "session VM startup",
);
sessionSource = replaceOnce(
  sessionSource,
  cachedPromptAnchor,
  `Y=process.env.CLAUDE_COWORK_HOST_BASH==="1"||${cachedPromptAnchor.slice(2)}`,
  "cached VM prompt invalidation",
);
await writeFile(sessionChunk.path, sessionSource, "utf8");

const vmCoreAnchor = 'async function X1(e,t,n){const r=Date.now();';
const vmCoreChunk = await findChunk("VM core startup", [vmCoreAnchor]);
const vmCoreSource = replaceOnce(
  vmCoreChunk.source,
  vmCoreAnchor,
  'async function X1(e,t,n){if(process.env.CLAUDE_COWORK_HOST_BASH==="1"){pe.info("[startVM] Container-host Bash enabled, skipping VM start");return}const r=Date.now();',
  "VM core startup",
);
await writeFile(vmCoreChunk.path, vmCoreSource, "utf8");

const promptStart = 'F("host_loop_shell",`\n\n## Shell access';
const promptEnd = ')}return re.base=$.length';
const promptChunk = await findChunk("host-loop prompt", [promptStart, promptEnd]);
const promptStartIndex = promptChunk.source.indexOf(promptStart);
const promptEndIndex = promptChunk.source.indexOf(promptEnd, promptStartIndex);
if (promptStartIndex === -1 || promptEndIndex === -1) {
  throw new Error("host Bash prompt boundary is missing");
}
const containerPrompt = 'F("host_loop_shell",`\n\n## Shell access\n\nShell commands use \\`mcp__${n.WORKSPACE_MCP_SERVER}__${n.WORKSPACE_BASH}\\` and run directly inside the Claude Desktop Linux container as the desktop service user. Each call is independent — no cwd or environment carryover.\n\nThe shell starts in \\`${q}\\`. File tools and bash use the same absolute container paths; do not translate paths to \\`/sessions/.../mnt/\\`. Persistent user files belong under \\`/workspace\\` or the current session outputs directory. Do not inspect credentials or unrelated files under \\`/config\\`.\n`)';
let promptSource = `${promptChunk.source.slice(0, promptStartIndex)}${containerPrompt}${promptChunk.source.slice(promptEndIndex + 1)}`;
const subagentPromptAnchor = 'Shell commands run via \\`mcp__${n.WORKSPACE_MCP_SERVER}__${n.WORKSPACE_BASH}\\` in an isolated Linux environment where those folders are mounted under \\`${o}/mnt/\\`.';
const subagentPromptReplacement = 'Shell commands run via \\`mcp__${n.WORKSPACE_MCP_SERVER}__${n.WORKSPACE_BASH}\\` directly inside the Claude Desktop Linux container. File tools and bash use the same absolute container paths.';
promptSource = replaceOnce(
  promptSource,
  subagentPromptAnchor,
  subagentPromptReplacement,
  "subagent host Bash prompt",
);
await writeFile(promptChunk.path, promptSource, "utf8");
