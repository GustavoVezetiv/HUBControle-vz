"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { buildPreviewRows, buildSystemGoalsPurchasesPreviewRows, rowCounts } from "@/features/imports/import-engine";
import { parseSpreadsheetFile, parseSystemGoalsPurchasesFile } from "@/features/imports/parser";
import {
  confirmImportRows,
  createMissingImportCategories,
  listImportBatches,
  listImportRows,
  loadImportReferenceData,
  saveImportPreview,
  undoImportBatch,
} from "@/features/imports/queries";
import {
  activeImportTargets,
  downloadTemplate,
  futureImportTargets,
  getImportTargetConfig,
} from "@/features/imports/templates";
import type { ImportTarget, PreviewRow } from "@/features/imports/types";
import { ActionButton, CrudFeedback, inputClassName, TextBadge } from "@/features/shared/crud-ui";
import { formatDate } from "@/features/shared/format";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";
import type { ImportBatch } from "@/lib/supabase/types";

export function ImportsWorkbench() {
  const [target, setTarget] = useState<ImportTarget>("people");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workingAction, setWorkingAction] = useState<"parse" | "save" | "confirm" | "categories" | "undo" | "review" | null>(null);
  const [allowMissingCategories, setAllowMissingCategories] = useState(false);
  const [showCategoryCreationPreview, setShowCategoryCreationPreview] = useState(false);
  const [confirmCategoryCreation, setConfirmCategoryCreation] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>(null);

  const counts = useMemo(() => rowCounts(rows), [rows]);
  const systemStats = useMemo(() => buildSystemStats(rows), [rows]);
  const config = getImportTargetConfig(target);
  const working = workingAction !== null;
  const requiresMissingCategoryConfirmation =
    target === "system_goals_purchases" && systemStats.missingCategories.length > 0 && !allowMissingCategories;

  async function loadHistory() {
    const client = createClient();
    const { data: auth } = await client.auth.getUser();
    if (!auth.user) {
      setFeedback({ type: "error", message: "Sessão não encontrada." });
      setLoading(false);
      return;
    }
    setUserId(auth.user.id);
    const result = await listImportBatches(client);
    if (result.error) setFeedback({ type: "error", message: result.error.message });
    else setBatches(result.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  async function handleParse() {
    if (!file) {
      setFeedback({ type: "error", message: "Selecione um arquivo CSV ou XLSX." });
      return;
    }
    setWorkingAction("parse");
    setFeedback(null);
    try {
      const client = createClient();
      const references = await loadImportReferenceData(client);
      const preview =
        target === "system_goals_purchases"
          ? buildSystemGoalsPurchasesPreviewRows(await parseSystemGoalsPurchasesFile(file), references)
          : buildPreviewRows(target, await parseSpreadsheetFile(file), references);
      setRows(preview);
      setBatchId(null);
      setAllowMissingCategories(false);
      setShowCategoryCreationPreview(false);
      setConfirmCategoryCreation(false);
      setFeedback({ type: "success", message: `${preview.length} linhas lidas. Revise a prévia antes de confirmar.` });
    } catch (error) {
      console.error("Erro técnico ao processar arquivo de importação:", error);
      setFeedback({
        type: "error",
        message: "Não foi possível ler o arquivo. Verifique se ele é um CSV ou XLSX válido.",
      });
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleCreateMissingCategories() {
    if (!userId || systemStats.missingCategories.length === 0) return;
    if (!confirmCategoryCreation) {
      setFeedback({ type: "error", message: "Revise a prévia e confirme explicitamente antes de criar categorias." });
      return;
    }

    setWorkingAction("categories");
    setFeedback(null);
    try {
      const result = await createMissingImportCategories(createClient(), userId, systemStats.missingCategories);
      if (result.error) {
        console.error("Erro técnico ao criar categorias faltantes:", result.error);
        setFeedback({ type: "error", message: "Não foi possível criar as categorias faltantes." });
        return;
      }
      setFeedback({ type: "success", message: `${result.created} categorias criadas. Gere a prévia novamente para resolver os vínculos.` });
      setAllowMissingCategories(false);
      setShowCategoryCreationPreview(false);
      setConfirmCategoryCreation(false);
    } catch (error) {
      console.error("Erro técnico ao criar categorias faltantes:", error);
      setFeedback({ type: "error", message: "Não foi possível criar as categorias faltantes." });
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleUndo(batch: ImportBatch) {
    if (!userId) return;
    const confirmed = window.confirm(`Desfazer a importação ${batch.file_name}? Esta ação remove apenas registros criados por este lote.`);
    if (!confirmed) return;

    setWorkingAction("undo");
    setFeedback(null);
    try {
      const result = await undoImportBatch(createClient(), userId, batch.id);
      setFeedback({ type: "success", message: `Importação desfeita. ${result.deleted} registros removidos.` });
      await loadHistory();
    } catch (error) {
      console.error("Erro técnico ao desfazer importação:", error);
      setFeedback({ type: "error", message: "Não foi possível desfazer esta importação." });
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleReview(batch: ImportBatch) {
    if (!userId) return;
    setWorkingAction("review");
    setFeedback(null);
    try {
      const loadedRows = await listImportRows(createClient(), userId, batch.id);
      setTarget((batch.target_type ?? batch.module) as ImportTarget);
      setRows(loadedRows);
      setBatchId(batch.id);
      setAllowMissingCategories(false);
      setShowCategoryCreationPreview(false);
      setConfirmCategoryCreation(false);
      setFeedback({ type: "success", message: `Lote carregado para revisão: ${loadedRows.length} linhas.` });
    } catch (error) {
      console.error("Erro técnico ao revisar lote de importação:", error);
      setFeedback({ type: "error", message: "Não foi possível carregar as linhas deste lote." });
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleSavePreview() {
    if (!userId || !file || rows.length === 0) return;
    setWorkingAction("save");
    setFeedback(null);
    try {
      const result = await saveImportPreview(createClient(), userId, target, file, rows);
      if (result.batch.error || result.rows?.error) {
        console.error("Erro técnico ao salvar prévia de importação:", result.batch.error ?? result.rows?.error);
        setFeedback({
          type: "error",
          message: "Não foi possível salvar a prévia da importação. Revise os dados e tente novamente.",
        });
      } else {
        setBatchId(result.batch.data?.id ?? null);
        setFeedback({ type: "success", message: "Prévia salva. Agora você pode confirmar a importação." });
        await loadHistory();
      }
    } catch (error) {
      console.error("Erro técnico ao salvar prévia de importação:", error);
      setFeedback({ type: "error", message: "Não foi possível salvar a prévia da importação." });
    } finally {
      setWorkingAction(null);
    }
  }

  async function handleConfirm() {
    if (!userId || !batchId) {
      setFeedback({ type: "error", message: "Salve a prévia antes de confirmar." });
      return;
    }
    if (requiresMissingCategoryConfirmation) {
      setFeedback({
        type: "error",
        message: "Confirme explicitamente que deseja importar linhas sem categoria antes de continuar.",
      });
      return;
    }
    setWorkingAction("confirm");
    setFeedback(null);
    try {
      const updatedRows = await confirmImportRows(createClient(), userId, batchId, target, rows);
      setRows(updatedRows);
      const updatedCounts = rowCounts(updatedRows);
      setFeedback({
        type: "success",
        message: `Importação confirmada. ${updatedCounts.imported} linhas importadas, ${updatedCounts.failed} falharam e ${updatedCounts.skipped} foram ignoradas.`,
      });
      await loadHistory();
    } catch (error) {
      console.error("Erro técnico ao confirmar importação:", error);
      setFeedback({ type: "error", message: "Não foi possível confirmar a importação. Tente novamente." });
    } finally {
      setWorkingAction(null);
    }
  }

  function toggleSkip(rowNumber: number) {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.rowNumber !== rowNumber || row.status === "imported") return row;
        if (row.status === "skipped") {
          return { ...row, status: row.errors.length ? "invalid" : "valid" };
        }
        return { ...row, status: "skipped" };
      }),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Entrada rápida"
        title="Importações"
        description="Baixe modelos, envie CSV/XLSX, revise a prévia e confirme apenas linhas válidas."
      />
      <CrudFeedback feedback={feedback} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Total" value={String(counts.total)} helper="Linhas na prévia." tone="info" />
        <StatCard label="Válidas" value={String(counts.valid)} helper="Prontas para confirmar." tone="success" />
        <StatCard label="Inválidas" value={String(counts.invalid)} helper="Com erros de validação." tone="danger" />
        <StatCard label="Ignoradas" value={String(counts.skipped)} helper="Não serão importadas." tone="warning" />
        <StatCard label="Importadas" value={String(counts.imported)} helper="Já gravadas no módulo final." tone="success" />
        <StatCard label="Falhas" value={String(counts.failed)} helper="Erro ao gravar." tone="danger" />
      </section>

      {target === "system_goals_purchases" && rows.length > 0 ? (
        <SectionCard title="Resumo da prévia" description="Conferência obrigatória antes de gravar metas e compras.">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Metas lidas" value={String(systemStats.goals)} helper="Aba Metas_Sistema." tone="info" />
            <StatCard label="Compras lidas" value={String(systemStats.purchases)} helper="Aba Compras_Sistema." tone="info" />
            <StatCard label="Novos registros" value={String(systemStats.newRows)} helper="Válidos para importar." tone="success" />
            <StatCard label="Duplicados" value={String(systemStats.duplicates)} helper="Bloqueados por padrão." tone="warning" />
            <StatCard label="Com erro" value={String(systemStats.errors)} helper="Não serão importados." tone="danger" />
            <StatCard label="Categorias pendentes" value={String(systemStats.missingCategories.length)} helper="Podem ficar sem categoria." tone="warning" />
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <SummaryList title="Resumo por categoria" items={systemStats.byCategory} />
            <SummaryList title="Resumo por status" items={systemStats.byStatus} />
          </div>
          {systemStats.missingCategories.length > 0 ? (
            <div className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Categorias não encontradas</p>
              <p className="mt-1">Estas categorias não serão criadas automaticamente. Você pode importar sem categoria ou criar explicitamente antes de confirmar.</p>
              <p className="mt-2">{systemStats.missingCategories.join(", ")}</p>
              <div className="mt-3">
                <ActionButton
                  type="button"
                  variant="secondary"
                  disabled={working}
                  onClick={() => {
                    setShowCategoryCreationPreview(true);
                    setConfirmCategoryCreation(false);
                  }}
                >
                  Prévia de criação de categorias
                </ActionButton>
              </div>
              {showCategoryCreationPreview ? (
                <div className="mt-4 rounded-md border border-amber-300 bg-white p-3 text-ink-800">
                  <p className="font-semibold text-ink-950">Prévia das categorias que serão criadas</p>
                  <p className="mt-1 text-xs text-ink-600">
                    Todas serão criadas como categorias do seu usuário, com tipo other. Nenhum dado financeiro será alterado.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-slate-50 text-ink-600">
                        <tr>
                          <th className="px-3 py-2">Nome</th>
                          <th className="px-3 py-2">Tipo</th>
                          <th className="px-3 py-2">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {systemStats.missingCategories.map((name) => (
                          <tr key={name} className="border-t border-ink-950/10">
                            <td className="px-3 py-2 font-semibold text-ink-950">{name}</td>
                            <td className="px-3 py-2">other</td>
                            <td className="px-3 py-2">Criar categoria</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <label className="mt-3 flex items-start gap-3 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={confirmCategoryCreation}
                      onChange={(event) => setConfirmCategoryCreation(event.target.checked)}
                    />
                    <span>Confirmo que revisei a prévia e quero criar estas categorias faltantes.</span>
                  </label>
                  <div className="mt-3">
                    <ActionButton type="button" variant="secondary" disabled={working || !confirmCategoryCreation} onClick={() => void handleCreateMissingCategories()}>
                      {workingAction === "categories" ? "Criando..." : "Confirmar criação de categorias"}
                    </ActionButton>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          {systemStats.missingCategories.length > 0 ? (
            <label className="mt-4 flex items-start gap-3 rounded-md border border-amber-300 bg-white p-4 text-sm text-ink-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={allowMissingCategories}
                onChange={(event) => setAllowMissingCategories(event.target.checked)}
              />
              <span>
                Confirmo que revisei as categorias pendentes e quero permitir a importação dessas linhas sem categoria.
                Categorias não serão criadas automaticamente.
              </span>
            </label>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Como usar" description="Fluxo simples e seguro para o MVP.">
        <ul className="space-y-2 text-sm leading-6 text-ink-600">
          <li>Baixe o modelo, preencha os campos e importe o arquivo.</li>
          <li>Categorias e pessoas referenciadas precisam existir antes da importação.</li>
          <li>Para Metas e compras, use XLSX com as abas Metas_Sistema e Compras_Sistema.</li>
          <li>Categorias ausentes aparecem como pendência e não são criadas automaticamente.</li>
          <li>Linhas inválidas não serão importadas.</li>
          <li>Você poderá revisar a prévia antes de confirmar.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Modelos de planilha" description="CSV com cabeçalhos estáveis em português.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {activeImportTargets.map((item) => (
            <button
              key={item.target}
              type="button"
              onClick={() => downloadTemplate(item.target)}
              className="rounded-md border border-ink-950/10 bg-white p-4 text-left transition hover:border-mint-500 hover:text-mint-600"
            >
              <span className="block text-sm font-semibold text-ink-950">{item.label}</span>
              <span className="mt-1 block text-sm leading-6 text-ink-600">{item.description}</span>
            </button>
          ))}
        </div>
        <div className="mt-5 border-t border-ink-950/10 pt-5">
          <p className="text-sm font-semibold text-ink-950">Em breve</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {futureImportTargets.map((item) => (
              <div
                key={item.target}
                className="rounded-md border border-dashed border-ink-950/10 bg-slate-50 p-4 text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="block text-sm font-semibold text-ink-950">{item.label}</span>
                  <TextBadge tone="neutral">Em breve</TextBadge>
                </div>
                <span className="mt-1 block text-sm leading-6 text-ink-600">{item.description}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Nova importação" description="A gravação final só acontece depois da confirmação.">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="text-sm font-medium text-ink-800">Módulo</span>
            <select
              className={`${inputClassName} mt-2`}
              value={target}
              onChange={(event) => {
                setTarget(event.target.value as ImportTarget);
                setRows([]);
                setBatchId(null);
                setAllowMissingCategories(false);
                setShowCategoryCreationPreview(false);
                setConfirmCategoryCreation(false);
              }}
            >
              {activeImportTargets.map((item) => (
                <option key={item.target} value={item.target}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-800">Arquivo CSV ou XLSX</span>
            <input
              className={`${inputClassName} mt-2`}
              type="file"
              accept=".csv,.xlsx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="flex items-end gap-2">
            <ActionButton type="button" variant="secondary" onClick={() => downloadTemplate(target)}>
              Modelo
            </ActionButton>
            <ActionButton type="button" onClick={() => void handleParse()} disabled={working}>
              {workingAction === "parse" ? "Processando..." : "Prévia"}
            </ActionButton>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-ink-600">
          Alvo selecionado: <strong>{config.label}</strong>. Neste MVP, categorias e pessoas
          informadas na planilha precisam existir antes da importação.
        </p>
      </SectionCard>

      <SectionCard title="Prévia" description="Revise erros e ignore linhas antes de confirmar.">
        {rows.length === 0 ? (
          <EmptyState title="Nenhum arquivo processado" description="Envie um CSV ou XLSX para ver a prévia das linhas aqui." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">
              <ActionButton type="button" variant="secondary" onClick={() => void handleSavePreview()} disabled={working || !file}>
                {workingAction === "save" ? "Salvando..." : "Salvar prévia"}
              </ActionButton>
              <ActionButton type="button" onClick={() => void handleConfirm()} disabled={working || !batchId || requiresMissingCategoryConfirmation}>
                {workingAction === "confirm" ? "Importando..." : "Confirmar importação"}
              </ActionButton>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                  <tr>
                    <th className="px-4 py-3">Linha</th>
                    <th className="px-4 py-3">Destino</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Erros e avisos</th>
                    <th className="px-4 py-3">Dados originais</th>
                    <th className="px-4 py-3">Dados mapeados</th>
                    <th className="px-4 py-3 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-950/10">
                  {rows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-4 py-3 text-ink-600">{row.rowNumber}</td>
                      <td className="px-4 py-3 text-ink-600">{formatTarget(row.target ?? target)}</td>
                      <td className="px-4 py-3"><StatusPill status={row.status} /></td>
                      <td className="px-4 py-3">
                        {row.errors.length ? <p className="text-danger-600">{row.errors.join(" | ")}</p> : null}
                        {row.warnings?.length ? <p className="mt-1 text-amber-700">{row.warnings.join(" | ")}</p> : null}
                        {!row.errors.length && !row.warnings?.length ? <span className="text-ink-500">-</span> : null}
                      </td>
                      <td className="max-w-md px-4 py-3 text-ink-600">
                        <pre className="max-h-28 overflow-auto rounded-md bg-slate-50 p-3 text-xs">
                          {JSON.stringify(row.raw, null, 2)}
                        </pre>
                      </td>
                      <td className="max-w-md px-4 py-3 text-ink-600">
                        <pre className="max-h-28 overflow-auto rounded-md bg-slate-50 p-3 text-xs">
                          {JSON.stringify(row.mapped, null, 2)}
                        </pre>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ActionButton
                          type="button"
                          variant={row.status === "skipped" ? "secondary" : "danger"}
                          onClick={() => toggleSkip(row.rowNumber)}
                          disabled={row.status === "imported"}
                        >
                          {row.status === "skipped" ? "Importar" : "Ignorar"}
                        </ActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Histórico de importações">
        {loading ? (
          <p className="text-sm text-ink-600">Carregando importações...</p>
        ) : batches.length === 0 ? (
          <EmptyState title="Nenhuma importação salva" description="As prévias salvas e importações confirmadas aparecerão aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-ink-950/10 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-ink-600">
                <tr>
                  <th className="px-4 py-3">Arquivo</th>
                  <th className="px-4 py-3">Módulo</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Linhas</th>
                  <th className="px-4 py-3">Erros</th>
                  <th className="px-4 py-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-950/10">
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-4 py-3 font-medium text-ink-950">{batch.file_name}</td>
                    <td className="px-4 py-3 text-ink-600">{batch.target_type ?? batch.module}</td>
                    <td className="px-4 py-3 text-ink-600">{formatDate(batch.created_at)}</td>
                    <td className="px-4 py-3"><StatusPill status={batch.status} /></td>
                    <td className="px-4 py-3 text-ink-600">{batch.valid_rows}/{batch.total_rows}</td>
                    <td className="px-4 py-3 text-ink-600">{batch.invalid_rows}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <ActionButton type="button" variant="secondary" disabled={working} onClick={() => void handleReview(batch)}>
                          {workingAction === "review" ? "Carregando..." : "Revisar"}
                        </ActionButton>
                        {batch.status === "confirmed" && ["system_goals_purchases", "goals", "planned_purchases"].includes(batch.target_type ?? batch.module) ? (
                          <ActionButton type="button" variant="danger" disabled={working} onClick={() => void handleUndo(batch)}>
                            {workingAction === "undo" ? "Desfazendo..." : "Desfazer"}
                          </ActionButton>
                        ) : null}
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

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "valid" || status === "confirmed" || status === "imported"
      ? "success"
      : status === "invalid" || status === "failed"
        ? "danger"
        : status === "skipped"
          ? "warning"
          : "info";
  const label: Record<string, string> = {
    valid: "Válida",
    invalid: "Inválida",
    skipped: "Ignorada",
    imported: "Importada",
    failed: "Falhou",
    parsed: "Prévia salva",
    confirmed: "Confirmada",
    draft: "Rascunho",
  };
  return <TextBadge tone={tone}>{label[status] ?? status}</TextBadge>;
}

function formatTarget(target: ImportTarget) {
  const labels: Record<ImportTarget, string> = {
    people: "Pessoas",
    categories: "Categorias",
    accounts_payable: "Contas",
    income_sources: "Receitas",
    credit_cards: "Cartões",
    credit_card_invoices: "Faturas",
    credit_card_transactions: "Lançamentos",
    reimbursements: "Reembolsos",
    installments: "Parcelamentos",
    planned_purchases: "Compras",
    goals: "Metas",
    system_goals_purchases: "Metas e compras",
  };
  return labels[target] ?? target;
}

function buildSystemStats(rows: PreviewRow[]) {
  const missingCategories = Array.from(
    new Set(rows.map((row) => row.missingCategoryName).filter((name): name is string => Boolean(name))),
  ).sort((a, b) => a.localeCompare(b));

  return {
    goals: rows.filter((row) => row.target === "goals").length,
    purchases: rows.filter((row) => row.target === "planned_purchases").length,
    newRows: rows.filter((row) => row.status === "valid" && !row.duplicate).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    errors: rows.filter((row) => row.status === "invalid").length,
    missingCategories,
    byCategory: countBy(rows, (row) => String(row.mapped.category_label ?? row.mapped.goal_category ?? "Sem categoria")),
    byStatus: countBy(rows, (row) => String(row.mapped.status ?? row.status ?? "sem_status")),
  };
}

function countBy(rows: PreviewRow[], getKey: (row: PreviewRow) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = getKey(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function SummaryList({ title, items }: { title: string; items: [string, number][] }) {
  return (
    <div className="rounded-md border border-ink-950/10 bg-white p-4">
      <p className="text-sm font-semibold text-ink-950">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">Sem dados.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm text-ink-600">
          {items.map(([label, count]) => (
            <li key={label} className="flex items-center justify-between gap-4">
              <span>{label}</span>
              <span className="font-semibold text-ink-950">{count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
