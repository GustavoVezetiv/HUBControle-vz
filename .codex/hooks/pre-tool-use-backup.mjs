#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  ensureDir,
  extractPathsFromPayload,
  getBranch,
  getGitStatus,
  getHead,
  isRelevantForBackup,
  readHookInput,
  repoRoot,
  runGit,
  timestamp,
  uniqueFilePath,
  writeJson,
} from "./lib.mjs";

const root = repoRoot();
const input = readHookInput();
const requestedPaths = extractPathsFromPayload(root, input.json, input.raw);

const dirtyFallbackPaths = getGitStatus(root)
  .map((entry) => entry.path)
  .filter((relPath) => isRelevantForBackup(relPath));

const paths = [...new Set([...requestedPaths, ...dirtyFallbackPaths])]
  .filter((relPath) => isRelevantForBackup(relPath))
  .sort();

const backupRoot = uniqueFilePath(
  path.join(root, ".codex", "backups", `pre-edit-${timestamp()}`),
);
ensureDir(backupRoot);

const backedUp = [];
const skipped = [];

for (const relPath of paths) {
  const source = path.join(root, relPath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    skipped.push({ path: relPath, reason: "missing-or-not-a-file" });
    continue;
  }

  const destination = path.join(backupRoot, relPath);
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  backedUp.push(relPath);
}

const diff = runGit(root, ["diff", "--binary"]);
if (diff.stdout.trim()) {
  fs.writeFileSync(path.join(backupRoot, "pre-edit.diff"), diff.stdout, "utf8");
}

writeJson(path.join(backupRoot, "manifest.json"), {
  backedUp,
  branch: getBranch(root),
  createdAt: new Date().toISOString(),
  gitHead: getHead(root),
  skipped,
});

console.log(
  `[codex-hooks] Backup snapshot created at ${path.relative(root, backupRoot)} (${backedUp.length} file(s)).`,
);
