import { readFile, writeFile } from "node:fs/promises";

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
