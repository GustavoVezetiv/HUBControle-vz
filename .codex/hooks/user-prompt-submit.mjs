#!/usr/bin/env node
import path from "node:path";
import {
  getBranch,
  getGitStatus,
  getHead,
  readHookInput,
  repoRoot,
  writeJson,
} from "./lib.mjs";

const root = repoRoot();
const statePath = path.join(root, ".codex", "state", "session-baseline.json");
const input = readHookInput();

const promptLength = input.raw.length;
const dirtyFiles = getGitStatus(root)
  .filter((entry) => !entry.path.startsWith(".codex/state/"))
  .map((entry) => entry.path);

writeJson(statePath, {
  branch: getBranch(root),
  dirtyFiles,
  head: getHead(root),
  promptLength,
  startedAt: new Date().toISOString(),
});

console.log(
  `[codex-hooks] Baseline recorded with ${dirtyFiles.length} dirty file(s).`,
);
