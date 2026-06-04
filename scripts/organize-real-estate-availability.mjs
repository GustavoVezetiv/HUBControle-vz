#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));

if (!args.input) {
  fail("Usage: node scripts/organize-real-estate-availability.mjs --input <file> [--output <file>]");
}

const source = fs.readFileSync(args.input, "utf8");
const records = parseRecords(source);
const markdown = renderMarkdown(records, args.input);

if (args.output) {
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, markdown, "utf8");
} else {
  process.stdout.write(markdown);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") parsed.input = argv[++index];
    else if (arg === "--output") parsed.output = argv[++index];
  }
  return parsed;
}

function parseRecords(source) {
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return parsed.map(normalizeRecord);
    if (Array.isArray(parsed.items)) return parsed.items.map(normalizeRecord);
    return [normalizeRecord(parsed)];
  } catch {
    return parseKeyValueText(source);
  }
}

function parseKeyValueText(source) {
  const chunks = source
    .split(/\n\s*(?:---+|#{2,}\s+.+)\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  return chunks.map((chunk) => {
    const record = {};
    for (const line of chunk.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[-*]\s*)?([^:]+):\s*(.+?)\s*$/);
      if (!match) continue;
      record[toKey(match[1])] = match[2].trim();
    }
    return normalizeRecord(record);
  });
}

function normalizeRecord(record) {
  const normalized = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      const filtered = value.map(String).map((item) => item.trim()).filter(Boolean);
      if (filtered.length) normalized[toKey(key)] = filtered;
      continue;
    }

    const text = String(value).trim();
    if (!text || /^n\/?a$/i.test(text) || /^sem informacao$/i.test(text)) continue;
    normalized[toKey(key)] = text;
  }
  return normalized;
}

function toKey(key) {
  return String(key)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function renderMarkdown(records, inputPath) {
  const fieldOrder = [
    ["empreendimento", "Empreendimento"],
    ["imovel", "Imovel"],
    ["unidade", "Unidade"],
    ["torre", "Torre"],
    ["andar", "Andar"],
    ["tipologia", "Tipologia"],
    ["area", "Area"],
    ["area_privativa", "Area privativa"],
    ["quartos", "Quartos"],
    ["suites", "Suites"],
    ["banheiros", "Banheiros"],
    ["vagas", "Vagas"],
    ["valor", "Valor"],
    ["preco", "Preco"],
    ["condominio", "Condominio"],
    ["iptu", "IPTU"],
    ["disponibilidade", "Disponibilidade"],
    ["status", "Status"],
    ["prazo", "Prazo"],
    ["contato", "Contato"],
    ["observacoes", "Observacoes"],
  ];

  const pending = [];
  const sections = records
    .filter((record) => Object.keys(record).length)
    .map((record, index) => {
      const title =
        record.empreendimento ||
        record.imovel ||
        record.unidade ||
        `Item ${index + 1}`;
      const lines = [`### ${title}`];

      for (const [key, label] of fieldOrder) {
        appendField(lines, label, record[key]);
      }

      for (const [key, value] of Object.entries(record)) {
        if (fieldOrder.some(([knownKey]) => knownKey === key)) continue;
        if (isPendingKey(key)) {
          pending.push(...toList(value).map((item) => `${title}: ${item}`));
          continue;
        }
        appendField(lines, labelFromKey(key), value);
      }

      return lines.join("\n");
    });

  const pendingSection = pending.length
    ? `\n## Pendencias\n\n${pending.map((item) => `- ${item}`).join("\n")}\n`
    : "\n## Pendencias\n\n- Nenhuma pendencia informada.\n";

  return `# Disponibilidade imobiliaria\n\nFonte: \`${inputPath}\`\n\n${sections.join("\n\n")}${pendingSection}`;
}

function appendField(lines, label, value) {
  const list = toList(value);
  if (!list.length) return;
  lines.push(`- **${label}:** ${list.join("; ")}`);
}

function toList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  const text = String(value).trim();
  return text ? [text] : [];
}

function isPendingKey(key) {
  return ["pendencia", "pendencias", "duvida", "duvidas", "ilegivel"].includes(key);
}

function labelFromKey(key) {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
