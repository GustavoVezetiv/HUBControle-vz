import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    throw new Error("Arquivo .env.local não encontrado.");
  }

  const raw = fs.readFileSync(envPath, "utf8");
  const pairs = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
    });

  return Object.fromEntries(pairs);
}

function logStep(label, payload) {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(payload, null, 2));
}

const env = loadLocalEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const accessToken = env.SUPABASE_IMPORT_ACCESS_TOKEN;

if (!url || !anonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórios.");
}

if (!accessToken) {
  throw new Error("SUPABASE_IMPORT_ACCESS_TOKEN não encontrado em .env.local.");
}

const client = createClient(url, anonKey, {
  global: {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const today = new Date().toISOString().slice(0, 10);
const marker = `Codex validate places ${new Date().toISOString()}`;

async function main() {
  const created = await client
    .from("places")
    .insert({
      name: marker,
      description: "Validação automatizada do módulo de roles e lugares",
      place_type: "cafe",
      status: "planned",
      city: "Cuiabá",
      planned_date: today,
      estimated_cost: 32.5,
      notes: "Registro temporário para verificar create/update/archive/restore",
    })
    .select("id,user_id,name,status,place_type,planned_date,estimated_cost")
    .single();

  if (created.error) {
    const message = String(created.error.message || "");
    if (/jwt/i.test(message) && /expired/i.test(message)) {
      throw new Error("SUPABASE_IMPORT_ACCESS_TOKEN expirado. Gere um novo token de sessão antes de rodar validate:places-module.");
    }
    throw new Error(`Falha ao criar lugar: ${message}`);
  }

  logStep("create", created.data);

  const updated = await client
    .from("places")
    .update({
      status: "visited",
      visited_date: today,
      actual_cost: 29.9,
      rating: 4,
      would_repeat: true,
      companion: "Teste automático",
    })
    .eq("id", created.data.id)
    .select("id,status,visited_date,actual_cost,rating,would_repeat,companion")
    .single();

  if (updated.error) {
    throw new Error(`Falha ao atualizar lugar: ${updated.error.message}`);
  }

  logStep("update", updated.data);

  const archived = await client
    .from("places")
    .update({
      archived_at: new Date().toISOString(),
      archived_by: created.data.user_id,
      archive_reason: "validate-places-module",
    })
    .eq("id", created.data.id)
    .select("id,archived_at,archive_reason")
    .single();

  if (archived.error) {
    throw new Error(`Falha ao arquivar lugar: ${archived.error.message}`);
  }

  logStep("archive", archived.data);

  const restored = await client
    .from("places")
    .update({
      archived_at: null,
      archived_by: null,
      archive_reason: null,
    })
    .eq("id", created.data.id)
    .select("id,status,archived_at,archive_reason,rating,actual_cost")
    .single();

  if (restored.error) {
    throw new Error(`Falha ao restaurar lugar: ${restored.error.message}`);
  }

  logStep("restore", restored.data);

  console.log("\nValidação concluída com sucesso.");
}

main().catch((error) => {
  console.error("\n[validate:places-module:error]");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
