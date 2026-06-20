"use client";

import { useMemo, useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { ActionButton, CrudFeedback, TextBadge } from "@/features/shared/crud-ui";
import type { FeedbackState } from "@/features/shared/types";

type AiResponseSection = {
  title: string;
  content: string;
};

type AiResponsePanelProps = {
  title: string;
  description: string;
  buttonLabel: string;
  loadingLabel: string;
  target: "dashboard_briefing" | "diagnostic_alert" | "goals_review" | "planned_purchases_review";
  payload: Record<string, unknown>;
  emptyState: string;
};

export function AiResponsePanel({
  title,
  description,
  buttonLabel,
  loadingLabel,
  target,
  payload,
  emptyState,
}: AiResponsePanelProps) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [hidden, setHidden] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [usefulness, setUsefulness] = useState<"useful" | "not_useful" | null>(null);
  const [sections, setSections] = useState<AiResponseSection[]>([]);
  const [rawText, setRawText] = useState("");

  const hasResponse = sections.length > 0 || Boolean(rawText);
  const visibleSections = useMemo(
    () => sections.filter((section) => section.content.trim().length > 0),
    [sections],
  );

  async function handleGenerate() {
    setLoading(true);
    setFeedback(null);
    setHidden(false);
    try {
      const response = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, payload }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.error) {
        if (result?.technical) console.error("Erro técnico ao gerar resposta da IA:", result.technical);
        setFeedback({ type: "error", message: result?.error ?? "Não foi possível gerar a resposta da IA." });
        return;
      }

      setSections(result.result?.sections ?? []);
      setRawText(result.result?.text ?? "");
      setAccepted(false);
      setUsefulness(null);
      setFeedback({ type: "success", message: "Resposta da IA gerada." });
    } catch (error) {
      console.error("Erro técnico ao gerar resposta da IA:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar a resposta da IA." });
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rawText || visibleSections.map((section) => `${section.title}\n${section.content}`).join("\n\n"));
      setFeedback({ type: "success", message: "Resposta copiada." });
    } catch (error) {
      console.error("Erro técnico ao copiar resposta da IA:", error);
      setFeedback({ type: "error", message: "Não foi possível copiar a resposta." });
    }
  }

  return (
    <SectionCard title={title} description={description}>
      <div className="mb-4 flex justify-end">
        <ActionButton type="button" variant="secondary" onClick={() => void handleGenerate()} disabled={loading}>
          {loading ? loadingLabel : buttonLabel}
        </ActionButton>
      </div>
      <CrudFeedback feedback={feedback} />

      {hidden ? (
        <p className="text-sm text-ink-600 dark:text-slate-300">Sugestão ignorada nesta visualização.</p>
      ) : hasResponse ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {accepted ? <TextBadge tone="success">Aceita</TextBadge> : null}
            {usefulness === "useful" ? <TextBadge tone="success">Marcada como útil</TextBadge> : null}
            {usefulness === "not_useful" ? <TextBadge tone="warning">Marcada como pouco útil</TextBadge> : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {visibleSections.map((section) => (
              <article key={section.title} className="hub-card rounded-lg border border-ink-950/10 p-4">
                <h4 className="text-sm font-semibold text-ink-950 dark:text-slate-100">{section.title}</h4>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-700 dark:text-slate-200">{section.content}</p>
              </article>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionButton type="button" variant="secondary" onClick={() => setAccepted(true)}>
              Aceitar
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => setHidden(true)}>
              Ignorar
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => void handleCopy()}>
              Copiar
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => setUsefulness("useful")}>
              Útil
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => setUsefulness("not_useful")}>
              Não útil
            </ActionButton>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-600 dark:text-slate-300">{emptyState}</p>
      )}
    </SectionCard>
  );
}
