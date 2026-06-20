"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AiResponsePanel } from "@/features/ai/components/ai-response-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  buildFinancialDiagnostics,
  fixTransactionInvoiceFromDiagnostic,
  ignoreFinancialDiagnosticAlert,
  recalculateInvoiceFromDiagnostic,
} from "@/features/diagnostics/queries";
import type { FinancialDiagnosticItem, FinancialDiagnosticsData } from "@/features/diagnostics/types";
import { ActionButton, CrudFeedback, Modal } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

type InvoiceRecalculationPreview = {
  invoiceId: string;
  before: {
    totalAmount: number;
    personalAmount: number;
    reimbursableAmount: number;
    thirdPartyAmount: number;
  };
  after: {
    totalAmount: number;
    personalAmount: number;
    reimbursableAmount: number;
    thirdPartyAmount: number;
  };
} | null;

type FixInvoicePreview = {
  item: FinancialDiagnosticItem;
} | null;

export function FinancialDiagnosticsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<FinancialDiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [invoicePreview, setInvoicePreview] = useState<InvoiceRecalculationPreview>(null);
  const [fixInvoicePreview, setFixInvoicePreview] = useState<FixInvoicePreview>(null);
  const [selectedAiItem, setSelectedAiItem] = useState<FinancialDiagnosticItem | null>(null);

  const loadData = useCallback(async () => {
    setRefreshing(true);
    setFeedback(null);
    try {
      const client = createClient();
      const authResult = await client.auth.getUser();
      if (authResult.error || !authResult.data.user) {
        setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
        setData(null);
        return;
      }

      setUserId(authResult.data.user.id);
      const result = await buildFinancialDiagnostics(client, authResult.data.user.id);
      if (result.error || !result.data) {
        setFeedback({ type: "error", message: result.error?.message ?? "Não foi possível carregar o diagnóstico financeiro." });
        setData(null);
        return;
      }

      setData(result.data);
    } catch (error) {
      console.error("Erro técnico ao carregar diagnóstico financeiro:", error);
      setFeedback({ type: "error", message: "Não foi possível carregar o diagnóstico financeiro." });
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const sections = data?.sections ?? [];
  const totalVisibleAlerts = data?.totalAlerts ?? 0;

  async function handleIgnore(item: FinancialDiagnosticItem) {
    if (!userId) return;
    if (!window.confirm("Ignorar este alerta? Ele deixa de aparecer nesta central até nova revisão manual.")) {
      return;
    }

    setBusyKey(item.alertKey);
    setFeedback(null);
    try {
      const result = await ignoreFinancialDiagnosticAlert(createClient(), userId, {
        alertKey: item.alertKey,
        alertType: item.alertType,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
      });
      if (result.error) {
        setFeedback({ type: "error", message: result.error.message });
        return;
      }
      setFeedback({ type: "success", message: "Alerta ignorado." });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao ignorar alerta:", error);
      setFeedback({ type: "error", message: "Não foi possível ignorar este alerta." });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRecalculateInvoice(invoiceId: string) {
    if (!userId) return;
    setBusyKey(`recalculate:${invoiceId}`);
    setFeedback(null);
    try {
      const result = await recalculateInvoiceFromDiagnostic(createClient(), userId, invoiceId);
      if (result.error || !result.data) {
        setFeedback({ type: "error", message: result.error?.message ?? "Não foi possível recalcular a fatura." });
        return;
      }
      setInvoicePreview({ invoiceId, before: result.data.before, after: result.data.after });
      setFeedback({ type: "success", message: "Fatura recalculada com base nos lançamentos atuais." });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao recalcular fatura via diagnóstico:", error);
      setFeedback({ type: "error", message: "Não foi possível recalcular a fatura." });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleConfirmFixInvoice(item: FinancialDiagnosticItem) {
    if (!userId || !item.transactionId) return;
    setBusyKey(`fix:${item.transactionId}`);
    setFeedback(null);
    try {
      const result = await fixTransactionInvoiceFromDiagnostic(createClient(), userId, item.transactionId);
      if (result.error || !result.data) {
        setFeedback({ type: "error", message: result.error?.message ?? "Não foi possível corrigir a fatura do lançamento." });
        return;
      }

      const action = result.data.createdInvoice ? "criada e vinculada" : "vinculada";
      setFeedback({
        type: "success",
        message: `Fatura correta ${action}. Referência ${result.data.invoiceReferenceMonth.slice(0, 7)}.`,
      });
      setFixInvoicePreview(null);
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao corrigir fatura do lançamento:", error);
      setFeedback({ type: "error", message: "Não foi possível corrigir a fatura do lançamento." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Conferência segura"
        title="Diagnóstico financeiro"
        description="Identifique inconsistências financeiras sem usar SQL manual. Nenhuma correção é aplicada sem ação explícita."
        action={
          <ActionButton type="button" variant="secondary" onClick={() => void loadData()} disabled={refreshing}>
            {refreshing ? "Atualizando..." : "Atualizar diagnóstico"}
          </ActionButton>
        }
      />

      <CrudFeedback feedback={feedback} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Alertas visíveis" value={String(totalVisibleAlerts)} helper="Itens que ainda precisam de revisão." tone={totalVisibleAlerts > 0 ? "warning" : "success"} />
        <StatCard label="Alertas ignorados" value={String(data?.totalIgnored ?? 0)} helper="Ocultados manualmente nesta central." tone="neutral" />
        <StatCard label="Blocos monitorados" value={String(sections.length)} helper="Conjuntos de conferência ativa." tone="info" />
        <StatCard label="Última leitura" value={data ? formatDate(data.generatedAt.slice(0, 10)) : "-"} helper="Gerada com base nos dados atuais do usuário." tone="neutral" />
      </section>

      {selectedAiItem ? (
        <AiResponsePanel
          title={`Explicação com IA: ${selectedAiItem.title}`}
          description="Leitura opcional do alerta selecionado. A IA explica o risco e sugere ordem de correção, sem executar nada."
          buttonLabel="Explicar alerta com IA"
          loadingLabel="Gerando explicação..."
          target="diagnostic_alert"
          payload={{
            alerta: {
              tipo: selectedAiItem.alertType,
              titulo: selectedAiItem.title,
              descricao: selectedAiItem.description,
              detalhes: selectedAiItem.details.slice(0, 8),
              referencias: selectedAiItem.references.slice(0, 4),
              valor: selectedAiItem.amount ?? null,
              possui_previa_correcao: Boolean(selectedAiItem.suggestedInvoicePreview),
            },
            contexto_bloco: sections.find((section) => section.items.some((item) => item.alertKey === selectedAiItem.alertKey))?.title ?? null,
          }}
          emptyState="Selecione um alerta e gere a explicação da IA para entender o risco e a ordem sugerida."
        />
      ) : null}

      {loading ? (
        <SectionCard title="Carregando diagnóstico">
          <p className="text-sm text-ink-600 dark:text-slate-300">Analisando transações, faturas, reembolsos, parcelamentos e categorias.</p>
        </SectionCard>
      ) : totalVisibleAlerts === 0 ? (
        <SectionCard title="Diagnóstico financeiro">
          <EmptyState
            title="Nenhuma inconsistência visível"
            description="Os blocos monitorados não encontraram alertas pendentes neste momento."
          />
        </SectionCard>
      ) : (
        sections.map((section) => (
          <SectionCard
            key={section.key}
            title={section.title}
            description={`${section.description}${section.ignoredCount > 0 ? ` ${section.ignoredCount} alerta(s) estão ignorados.` : ""}`}
          >
            <div className="mb-4 grid gap-4 md:grid-cols-3">
              <StatCard label="Pendentes" value={String(section.count)} helper="Alertas visíveis neste bloco." tone={section.count > 0 ? "warning" : "success"} />
              <StatCard label="Ignorados" value={String(section.ignoredCount)} helper="Ocultados manualmente." tone="neutral" />
              <StatCard label="Total bruto" value={String(section.count + section.ignoredCount)} helper="Antes de aplicar ignorados." tone="info" />
            </div>

            {section.items.length === 0 ? (
              <EmptyState title="Sem alertas neste bloco" description="Nada a revisar aqui depois dos filtros de ignorados." />
            ) : (
              <div className="space-y-4">
                {section.items.map((item) => (
                  <article key={item.alertKey} className="hub-card rounded-lg border border-ink-950/10 p-4 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{item.title}</p>
                          <p className="mt-1 text-sm leading-6 text-ink-600 dark:text-slate-300">{item.description}</p>
                        </div>
                        <ul className="space-y-1 text-sm text-ink-700 dark:text-slate-200">
                          {item.details.map((detail) => (
                            <li key={detail}>{detail}</li>
                          ))}
                        </ul>
                        {item.suggestedInvoicePreview ? (
                          <div className="rounded-md border border-amber-500/20 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-300/20 dark:bg-amber-950/35 dark:text-amber-100">
                            <p className="font-semibold">Prévia da correção</p>
                            <p className="mt-1">
                              Mês de referência {item.suggestedInvoicePreview.referenceMonth.slice(0, 7)} ·
                              fechamento {formatDate(item.suggestedInvoicePreview.closingDate)} ·
                              vencimento {formatDate(item.suggestedInvoicePreview.dueDate)}.
                            </p>
                            <p className="mt-1">
                              {item.suggestedInvoicePreview.existingInvoiceId ? "Já existe uma fatura compatível." : "Será necessário criar a fatura antes de vincular."}
                            </p>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {item.references.map((reference) => (
                            <Link key={`${item.alertKey}-${reference.href}-${reference.label}`} href={reference.href} className="text-sm font-semibold text-mint-600 hover:text-mint-700">
                              {reference.label}
                            </Link>
                          ))}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
                        {item.actions.includes("open_invoice") && item.invoiceId ? (
                          <Link href={`/dashboard/invoices/${item.invoiceId}`}>
                            <ActionButton type="button" variant="secondary">Abrir fatura</ActionButton>
                          </Link>
                        ) : null}
                        {item.actions.includes("open_transaction") ? (
                          <Link href="/dashboard/invoices">
                            <ActionButton type="button" variant="secondary">Abrir lançamento</ActionButton>
                          </Link>
                        ) : null}
                        {item.actions.includes("open_item") ? (
                          <Link href={primaryItemHref(item)}>
                            <ActionButton type="button" variant="secondary">Abrir item</ActionButton>
                          </Link>
                        ) : null}
                        {item.actions.includes("manual_link") ? (
                          <Link href={primaryItemHref(item)}>
                            <ActionButton type="button" variant="secondary">Vincular manualmente</ActionButton>
                          </Link>
                        ) : null}
                        {item.actions.includes("recalculate_invoice") && item.invoiceId ? (
                          <ActionButton
                            type="button"
                            onClick={() => void handleRecalculateInvoice(item.invoiceId as string)}
                            disabled={busyKey === `recalculate:${item.invoiceId}`}
                          >
                            {busyKey === `recalculate:${item.invoiceId}` ? "Recalculando..." : "Recalcular fatura"}
                          </ActionButton>
                        ) : null}
                        {item.actions.includes("create_correct_invoice") && item.transactionId ? (
                          <ActionButton
                            type="button"
                            onClick={() => setFixInvoicePreview({ item })}
                            disabled={busyKey === `fix:${item.transactionId}`}
                          >
                            Criar fatura correta
                          </ActionButton>
                        ) : null}
                        {item.actions.includes("ignore_alert") ? (
                          <ActionButton
                            type="button"
                            variant="secondary"
                            onClick={() => void handleIgnore(item)}
                            disabled={busyKey === item.alertKey}
                          >
                            {busyKey === item.alertKey ? "Ignorando..." : "Ignorar alerta"}
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          type="button"
                          variant="secondary"
                          onClick={() => setSelectedAiItem(item)}
                        >
                          Explicar com IA
                        </ActionButton>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        ))
      )}

      {invoicePreview ? (
        <Modal
          title="Antes e depois do recálculo"
          description="Recálculo aplicado somente nos campos derivados da fatura."
          onClose={() => setInvoicePreview(null)}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <InvoiceTotalsCard title="Antes" values={invoicePreview.before} />
            <InvoiceTotalsCard title="Depois" values={invoicePreview.after} />
          </div>
          <div className="mt-6 flex justify-end">
            <ActionButton type="button" variant="secondary" onClick={() => setInvoicePreview(null)}>
              Fechar
            </ActionButton>
          </div>
        </Modal>
      ) : null}

      {fixInvoicePreview ? (
        <Modal
          title="Confirmar correção da fatura"
          description="Revise a fatura sugerida antes de vincular o lançamento."
          onClose={() => setFixInvoicePreview(null)}
        >
          <div className="space-y-4">
            <div className="hub-card rounded-lg border border-ink-950/10 bg-slate-50 p-4 text-sm text-ink-700 dark:border-white/10 dark:text-slate-200">
              <p><strong className="text-ink-950 dark:text-slate-100">Lançamento:</strong> {fixInvoicePreview.item.title}</p>
              <p className="mt-1"><strong className="text-ink-950 dark:text-slate-100">Antes:</strong> {fixInvoicePreview.item.invoiceId ? `invoice_id ${fixInvoicePreview.item.invoiceId}` : "sem fatura"}</p>
              {fixInvoicePreview.item.suggestedInvoicePreview ? (
                <p className="mt-1">
                  <strong className="text-ink-950 dark:text-slate-100">Depois:</strong> referência {fixInvoicePreview.item.suggestedInvoicePreview.referenceMonth.slice(0, 7)} ·
                  fechamento {formatDate(fixInvoicePreview.item.suggestedInvoicePreview.closingDate)} ·
                  vencimento {formatDate(fixInvoicePreview.item.suggestedInvoicePreview.dueDate)}.
                </p>
              ) : null}
            </div>
            <p className="text-sm leading-6 text-ink-600 dark:text-slate-300">
              Se a fatura do ciclo ainda não existir, ela será criada e o lançamento será vinculado. O total da fatura antiga e da nova será recalculado.
            </p>
            <div className="flex justify-end gap-2">
              <ActionButton type="button" variant="secondary" onClick={() => setFixInvoicePreview(null)}>
                Cancelar
              </ActionButton>
              <ActionButton
                type="button"
                onClick={() => void handleConfirmFixInvoice(fixInvoicePreview.item)}
                disabled={busyKey === `fix:${fixInvoicePreview.item.transactionId}`}
              >
                {busyKey === `fix:${fixInvoicePreview.item.transactionId}` ? "Salvando..." : "Confirmar correção"}
              </ActionButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function primaryItemHref(item: FinancialDiagnosticItem) {
  if (item.reimbursementId) return "/dashboard/reimbursements";
  if (item.installmentId) return "/dashboard/installments";
  if (item.subjectType === "goal") return "/dashboard/goals";
  if (item.subjectType === "planned_purchase") return "/dashboard/purchases";
  if (item.invoiceId) return `/dashboard/invoices/${item.invoiceId}`;
  return "/dashboard";
}

function InvoiceTotalsCard({
  title,
  values,
}: {
  title: string;
  values: {
    totalAmount: number;
    personalAmount: number;
    reimbursableAmount: number;
    thirdPartyAmount: number;
  };
}) {
  return (
    <div className="hub-card rounded-lg border border-ink-950/10 p-4">
      <p className="text-sm font-semibold text-ink-950 dark:text-slate-100">{title}</p>
      <div className="mt-3 space-y-2 text-sm text-ink-700 dark:text-slate-200">
        <div className="flex items-center justify-between gap-4"><span>Total</span><span>{formatCurrency(values.totalAmount)}</span></div>
        <div className="flex items-center justify-between gap-4"><span>Pessoal</span><span>{formatCurrency(values.personalAmount)}</span></div>
        <div className="flex items-center justify-between gap-4"><span>Reembolsável</span><span>{formatCurrency(values.reimbursableAmount)}</span></div>
        <div className="flex items-center justify-between gap-4"><span>Terceiros</span><span>{formatCurrency(values.thirdPartyAmount)}</span></div>
      </div>
    </div>
  );
}
