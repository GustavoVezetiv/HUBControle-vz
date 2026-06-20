import { profileToAiPreferences } from "@/features/ai/preferences";
import type { AppSupabaseClient } from "@/features/shared/types";
import type { Json } from "@/lib/supabase/types";

const GEMINI_DECISION_ASSISTANT_MODEL =
  process.env.GEMINI_DECISION_ASSISTANT_MODEL ??
  process.env.GEMINI_WEEKLY_REVIEW_MODEL ??
  "gemini-2.5-flash";
const GEMINI_DECISION_ASSISTANT_MAX_OUTPUT_TOKENS = Number.parseInt(
  process.env.GEMINI_DECISION_ASSISTANT_MAX_OUTPUT_TOKENS ??
    process.env.GEMINI_WEEKLY_REVIEW_MAX_OUTPUT_TOKENS ??
    "2200",
  10,
);
const GEMINI_DECISION_ASSISTANT_THINKING_BUDGET = Number.parseInt(
  process.env.GEMINI_DECISION_ASSISTANT_THINKING_BUDGET ??
    process.env.GEMINI_WEEKLY_REVIEW_THINKING_BUDGET ??
    "0",
  10,
);

export type AiAssistantTarget = "dashboard_briefing" | "diagnostic_alert" | "goals_review" | "planned_purchases_review";

export type AiAssistantSection = {
  title: string;
  content: string;
};

export type AiAssistantResult = {
  text: string;
  sections: AiAssistantSection[];
  metadata: {
    model: string;
    target: AiAssistantTarget;
  };
};

export async function generateDecisionAssistantResponse(
  client: AppSupabaseClient,
  userId: string,
  target: AiAssistantTarget,
  payload: Json,
): Promise<{ data: AiAssistantResult | null; error: { message: string; technical?: string } | null }> {
  const profileResult = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (profileResult.error) {
    console.error("Erro técnico ao carregar preferências da IA:", profileResult.error);
    return {
      data: null,
      error: {
        message: "Não foi possível carregar o contexto da IA.",
        technical: profileResult.error.message,
      },
    };
  }

  const aiPreferences = profileToAiPreferences(profileResult.data ?? null);
  const prompt = buildPrompt(target, payload, aiPreferences);
  const gemini = await requestGeminiAssistant(prompt);
  if (gemini.error || !gemini.text) {
    return { data: null, error: gemini.error ?? { message: "A IA não retornou texto." } };
  }

  return {
    data: {
      text: gemini.text,
      sections: parseAssistantSections(gemini.text),
      metadata: {
        model: GEMINI_DECISION_ASSISTANT_MODEL,
        target,
      },
    },
    error: null,
  };
}

function buildPrompt(target: AiAssistantTarget, payload: Json, aiPreferences: ReturnType<typeof profileToAiPreferences>) {
  const context = {
    areas_da_vida: aiPreferences.areasOfLife,
    objetivos: aiPreferences.objectives,
    prioridades: aiPreferences.priorities,
    rotina: aiPreferences.routineNotes,
    categorias_importantes: aiPreferences.importantCategories,
    areas_prioritarias: aiPreferences.priorityAreas,
    areas_sem_urgencia: aiPreferences.nonUrgentAreas,
    considerar: aiPreferences.considerNotes,
    evitar: aiPreferences.avoidNotes,
    tom: aiPreferences.analysisTone,
    detalhe: aiPreferences.detailLevel,
    usar_historico_financeiro: aiPreferences.useFinancialHistory,
    usar_historico_tarefas: aiPreferences.useTaskHistory,
    usar_historico_roles: aiPreferences.usePlacesHistory,
  };

  const targetInstruction =
    target === "dashboard_briefing"
      ? [
          "Você está gerando um briefing rápido do Dashboard financeiro do dia.",
          "Responda o que precisa ser olhado hoje, o que está crítico, o que pode esperar e qual pequena ação pode ser tomada agora.",
          "Considere separação entre renda real, reembolsos e dinheiro de terceiros.",
        ]
      : target === "diagnostic_alert"
        ? [
            "Você está explicando um alerta do diagnóstico financeiro.",
            "Explique por que o alerta importa, qual o risco e qual ordem de correção faz mais sentido.",
            "Não proponha SQL, não mande apagar dados e não trate correção automática como feita.",
          ]
        : target === "goals_review"
          ? [
              "Você está analisando metas do usuário.",
              "Priorize metas que estão paradas, próximas do prazo ou desalinhadas com as áreas prioritárias.",
              "Se a meta for qualitativa, não trate como meta financeira.",
            ]
          : [
              "Você está analisando compras e desejos do usuário.",
              "Ajude a priorizar compras, separar o que pode esperar e destacar itens parados ou com prioridade alta.",
              "Não transforme desejo em urgência financeira sem evidência no payload.",
            ];

  return [
    "Você é um assistente de decisão do Hub VZ.",
    "Nunca altere dados, nunca crie tarefas, nunca apague dados e nunca invente informação ausente.",
    "Responda em Markdown simples, sem JSON e sem bloco de código.",
    "Use um tom prático e útil.",
    "Estruture a resposta com estes títulos, nessa ordem:",
    "Resumo",
    "Ação recomendada",
    "Ideia opcional",
    "Observação",
    "Alerta",
    ...targetInstruction,
    "",
    "Contexto do usuário:",
    JSON.stringify(context),
    "",
    "Payload resumido do Hub:",
    JSON.stringify(payload),
  ].join("\n");
}

async function requestGeminiAssistant(prompt: string): Promise<{ text: string | null; error: { message: string; technical?: string } | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      text: null,
      error: {
        message: "GEMINI_API_KEY não configurada.",
        technical: "Missing GEMINI_API_KEY",
      },
    };
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_DECISION_ASSISTANT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: Number.isFinite(GEMINI_DECISION_ASSISTANT_MAX_OUTPUT_TOKENS)
              ? GEMINI_DECISION_ASSISTANT_MAX_OUTPUT_TOKENS
              : 2200,
            thinkingConfig: {
              thinkingBudget: Number.isFinite(GEMINI_DECISION_ASSISTANT_THINKING_BUDGET)
                ? GEMINI_DECISION_ASSISTANT_THINKING_BUDGET
                : 0,
            },
          },
        }),
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const technical = extractAssistantError(payload) ?? `HTTP ${response.status}`;
      console.error("Erro técnico ao chamar assistente Gemini:", payload);
      return {
        text: null,
        error: {
          message: "Não foi possível gerar a resposta da IA.",
          technical,
        },
      };
    }

    const text = extractAssistantText(payload);
    if (!text) {
      console.error("Resposta do assistente Gemini sem texto:", payload);
      return {
        text: null,
        error: {
          message: "A IA respondeu sem texto útil.",
          technical: "Empty Gemini response",
        },
      };
    }

    return {
      text: normalizeAssistantText(text),
      error: null,
    };
  } catch (error) {
    console.error("Erro técnico ao chamar assistente Gemini:", error);
    return {
      text: null,
      error: {
        message: "Não foi possível chamar a IA.",
        technical: error instanceof Error ? error.message : "Unknown Gemini assistant error",
      },
    };
  }
}

function parseAssistantSections(text: string): AiAssistantSection[] {
  const lines = text.split(/\r?\n/);
  const sections: AiAssistantSection[] = [];
  let currentTitle = "Resumo";
  let currentContent: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const normalized = line.replace(/^[#*\-\s]+/, "").replace(/:$/, "");
    if (isAssistantSectionTitle(normalized)) {
      if (currentContent.join(" ").trim()) {
        sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
      }
      currentTitle = normalized;
      currentContent = [];
      continue;
    }
    currentContent.push(rawLine);
  }

  if (currentContent.join(" ").trim()) {
    sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
  }

  return sections.length > 0 ? sections : [{ title: "Resumo", content: text.trim() }];
}

function isAssistantSectionTitle(value: string) {
  return ["Resumo", "Ação recomendada", "Ideia opcional", "Observação", "Alerta"].includes(value);
}

function normalizeAssistantText(text: string) {
  return text.replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").trim();
}

function extractAssistantText(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  const text = candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
  return text || null;
}

function extractAssistantError(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: { message?: string; status?: string } }).error;
  if (!error) return null;
  return [error.status, error.message].filter(Boolean).join(": ");
}
