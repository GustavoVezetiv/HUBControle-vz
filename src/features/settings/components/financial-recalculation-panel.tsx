"use client";

import { useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import {
  buildFinancialRecalculationPreview,
  executeFinancialRecalculation,
  type ExecuteFinancialRecalculationResult,
  type FinancialInvoiceRecalculationRow,
  type FinancialRecalculationPreview,
  type FinancialReimbursementRecalculationRow,
} from "@/features/settings/financial-recalculation";
import { ActionButton, CrudFeedback, Modal, TextBadge } from "@/features/shared/crud-ui";
import { formatCurrency, formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

export function FinancialRecalculationPanel({ userId }: { userId: string | null }) {
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<FinancialRecalculationPreview | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [allowPaidInvoices, setAllowPaidInvoices] = useState(false);
  const [updateReimbursementStatuses, setUpdateReimbursementStatuses] = useState(false);
  const [lastExecution, setLastExecution] = useState<ExecuteFinancialRecalculationResult | null>(null);

  async function handleGeneratePreview() {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setLoadingPreview(true);
    setFeedback(null);

    try {
      const result = await buildFinancialRecalculationPreview(createClient(), userId);

      if (result.error || !result.data) {
        setFeedback({ type: "error", message: result.error?.message ?? "Não foi possível gerar a prévia." });
        return;
      }

      setAllowPaidInvoices(false);
      setUpdateReimbursementStatuses(false);
      setPreview(result.data);
    } catch (error) {
      console.error("Erro técnico ao gerar prévia do recálculo financeiro:", error);
      setFeedback({ type: "error", message: "Não foi possível gerar a prévia do recálculo financeiro." });
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleExecute() {
    if (!userId || !preview) return;

    setExecuting(true);
    setFeedback(null);

    try {
      const result = await executeFinancialRecalculation(createClient(), userId, preview, {
        updateDerivedReimbursementStatuses: updateReimbursementStatuses,
        allowPaidInvoiceUpdates: allowPaidInvoices,
      });

      if (result.error || !result.data) {
        setFeedback({ type: "error", message: result.error?.message ?? "Não foi possível executar o recálculo." });
        return;
      }

      setLastExecution(result.data);
      setPreview(null);
      setFeedback({
        type: result.data.failures.length > 0 ? "error" : "success",
        message:
          result.data.failures.length > 0
            ? "Recálculo executado com falhas parciais. Revise o log abaixo."
            : "Recálculo financeiro executado.",
      });
    } catch (error) {
      console.error("Erro técnico ao executar recálculo financeiro:", error);
      setFeedback({ type: "error", message: "Não foi possível executar o recálculo financeiro." });
    } finally {
      setExecuting(false);
    }
  }

  return (
    <SectionCard
      title="Diagnóstico financeiro"
      description="Recalcule campos derivados com prévia antes de gravar. Não altera valores manuais principais."
    >
      <CrudFeedback feedback={feedback} />
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionButton type="button" onClick={() => void handleGeneratePreview()} disabled={loadingPreview || executing}>
          {loadingPreview ? "Gerando prévia..." : "Recalcular dados financeiros"}
        </ActionButton>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Última prévia"
          value={preview ? formatDate(preview.generatedAt.slice(0, 10)) : "-"}
          helper="Gerada sob demanda antes da execução."
          tone="info"
        />
        <StatCard
          label="Divergências em faturas"
          value={String(preview?.invoiceDivergenceCount ?? 0)}
          helper="Faturas cujo total derivado não bate com o salvo."
          tone={(preview?.invoiceDivergenceCount ?? 0) > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Sugestões em reembolsos"
          value={String(preview?.reimbursementSuggestedStatusCount ?? 0)}
          helper="Status derivado diferente do status atual."
          tone={(preview?.reimbursementSuggestedStatusCount ?? 0) > 0 ? "warning" : "neutral"}
        />
        <StatCard
          label="Última execução"
          value={lastExecution ? formatDate(lastExecution.executedAt.slice(0, 10)) : "-"}
          helper="Log simples da última rodada executada nesta sessão."
          tone="success"
        />
      </div>

      {lastExecution ? (
        <div className="mt-4 rounded-lg border border-ink-950/10 bg-slate-50 p-4 text-sm text-ink-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200">
          <p className="font-semibold text-ink-950 dark:text-slate-100">Log da última execução</p>
          <p className="mt-2">
            Faturas atualizadas: {lastExecution.updatedInvoices}. Reembolsos atualizados: {lastExecution.updatedReimbursements}. Faturas pagas puladas: {lastExecution.skippedPaidInvoices}.
          </p>
          {lastExecution.failures.length > 0 ? (
            <div className="mt-3 space-y-1">
              {lastExecution.failures.map((failure) => (
                <p key={failure} className="text-danger-600">{failure}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <FinancialRecalculationPreviewModal
          allowPaidInvoices={allowPaidInvoices}
          executing={executing}
          preview={preview}
          updateReimbursementStatuses={updateReimbursementStatuses}
          onClose={() => setPreview(null)}
          onConfirm={() => void handleExecute()}
          onTogglePaidInvoices={() => setAllowPaidInvoices((value) => !value)}
          onToggleReimbursementStatuses={() => setUpdateReimbursementStatuses((value) => !value)}
        />
      ) : null}
    </SectionCard>
  );
}

function FinancialRecalculationPreviewModal({
  allowPaidInvoices,
  executing,
  preview,
  updateReimbursementStatuses,
  onClose,
  onConfirm,
  onTogglePaidInvoices,
  onToggleReimbursementStatuses,
}: {
  allowPaidInvoices: boolean;
  executing: boolean;
  preview: FinancialRecalculationPreview;
  updateReimbursementStatuses: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onTogglePaidInvoices: () => void;
  onToggleReimbursementStatuses: () => void;
}) {
  const divergentInvoices = preview.invoiceRows.filter((row) => row.changed);
  const reimbursementChanges = preview.reimbursementRows.filter((row) => row.statusWillChange);
  const canExecute = preview.paidInvoiceDivergenceCount === 0 || allowPaidInvoices;

  return (
    <Modal
      title="Prévia do recálculo financeiro"
      description="Revise as divergências antes de recalcular os campos derivados."
      onClose={onClose}
    >
      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Faturas afetadas" value={String(preview.invoiceCount)} helper="Faturas lidas na análise." tone="info" />
          <StatCard label="Faturas com divergência" value={String(preview.invoiceDivergenceCount)} helper="Terão atualização de campos derivados." tone={preview.invoiceDivergenceCount > 0 ? "warning" : "neutral"} />
          <StatCard label="Reembolsos com status sugerido" value={String(preview.reimbursementSuggestedStatusCount)} helper="Só atualiza se você confirmar." tone={preview.reimbursementSuggestedStatusCount > 0 ? "warning" : "neutral"} />
          <StatCard label="Compras conferidas" value={String(preview.purchaseSummary.itemCount)} helper="Resumo recalculado em memória." tone="success" />
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Compras: estimado" value={formatCurrency(preview.purchaseSummary.totalEstimated)} helper="Soma de `estimated_amount`." tone="info" />
          <StatCard label="Compras: pago" value={formatCurrency(preview.purchaseSummary.totalPaid)} helper="Soma de `paid_amount`." tone="success" />
          <StatCard label="Economia" value={formatCurrency(preview.purchaseSummary.economy)} helper="Estimado menos pago, quando positivo." tone="success" />
          <StatCard label="Estouro" value={formatCurrency(preview.purchaseSummary.overrun)} helper="Pago acima do estimado, quando houver." tone={preview.purchaseSummary.overrun > 0 ? "danger" : "neutral"} />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">Divergências de faturas</h3>
            <TextBadge tone={divergentInvoices.length > 0 ? "warning" : "neutral"}>
              {divergentInvoices.length} divergência(s)
            </TextBadge>
          </div>
          {divergentInvoices.length === 0 ? (
            <p className="text-sm text-ink-600 dark:text-slate-300">Nenhuma divergência de fatura encontrada.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-ink-950/10 dark:border-white/10">
              <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm dark:divide-white/10">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600 dark:bg-slate-900 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Fatura</th>
                    <th className="px-4 py-3">Atual</th>
                    <th className="px-4 py-3">Recalculado</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-950/10 dark:divide-white/10">
                  {divergentInvoices.slice(0, 12).map((row) => (
                    <InvoicePreviewRow key={row.invoiceId} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink-950 dark:text-slate-100">Status sugerido de reembolsos</h3>
            <TextBadge tone={reimbursementChanges.length > 0 ? "warning" : "neutral"}>
              {reimbursementChanges.length} sugestão(ões)
            </TextBadge>
          </div>
          {reimbursementChanges.length === 0 ? (
            <p className="text-sm text-ink-600 dark:text-slate-300">Nenhum status de reembolso precisa ser ajustado.</p>
          ) : (
            <div className="space-y-2">
              {reimbursementChanges.slice(0, 10).map((row) => (
                <ReimbursementPreviewRow key={row.reimbursementId} row={row} />
              ))}
            </div>
          )}
        </section>

        {preview.paidInvoiceDivergenceCount > 0 ? (
          <label className="flex items-start gap-3 rounded-lg border border-danger-600/20 bg-danger-100 px-4 py-3 text-sm leading-6 text-danger-600 dark:border-danger-600/40 dark:bg-slate-900 dark:text-slate-100">
            <input type="checkbox" className="mt-1" checked={allowPaidInvoices} onChange={onTogglePaidInvoices} />
            <span>
              Confirmo o recálculo de {preview.paidInvoiceDivergenceCount} fatura(s) paga(s). Isso altera apenas campos derivados, não os lançamentos principais.
            </span>
          </label>
        ) : null}

        {preview.reimbursementSuggestedStatusCount > 0 ? (
          <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-300/20 dark:bg-amber-950/40 dark:text-amber-100">
            <input type="checkbox" className="mt-1" checked={updateReimbursementStatuses} onChange={onToggleReimbursementStatuses} />
            <span>
              Atualizar status derivado dos reembolsos com base em saldo aberto e atraso por data.
            </span>
          </label>
        ) : null}

        <div className="flex justify-end gap-2">
          <ActionButton type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </ActionButton>
          <ActionButton type="button" onClick={onConfirm} disabled={!canExecute || executing}>
            {executing ? "Executando..." : "Executar recálculo"}
          </ActionButton>
        </div>
      </div>
    </Modal>
  );
}

function InvoicePreviewRow({ row }: { row: FinancialInvoiceRecalculationRow }) {
  return (
    <tr>
      <td className="px-4 py-3 text-ink-950 dark:text-slate-100">
        <div className="font-semibold">{row.cardName}</div>
        <div className="text-xs text-ink-600 dark:text-slate-300">
          {row.referenceMonth.slice(0, 7)} · vence {formatDate(row.dueDate)}
        </div>
      </td>
      <td className="px-4 py-3 text-ink-600 dark:text-slate-300">
        <div>Total: {formatCurrency(row.current.totalAmount)}</div>
        <div>Pessoal: {formatCurrency(row.current.personalAmount)}</div>
        <div>Reembolsável: {formatCurrency(row.current.reimbursableAmount)}</div>
        <div>Terceiros: {formatCurrency(row.current.thirdPartyAmount)}</div>
      </td>
      <td className="px-4 py-3 text-ink-950 dark:text-slate-100">
        <div>Total: {formatCurrency(row.recalculated.totalAmount)}</div>
        <div>Pessoal: {formatCurrency(row.recalculated.personalAmount)}</div>
        <div>Reembolsável: {formatCurrency(row.recalculated.reimbursableAmount)}</div>
        <div>Terceiros: {formatCurrency(row.recalculated.thirdPartyAmount)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-2">
          <TextBadge tone={row.isPaid ? "danger" : "warning"}>{row.isPaid ? "Paga" : "Aberta"}</TextBadge>
          <span className="text-xs text-ink-600 dark:text-slate-300">{row.status}</span>
        </div>
      </td>
    </tr>
  );
}

function ReimbursementPreviewRow({ row }: { row: FinancialReimbursementRecalculationRow }) {
  return (
    <div className="rounded-lg border border-ink-950/10 bg-slate-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink-950 dark:text-slate-100">{row.description}</p>
          <p className="text-xs text-ink-600 dark:text-slate-300">
            Esperado {formatCurrency(row.expectedAmount)} · Recebido {formatCurrency(row.receivedAmount)} · Em aberto {formatCurrency(row.openAmount)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TextBadge tone="neutral">{row.currentStatus}</TextBadge>
          <TextBadge tone={row.isLateByDate ? "danger" : "warning"}>{row.suggestedStatus}</TextBadge>
        </div>
      </div>
    </div>
  );
}
