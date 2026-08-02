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

// The packaged renderer already contains the complete Chat edit/retry flow,
// and LocalAgentModeSessionManager already implements the matching rewind.
// The current Linux package blocks every typed session before that code runs.
// Open only `sessionType: "chat"`; Cowork, scheduled tasks, and any future
// typed session remain behind the official guard. Exact matching makes an
// upstream minification or semantic change fail closed during startup.
const buildDir = join(dirname(packagePath), ".vite", "build");
const rewindGuard = 'if(s.sessionType)return o.logger.warn(`[Rewind] Rejected for session ${e} — sessionType=${s.sessionType} not supported`),null;';
const chatRewindGuard = 'if(s.sessionType&&"chat"!==s.sessionType)return o.logger.warn(`[Rewind] Rejected for session ${e} — sessionType=${s.sessionType} not supported`),null;';
const rewindGuardHits = [];
for (const name of await readdir(buildDir)) {
  if (!/^index\.chunk-[A-Za-z0-9_-]+\.js$/.test(name)) continue;
  const path = join(buildDir, name);
  const source = await readFile(path, "utf8");
  const first = source.indexOf(rewindGuard);
  if (first < 0) continue;
  if (source.indexOf(rewindGuard, first + rewindGuard.length) >= 0) {
    throw new Error(`official Chat rewind guard is duplicated in ${name}`);
  }
  rewindGuardHits.push({ path, source });
}
if (rewindGuardHits.length !== 1) {
  throw new Error(
    `expected one official Chat rewind guard, found ${rewindGuardHits.length}`,
  );
}
await writeFile(
  rewindGuardHits[0].path,
  rewindGuardHits[0].source.replace(rewindGuard, chatRewindGuard),
  "utf8",
);

await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
