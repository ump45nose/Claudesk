import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const serverSource = await readFile(new URL("../bridge/server.mjs", import.meta.url), "utf8");
const wrapperSource = await readFile(
  new URL("../bridge-wrapper/main.cjs", import.meta.url),
  "utf8",
);
const preloadSource = await readFile(
  new URL("../bridge/public/remote-preload.js", import.meta.url),
  "utf8",
);

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function evaluate(code, resultExpression, context = {}) {
  const sandbox = { ...context };
  vm.runInNewContext(`${code}\nresult = ${resultExpression};`, sandbox);
  return JSON.parse(JSON.stringify(sandbox.result));
}

function normalizedMap(name) {
  return `Object.fromEntries([...${name}]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => [key, [...values].sort()]))`;
}

const serverMethods = section(
  serverSource,
  "const allowedMethods = new Map([",
  "const allowedSettingsMethods",
);
const wrapperMethods = section(
  wrapperSource,
  "const allowedMethods = new Map([",
  "const allowedSettingsMethods",
);

for (let mask = 0; mask < 8; mask += 1) {
  const flags = {
    infrastructureActionsEnabled: Boolean(mask & 1),
    developerActionsEnabled: Boolean(mask & 2),
    codeActionsEnabled: Boolean(mask & 4),
  };
  const prelude = Object.entries(flags)
    .map(([name, value]) => `const ${name} = ${value};`)
    .join("\n");
  assert.deepEqual(
    evaluate(`${prelude}\n${serverMethods}`, normalizedMap("allowedMethods")),
    evaluate(`${prelude}\n${wrapperMethods}`, normalizedMap("allowedMethods")),
    `IPC method allowlists differ for capability mask ${mask}`,
  );
}

const serverSettings = section(
  serverSource,
  "const allowedSettingsMethods",
  "const remoteListenerMethods",
);
const wrapperSettings = section(
  wrapperSource,
  "const allowedSettingsMethods",
  "const allowedSurfaces",
);
for (const enabled of [false, true]) {
  const prelude = `const gatewaySettingsEnabled = ${enabled};`;
  assert.deepEqual(
    evaluate(`${prelude}\n${serverSettings}`, normalizedMap("allowedSettingsMethods")),
    evaluate(`${prelude}\n${wrapperSettings}`, normalizedMap("allowedSettingsMethods")),
    `Gateway settings allowlists differ when enabled=${enabled}`,
  );
}

const serverStores = section(serverSource, "const allowedStores", "const protocolRules");
const wrapperStores = section(wrapperSource, "const allowedStores", "const relayedListeners");
assert.deepEqual(
  evaluate(serverStores, normalizedMap("allowedStores")),
  evaluate(wrapperStores, normalizedMap("allowedStores")),
  "Desktop store allowlists differ",
);

const serverListeners = section(
  serverSource,
  "const remoteListenerMethods",
  "const allowedStores",
);
const wrapperListeners = section(
  wrapperSource,
  "const relayedListeners",
  "const relayedBootFeatures",
);
for (let mask = 0; mask < 4; mask += 1) {
  const developerActionsEnabled = Boolean(mask & 1);
  const codeActionsEnabled = Boolean(mask & 2);
  const prelude = `
    const developerActionsEnabled = ${developerActionsEnabled};
    const codeActionsEnabled = ${codeActionsEnabled};
  `;
  assert.deepEqual(
    evaluate(`${prelude}\n${serverListeners}`, normalizedMap("remoteListenerMethods")),
    evaluate(
      `${prelude}\n${wrapperListeners}`,
      normalizedMap("relayedListeners"),
      { randomBytes: () => ({ toString: () => "parity" }) },
    ),
    `Listener allowlists differ for capability mask ${mask}`,
  );
}

function normalizedProtocolRules(name) {
  return `${name}.map((rule) => ({
    methods: [...rule.methods].sort(),
    source: rule.path.source,
    flags: rule.path.flags,
  }))`;
}
const serverProtocols = section(serverSource, "const protocolRules", "const officialAssetPrefixes");
const wrapperProtocols = section(wrapperSource, "const protocolRules", "function sendJson");
assert.deepEqual(
  evaluate(serverProtocols, normalizedProtocolRules("protocolRules")),
  evaluate(wrapperProtocols, normalizedProtocolRules("protocolRules")),
  "Desktop protocol rules differ",
);

for (const removed of [
  "/api/cowork/invoke",
  "/api/cowork/surfaces",
]) assert.equal(serverSource.includes(removed), false, `${removed} remains in the outer bridge`);
assert.equal(wrapperSource.includes('url.pathname === "/describe"'), false, "/describe remains");
assert.equal(
  preloadSource.includes("async function bridgeRequest(path, body, { retryable = false } = {})"),
  true,
  "bridge requests must default to no retry",
);
for (const functionName of ["invoke", "invokeSettings", "uploadBrowserFiles", "relaunchDesktop"]) {
  const body = section(
    preloadSource,
    `function ${functionName}`,
    functionName === "invoke" ? "function invokeSettings" : "\n  function ",
  );
  assert.equal(body.includes("retryable: true"), false, `${functionName} must not retry`);
}

process.stdout.write("bridge-parity-smoke: outer and inner policies match\n");
