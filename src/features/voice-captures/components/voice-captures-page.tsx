"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import type { VoiceCaptureSessionWithSuggestions } from "@/features/voice-captures/types";
import { ActionButton, CrudFeedback, TextBadge } from "@/features/shared/crud-ui";
import type { FeedbackState } from "@/features/shared/types";

type ReviewApiResponse = {
  captures: VoiceCaptureSessionWithSuggestions[];
};

const statusLabels: Record<string, string> = {
  received: "Recebida",
  transcribing: "Transcrevendo",
  transcribed: "Transcrita",
  failed: "Falhou",
  archived: "Arquivada",
};

const suggestionLabels: Record<string, string> = {
  task: "Tarefa sugerida",
  loose_idea: "Ideia solta",
  reminder: "Lembrete",
  uncertainty: "Incerteza",
};

export function VoiceCapturesPage() {
  const [captures, setCaptures] = useState<VoiceCaptureSessionWithSuggestions[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const loadCaptures = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/voice-captures/review", { method: "GET" });
      const payload = (await response.json().catch(() => null)) as Partial<ReviewApiResponse> & {
        error?: string;
        technical?: string;
      } | null;

      if (!response.ok) {
        console.error("Erro técnico ao listar capturas de voz:", payload?.technical ?? payload);
        setFeedback({ type: "error", message: payload?.error ?? "Não foi possível carregar capturas de voz." });
        return;
      }

      setCaptures(payload?.captures ?? []);
    } catch (error) {
      console.error("Erro técnico ao listar capturas de voz:", error);
      setFeedback({ type: "error", message: "Não foi possível carregar capturas de voz." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  const stats = useMemo(() => {
    const pendingReview = captures.filter((capture) => capture.task_review_status === "pending").length;
    const received = captures.filter((capture) => capture.status === "received").length;
    const failed = captures.filter((capture) => capture.status === "failed" || capture.processing_error).length;
    const suggestions = captures.reduce((sum, capture) => sum + capture.suggestions.filter((item) => item.status === "pending").length, 0);

    return { pendingReview, received, failed, suggestions };
  }, [captures]);

  async function handleProcess(captureId: string) {
    setProcessingId(captureId);
    setFeedback(null);
    try {
      const response = await fetch(`/api/voice-captures/${captureId}/process`, { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { error?: string; technical?: string } | null;

      if (!response.ok) {
        console.error("Erro técnico ao processar captura:", payload?.technical ?? payload);
        setFeedback({ type: "error", message: payload?.error ?? "Não foi possível processar a captura." });
        return;
      }

      setFeedback({ type: "success", message: "Captura processada. Sugestões aguardam revisão manual." });
      await loadCaptures();
    } catch (error) {
      console.error("Erro técnico ao processar captura:", error);
      setFeedback({ type: "error", message: "Não foi possível processar a captura." });
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Vozetiv Capture"
        title="Capturas de voz"
        description="Receba áudios do app mobile, gere transcrição e organize sugestões para revisão manual."
      />

      <CrudFeedback feedback={feedback} />

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Recebidas" value={String(stats.received)} helper="Aguardando processamento." tone="info" />
        <StatCard label="Em revisão" value={String(stats.pendingReview)} helper="Com sugestões pendentes." tone="warning" />
        <StatCard label="Sugestões" value={String(stats.suggestions)} helper="Nada vai para o Google Tasks automaticamente." tone="success" />
        <StatCard label="Falhas" value={String(stats.failed)} helper="Precisam ser reprocessadas." tone="danger" />
      </div>

      <SectionCard
        title="Revisão manual"
        description="A IA apenas organiza o conteúdo. Revise antes de transformar qualquer item em tarefa real."
      >
        {loading ? (
          <p className="text-sm text-ink-600 dark:text-slate-300">Carregando capturas...</p>
        ) : captures.length === 0 ? (
          <EmptyState
            title="Nenhuma captura recebida"
            description="As capturas enviadas pelo Vozetiv Capture aparecerão aqui."
          />
        ) : (
          <div className="space-y-4">
            {captures.map((capture) => (
              <article
                key={capture.id}
                className="rounded-lg border border-ink-950/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink-950 dark:text-slate-100">
                        Captura {capture.local_capture_id}
                      </h3>
                      <TextBadge tone={capture.status === "failed" ? "danger" : capture.task_review_status === "pending" ? "warning" : "neutral"}>
                        {statusLabels[capture.status] ?? capture.status}
                      </TextBadge>
                      {capture.task_review_status === "pending" ? <TextBadge tone="info">Revisão pendente</TextBadge> : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-600 dark:text-slate-300">
                      Criada no app em {formatDateTime(capture.created_at_mobile)} · {Math.round(capture.duration_seconds)}s
                    </p>
                  </div>
                  <ActionButton
                    type="button"
                    onClick={() => handleProcess(capture.id)}
                    disabled={processingId === capture.id}
                  >
                    {processingId === capture.id ? "Processando..." : capture.transcription_text ? "Reprocessar" : "Processar"}
                  </ActionButton>
                </div>

                {capture.processing_error ? (
                  <div className="mt-4 rounded-md border border-danger-600/20 bg-danger-100 px-3 py-2 text-sm text-danger-600">
                    {capture.processing_error}
                  </div>
                ) : null}

                {capture.transcription_text ? (
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md border border-ink-950/10 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-900">
                      <h4 className="text-sm font-semibold text-ink-950 dark:text-slate-100">Transcrição bruta</h4>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-700 dark:text-slate-300">
                        {capture.transcription_text}
                      </p>
                    </div>
                    <div className="rounded-md border border-ink-950/10 bg-slate-50 p-3 dark:border-white/10 dark:bg-slate-900">
                      <h4 className="text-sm font-semibold text-ink-950 dark:text-slate-100">Resumo da IA</h4>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-700 dark:text-slate-300">
                        {capture.ai_summary || "Resumo ainda não gerado."}
                      </p>
                    </div>
                  </div>
                ) : null}

                {capture.suggestions.length > 0 ? (
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-ink-950 dark:text-slate-100">Sugestões pendentes</h4>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {capture.suggestions.map((suggestion) => (
                        <div
                          key={suggestion.id}
                          className="rounded-md border border-ink-950/10 bg-white p-3 dark:border-white/10 dark:bg-slate-900"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <TextBadge tone={suggestion.suggestion_type === "uncertainty" ? "warning" : "info"}>
                              {suggestionLabels[suggestion.suggestion_type] ?? suggestion.suggestion_type}
                            </TextBadge>
                            <TextBadge tone={suggestion.confidence === "alta" ? "success" : suggestion.confidence === "media" ? "warning" : "neutral"}>
                              Confiança {suggestion.confidence}
                            </TextBadge>
                          </div>
                          <p className="mt-2 text-sm font-semibold text-ink-950 dark:text-slate-100">{suggestion.title}</p>
                          {suggestion.description ? (
                            <p className="mt-1 text-sm leading-6 text-ink-700 dark:text-slate-300">{suggestion.description}</p>
                          ) : null}
                          {suggestion.suggested_list_name ? (
                            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-mint-600">
                              Lista sugerida: {suggestion.suggested_list_name}
                            </p>
                          ) : null}
                          {suggestion.reason ? (
                            <p className="mt-2 text-xs leading-5 text-ink-600 dark:text-slate-400">Motivo: {suggestion.reason}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
