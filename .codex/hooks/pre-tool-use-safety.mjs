#!/usr/bin/env node
import { extractCommandFromPayload, readHookInput } from "./lib.mjs";

const input = readHookInput();
const command = extractCommandFromPayload(input.json, input.raw);
const normalized = command.replace(/\s+/g, " ").trim();
const lower = normalized.toLowerCase();

const blockers = [
  {
    pattern: /\bgit\s+push\b/,
    reason: "automatic push is not allowed for this project",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    reason: "destructive git reset is not allowed",
  },
  {
    pattern: /\bgit\s+clean\b/,
    reason: "destructive git clean is not allowed",
  },
  {
    pattern: /\bgit\s+checkout\s+--\b/,
    reason: "discarding file changes is not allowed",
  },
  {
    pattern: /\bgit\s+restore\b/,
    reason: "restoring files can discard work and is not allowed by hook policy",
  },
  {
    pattern: /\brm\s+(-[^\s]*r|--recursive|--force|-f)\b/,
    reason: "file deletion commands are not allowed",
  },
  {
    pattern: /\brm\s+[^\s|&;]/,
    reason: "file deletion commands are not allowed",
  },
  {
    pattern: /\bremove-item\b/i,
    reason: "file deletion commands are not allowed",
  },
  {
    pattern: /\b(?:del|erase|rmdir)\b/i,
    reason: "file deletion commands are not allowed",
  },
  {
    pattern: /\bnpm\s+(?:install|i|add)\s+(?:--save(?:-dev)?\s+|-D\s+|-S\s+)?[^\s-]/,
    reason: "new dependency installation requires explicit confirmation first",
  },
  {
    pattern: /\b(?:pnpm|yarn|bun)\s+add\b/,
    reason: "new dependency installation requires explicit confirmation first",
  },
  {
    pattern: /\b(?:pip|pip3)\s+install\s+[^\s-]/,
    reason: "new dependency installation requires explicit confirmation first",
  },
  {
    pattern: /\b(?:poetry|uv|cargo)\s+add\b/,
    reason: "new dependency installation requires explicit confirmation first",
  },
  {
    pattern: /\bcomposer\s+require\b/,
    reason: "new dependency installation requires explicit confirmation first",
  },
];

for (const blocker of blockers) {
  if (blocker.pattern.test(lower)) {
    console.error(`[codex-hooks] Blocked command: ${blocker.reason}.`);
    console.error(`[codex-hooks] Command: ${normalized}`);
    process.exit(2);
  }
}

process.exit(0);
