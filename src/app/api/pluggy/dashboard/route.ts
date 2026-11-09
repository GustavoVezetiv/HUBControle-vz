import { createClient } from "@/lib/supabase/server";
import { pluggyConfig } from "@/features/pluggy/config";
import {
  pluggyDashboard,
  pluggyMessage,
  syncPluggyBank,
} from "@/features/pluggy/service";
import { validateReview } from "@/features/pluggy/reconciliation";
import { normalizeDescription } from "@/features/imports/reconciliation";
import { validatePeriod } from "@/features/organizze/extraction";
import { accumulatedPluggyBackup } from "@/features/pluggy/backup";
import type { Json } from "@/lib/supabase/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function session() {
  const client = await createClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  return !error && data.user?.id === pluggyConfig().ownerId
    ? { client, owner: data.user.id }
    : null;
}
export async function GET(request: Request) {
  const auth = await session();
  if (!auth) return json({ error: "Entre como proprietário da integração." }, 401);
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("action") === "download") {
      const bank = pluggyConfig().items.find(
        (bank) => bank.id === params.get("institution") && bank.valid,
      );
      if (!bank) return json({ error: "Instituição inválida ou não configurada." }, 400);
      const backup = await accumulatedPluggyBackup(auth.owner, bank.itemId);
      return backup
        ? new Response(JSON.stringify(backup.snapshot), {
            headers: {
              "Content-Type": "application/json",
              "Content-Disposition": `attachment; filename="pluggy-${bank.id}.json"`,
              "Cache-Control": "no-store, private",
            },
          })
        : json({ error: "Nenhum backup desta conexão." }, 404);
    }
    if (params.has("action")) return json({ error: "Ação inválida." }, 400);
    return json(await pluggyDashboard(auth.client, auth.owner));
  } catch {
    return json(
      {
        error:
          "Falha ao carregar a caixa de entrada ou referências completas do Hub. Nenhum dado financeiro alterado.",
      },
      502,
    );
  }
}
export async function POST(request: Request) {
  const url = new URL(request.url);
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    if (
      origin.host.toLowerCase() !==
        (request.headers.get("host") ?? url.host).toLowerCase() ||
      origin.protocol !==
        `${request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1)}:`
    )
      return json({ error: "Origem inválida." }, 403);
  } catch {
    return json({ error: "Origem inválida." }, 403);
  }
  const auth = await session();
  if (!auth) return json({ error: "Entre como proprietário da integração." }, 401);
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 8192)
      return json({ error: "Pedido excede o limite." }, 413);
    const body = JSON.parse(text);
    if (body.action === "sync") {
      if (
        Object.keys(body).some(
          (key) => !["action", "institution", "period", "onlyIfDue"].includes(key),
        )
      )
        return json({ error: "Pedido inválido." }, 400);
      const bank = pluggyConfig().items.find((bank) => bank.id === body.institution);
      if (!bank) return json({ error: "Instituição inválida." }, 400);
      try {
        validatePeriod(body.period);
      } catch {
        return json({ error: "Período inválido." }, 400);
      }
      await syncPluggyBank(bank.id, body.period, body.onlyIfDue === true);
      return json(await pluggyDashboard(auth.client, auth.owner, true));
    }
    if (body.action === "refresh")
      return json(await pluggyDashboard(auth.client, auth.owner, true));
    if (!["review", "rule"].includes(body.action) || body.confirm !== true)
      return json({ error: "Confirme explicitamente a revisão ou regra." }, 400);
    const dashboard = await pluggyDashboard(auth.client, auth.owner);
    if (!dashboard.ready)
      return json(
        {
          error:
            "A migration da caixa de entrada precisa ser aprovada e aplicada para salvar vínculos e regras.",
        },
        409,
      );
    if (body.action === "review") {
      const row = dashboard.movements.find((row) => row.sourceKey === body.sourceKey);
      if (!row || typeof body.expectedUpdatedAt !== "string")
        return json(
          {
            error:
              "Movimentação indisponível ou ainda não guardada. Recarregue a caixa de entrada.",
          },
          409,
        );
      const review = validateReview(
        row,
        body.review,
        dashboard.categories.map((category) => category.id),
      );
      const result = await auth.client.rpc("review_pluggy_row", {
        p_source_key: row.sourceKey,
        p_review: review as unknown as Json,
        p_expected_updated_at: body.expectedUpdatedAt,
      });
      if (result.error)
        return json(
          {
            error:
              "Vínculo ou revisão mudou. Recarregue; nenhum lançamento financeiro foi alterado.",
          },
          409,
        );
    } else {
      const rule = body.rule;
      if (
        !rule ||
        typeof rule.pattern !== "string" ||
        rule.pattern.trim().length < 3 ||
        rule.pattern.length > 120 ||
        !dashboard.categories.some(
          (category) =>
            category.id === rule.categoryId &&
            ["expense", "income"].includes(category.type),
        ) ||
        (rule.ownership !== null &&
          !["personal", "third_party", "family", "shared"].includes(rule.ownership)) ||
        typeof rule.active !== "boolean" ||
        (rule.id && !dashboard.rules.some((existing) => existing.id === rule.id))
      )
        return json(
          {
            error:
              "Regra inválida; escolha uma categoria própria e titularidade opcional explícita.",
          },
          400,
        );
      const result = await auth.client.rpc("save_pluggy_rule", {
        p_rule: {
          id: rule.id || null,
          pattern: normalizeDescription(rule.pattern),
          categoryId: rule.categoryId,
          ownership: rule.ownership,
          active: rule.active,
        },
      });
      if (result.error)
        return json(
          { error: "Regra não salva. Confira se já existe uma regra com esse texto." },
          409,
        );
    }
    return json(await pluggyDashboard(auth.client, auth.owner, true));
  } catch (error) {
    return json({ error: pluggyMessage(error) }, 502);
  }
}
