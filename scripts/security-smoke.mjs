import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContainedRealPath } from "../bridge/downloads.mjs";

const fixtureRoot = await mkdtemp(join(tmpdir(), "claudesk-security-smoke-"));
try {
  const allowedRoot = join(fixtureRoot, "workspace");
  const outsideRoot = join(fixtureRoot, "outside");
  await Promise.all([mkdir(allowedRoot), mkdir(outsideRoot)]);
  const allowedFile = join(allowedRoot, "allowed.txt");
  const outsideFile = join(outsideRoot, "private.txt");
  await Promise.all([
    writeFile(allowedFile, "allowed"),
    writeFile(outsideFile, "private"),
  ]);

  assert.equal(
    await resolveContainedRealPath(allowedRoot, allowedFile, { allowRoot: false }),
    await realpath(allowedFile),
  );

  await assert.rejects(
    resolveContainedRealPath(allowedRoot, join(allowedRoot, "missing.txt")),
    (error) => error?.statusCode === 404,
  );
  await assert.rejects(
    resolveContainedRealPath(allowedRoot, allowedRoot, { allowRoot: false }),
    (error) => error?.statusCode === 403,
  );

  const outsideLink = join(allowedRoot, "outside-link.txt");
  await symlink(outsideFile, outsideLink);
  await assert.rejects(
    resolveContainedRealPath(allowedRoot, outsideLink),
    (error) => error?.statusCode === 403,
  );

  process.stdout.write("security-smoke: canonical path checks passed\n");
} finally {
  await rm(fixtureRoot, { force: true, recursive: true });
}
