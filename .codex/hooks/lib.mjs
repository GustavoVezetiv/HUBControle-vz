import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const LOCAL_ONLY_PREFIXES = [
  ".codex/backups/",
  ".codex/state/",
  ".next/",
  "node_modules/",
];

export const CODE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
]);

export const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);

export const BINARY_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".svg",
  ".webp",
]);

const PATH_KEYS = new Set([
  "file",
  "file_path",
  "filename",
  "path",
  "relative_path",
  "target_file",
]);

export function repoRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    shell: false,
  });

  if (result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }

  return path.resolve(cwd);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: false,
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 16,
  });

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function runGit(root, args, options = {}) {
  return run("git", args, { cwd: root, ...options });
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readHookInput() {
  let text = "";
  try {
    if (!process.stdin.isTTY) {
      text = fs.readFileSync(0, "utf8");
    }
  } catch {
    text = "";
  }

  if (!text.trim()) {
    return { raw: "", json: null };
  }

  try {
    return { raw: text, json: JSON.parse(text) };
  } catch {
    return { raw: text, json: null };
  }
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function normalizeRepoPath(root, candidate) {
  if (typeof candidate !== "string") return null;

  let value = candidate.trim();
  if (!value || value === "/dev/null") return null;

  value = value.replace(/^['"]|['"]$/g, "");
  value = value.replace(/^([ab])\//, "");
  value = value.split(/\t/)[0].trim();

  if (!value || value === "/dev/null") return null;

  const absolute = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(root, value);
  const relative = path.relative(root, absolute);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return toPosix(relative);
}

export function isLocalOnly(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  return LOCAL_ONLY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isRelevantForBackup(relPath) {
  if (isLocalOnly(relPath)) return false;
  if (relPath.startsWith(".git/")) return false;

  const ext = path.extname(relPath).toLowerCase();
  return (
    CODE_EXTENSIONS.has(ext) ||
    DOC_EXTENSIONS.has(ext) ||
    BINARY_ASSET_EXTENSIONS.has(ext) ||
    relPath === ".gitignore" ||
    relPath === "AGENTS.md" ||
    relPath.startsWith("docs/") ||
    relPath.startsWith("scripts/") ||
    relPath.startsWith("src/") ||
    relPath.startsWith("supabase/")
  );
}

export function isBinaryAsset(relPath) {
  return BINARY_ASSET_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}

export function getGitStatus(root) {
  const result = runGit(root, ["status", "--porcelain=v1"]);
  if (!result.ok) return [];

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      let relPath = line.slice(3).trim();
      if (relPath.includes(" -> ")) {
        relPath = relPath.split(" -> ").pop().trim();
      }
      relPath = relPath.replace(/^"|"$/g, "");
      return {
        status,
        path: relPath.replace(/\\/g, "/"),
        raw: line,
      };
    })
    .filter((entry) => entry.path);
}

export function getHead(root) {
  const result = runGit(root, ["rev-parse", "--short", "HEAD"]);
  return result.ok ? result.stdout.trim() : "unknown";
}

export function getBranch(root) {
  const result = runGit(root, ["branch", "--show-current"]);
  return result.ok ? result.stdout.trim() : "";
}

export function extractPathsFromText(root, text) {
  if (!text) return [];

  const paths = new Set();
  const patchLine =
    /^(?:\*\*\* (?:Add|Delete|Update) File:|---|\+\+\+) ?(.+)$/gm;

  for (const match of text.matchAll(patchLine)) {
    const normalized = normalizeRepoPath(root, match[1]);
    if (normalized) paths.add(normalized);
  }

  return [...paths];
}

export function extractPathsFromPayload(root, payload, raw = "") {
  const paths = new Set(extractPathsFromText(root, raw));

  function visit(value, key = "") {
    if (value == null) return;

    if (typeof value === "string") {
      if (PATH_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes("file")) {
        const normalized = normalizeRepoPath(root, value);
        if (normalized) paths.add(normalized);
      }

      for (const relPath of extractPathsFromText(root, value)) {
        paths.add(relPath);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }

    if (typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => {
        visit(childValue, childKey);
      });
    }
  }

  visit(payload);
  return [...paths];
}

export function extractCommandFromPayload(payload, raw = "") {
  const candidates = [];

  function visit(value, key = "") {
    if (value == null) return;
    if (typeof value === "string") {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === "command" ||
        normalizedKey === "cmd" ||
        normalizedKey === "script"
      ) {
        candidates.push(value);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }

    if (typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) => {
        visit(childValue, childKey);
      });
    }
  }

  visit(payload);
  if (candidates.length) return candidates[0];

  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }

  return "";
}

export function detectTestCommand(root) {
  const packageJson = readJson(path.join(root, "package.json"), null);
  if (packageJson?.scripts?.test) {
    return { command: "npm", args: ["test"], label: "npm test" };
  }
  if (packageJson?.scripts?.lint) {
    return { command: "npm", args: ["run", "lint"], label: "npm run lint" };
  }

  const pytestFiles = [
    "pytest.ini",
    "pyproject.toml",
    "setup.cfg",
    "tox.ini",
  ];
  if (pytestFiles.some((file) => fs.existsSync(path.join(root, file)))) {
    return { command: "python", args: ["-m", "pytest"], label: "python -m pytest" };
  }

  if (fs.existsSync(path.join(root, "manage.py"))) {
    return {
      command: "python",
      args: ["manage.py", "test"],
      label: "python manage.py test",
    };
  }

  return null;
}

export function fileNeedsCodeValidation(relPath) {
  const ext = path.extname(relPath).toLowerCase();
  return (
    CODE_EXTENSIONS.has(ext) ||
    relPath === "package-lock.json" ||
    relPath === "package.json" ||
    relPath === "next.config.ts" ||
    relPath === "eslint.config.mjs" ||
    relPath.startsWith("scripts/") ||
    relPath.startsWith("src/") ||
    relPath.startsWith("supabase/migrations/")
  );
}

export function fileNeedsDocsReview(relPath) {
  return (
    relPath.startsWith("supabase/migrations/") ||
    relPath.startsWith("scripts/") ||
    relPath.startsWith("src/app/api/") ||
    relPath.includes("/queries.") ||
    relPath.includes("/types.") ||
    relPath.includes("import-engine") ||
    relPath.includes("financial-summary") ||
    relPath.includes("simulator")
  );
}

export function isDocsFile(relPath) {
  return (
    relPath === "README.md" ||
    relPath === "AGENTS.md" ||
    relPath.startsWith("docs/") ||
    DOC_EXTENSIONS.has(path.extname(relPath).toLowerCase())
  );
}

export function sanitizeForList(items, fallback = "_none_") {
  if (!items.length) return `- ${fallback}`;
  return items.map((item) => `- \`${item}\``).join("\n");
}

export function uniqueFilePath(baseFile) {
  if (!fs.existsSync(baseFile)) return baseFile;

  const parsed = path.parse(baseFile);
  for (let index = 2; index < 1000; index += 1) {
    const next = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(next)) return next;
  }

  throw new Error(`Could not allocate unique file path for ${baseFile}`);
}
