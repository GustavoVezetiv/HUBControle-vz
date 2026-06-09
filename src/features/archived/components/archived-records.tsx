"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { ActionButton, CrudFeedback, inputClassName, TextBadge } from "@/features/shared/crud-ui";
import { restoreArchivedRecord, type ArchiveTarget } from "@/features/shared/archive";
import { formatCurrency, formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

type ModuleOption = {
  value: ArchiveTarget | "all";
  label: string;
};

type ArchivedRow = {
  id: string;
  module: ArchiveTarget;
  title: string;
  details: string;
  amount: number | null;
  archivedAt: string;
  archiveReason: string | null;
};

const moduleOptions: ModuleOption[] = [
  { value: "all", label: "Todos os módulos" },
  { value: "accounts_payable", label: "Contas" },
  { value: "income_sources", label: "Receitas" },
  { value: "credit_card_invoices", label: "Faturas" },
  { value: "credit_card_transactions", label: "Lançamentos de fatura" },
  { value: "reimbursements", label: "Reembolsos" },
  { value: "planned_purchases", label: "Compras e desejos" },
  { value: "goals", label: "Metas" },
];

export function ArchivedRecords() {
  const [rows, setRows] = useState<ArchivedRow[]>([]);
  const [moduleFilter, setModuleFilter] = useState<ArchiveTarget | "all">("all");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const filteredRows = useMemo(() => {
    if (moduleFilter === "all") return rows;
    return rows.filter((row) => row.module === moduleFilter);
  }, [moduleFilter, rows]);

  async function loadData() {
    setLoading(true);
    setFeedback(null);

    try {
      const client = createClient();
      const {
        data: { user },
        error: authError,
      } = await client.auth.getUser();

      if (authError || !user) {
        setFeedback({ type: "error", message: "Sessão não encontrada." });
        return;
      }

      setUserId(user.id);

      const [
        accountsResult,
        incomeResult,
        invoicesResult,
        transactionsResult,
        reimbursementsResult,
        purchasesResult,
        goalsResult,
      ] = await Promise.all([
        client.from("accounts_payable").select("id,title,amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
        client.from("income_sources").select("id,name,amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
        client.from("credit_card_invoices").select("id,reference_month,total_amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
        client.from("credit_card_transactions").select("id,description,amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
        client.from("reimbursements").select("id,description,expected_amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
        client.from("planned_purchases").select("id,title,estimated_amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
        client.from("goals").select("id,name,target_amount,archived_at,archive_reason").not("archived_at", "is", null).order("archived_at", { ascending: false }),
      ]);

      const firstError =
        accountsResult.error ||
        incomeResult.error ||
        invoicesResult.error ||
        transactionsResult.error ||
        reimbursementsResult.error ||
        purchasesResult.error ||
        goalsResult.error;

      if (firstError) {
        console.error("Erro técnico ao carregar arquivados:", firstError);
        setFeedback({ type: "error", message: "Não foi possível carregar os registros arquivados." });
        return;
      }

      const nextRows: ArchivedRow[] = [
        ...(accountsResult.data ?? []).map((item) => ({
          id: item.id,
          module: "accounts_payable" as const,
          title: item.title || "Conta sem título",
          details: "Conta a pagar",
          amount: item.amount ? Number(item.amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
        ...(incomeResult.data ?? []).map((item) => ({
          id: item.id,
          module: "income_sources" as const,
          title: item.name || "Receita sem nome",
          details: "Receita",
          amount: item.amount ? Number(item.amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
        ...(invoicesResult.data ?? []).map((item) => ({
          id: item.id,
          module: "credit_card_invoices" as const,
          title: `Fatura ${item.reference_month || "sem referência"}`,
          details: "Fatura",
          amount: item.total_amount ? Number(item.total_amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
        ...(transactionsResult.data ?? []).map((item) => ({
          id: item.id,
          module: "credit_card_transactions" as const,
          title: item.description || "Lançamento sem descrição",
          details: "Lançamento de fatura",
          amount: item.amount ? Number(item.amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
        ...(reimbursementsResult.data ?? []).map((item) => ({
          id: item.id,
          module: "reimbursements" as const,
          title: item.description || "Reembolso sem descrição",
          details: "Reembolso",
          amount: item.expected_amount ? Number(item.expected_amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
        ...(purchasesResult.data ?? []).map((item) => ({
          id: item.id,
          module: "planned_purchases" as const,
          title: item.title || "Compra sem nome",
          details: "Compra e desejo",
          amount: item.estimated_amount ? Number(item.estimated_amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
        ...(goalsResult.data ?? []).map((item) => ({
          id: item.id,
          module: "goals" as const,
          title: item.name || "Meta sem nome",
          details: "Meta",
          amount: item.target_amount ? Number(item.target_amount) : null,
          archivedAt: item.archived_at ?? "",
          archiveReason: item.archive_reason,
        })),
      ].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));

      setRows(nextRows);
    } catch (error) {
      console.error("Erro técnico ao carregar arquivados:", error);
      setFeedback({ type: "error", message: "Não foi possível carregar os registros arquivados." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleRestore(row: ArchivedRow) {
    if (!userId) return;

    setRestoringId(row.id);
    setFeedback(null);

    try {
      const { error } = await restoreArchivedRecord(createClient(), row.module, row.id, userId);

      if (error) {
        console.error("Erro técnico ao restaurar registro:", error);
        setFeedback({ type: "error", message: "Não foi possível restaurar o registro." });
        return;
      }

      setFeedback({ type: "success", message: "Registro restaurado." });
      await loadData();
    } catch (error) {
      console.error("Erro técnico ao restaurar registro:", error);
      setFeedback({ type: "error", message: "Não foi possível restaurar o registro." });
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Segurança"
        title="Arquivados"
        description="Registros arquivados saem das listas principais e podem ser restaurados quando necessário."
      />

      <CrudFeedback feedback={feedback} />

      <SectionCard title="Filtro" description="Escolha qual módulo deseja revisar.">
        <div className="max-w-sm">
          <label className="mb-2 block text-sm font-medium text-ink-800" htmlFor="archived-module-filter">
            Módulo
          </label>
          <select
            id="archived-module-filter"
            className={inputClassName}
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value as ArchiveTarget | "all")}
          >
            {moduleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </SectionCard>

      <SectionCard title="Registros arquivados" description="Arquivados não entram em dashboard, saldos e relatórios por padrão.">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando arquivados...</p>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            title="Nenhum registro arquivado"
            description="Quando você arquivar contas, receitas, faturas, lançamentos, reembolsos, compras ou metas, eles aparecerão aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">Registro</th>
                  <th className="px-4 py-3">Módulo</th>
                  <th className="px-4 py-3">Valor</th>
                  <th className="px-4 py-3">Arquivado em</th>
                  <th className="px-4 py-3">Motivo</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {filteredRows.map((row) => (
                  <tr key={`${row.module}-${row.id}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-950">{row.title}</p>
                      <p className="mt-1 text-xs text-ink-600">{row.details}</p>
                    </td>
                    <td className="px-4 py-3">
                      <TextBadge tone="neutral">
                        {moduleOptions.find((option) => option.value === row.module)?.label ?? row.module}
                      </TextBadge>
                    </td>
                    <td className="px-4 py-3 text-ink-950">
                      {row.amount === null ? "-" : formatCurrency(row.amount)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{formatDate(row.archivedAt)}</td>
                    <td className="px-4 py-3 text-ink-600">{row.archiveReason?.trim() || "Sem motivo informado"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <ActionButton
                          variant="secondary"
                          disabled={restoringId === row.id}
                          onClick={() => void handleRestore(row)}
                        >
                          {restoringId === row.id ? "Restaurando..." : "Restaurar"}
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
