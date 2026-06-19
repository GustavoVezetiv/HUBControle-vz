"use client";

import { useEffect, useState } from "react";

import { SectionCard } from "@/components/ui/section-card";
import { ActionButton, CrudFeedback, FieldShell, inputClassName } from "@/features/shared/crud-ui";
import type { FeedbackState } from "@/features/shared/types";
import { createClient } from "@/lib/supabase/client";

import {
  exportBundleAsJson,
  exportBundleAsXlsx,
  loadLastExportSummary,
  loadLatestBackupExportSummary,
  exportModuleOptions,
  type LastExportSummary,
  type ExportModule,
} from "@/features/settings/export-backup";

export function ExportBackupPanel({
  userId,
  email,
}: {
  userId: string | null;
  email: string | null;
}) {
  const [selectedModule, setSelectedModule] = useState<ExportModule>("accounts_payable");
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [lastExport, setLastExport] = useState<LastExportSummary | null>(null);

  useEffect(() => {
    if (!userId) {
      setLastExport(null);
      return;
    }

    const currentUserId = userId;
    const client = createClient();
    let cancelled = false;

    async function loadSummary() {
      const historySummary = await loadLatestBackupExportSummary(client, currentUserId);
      if (cancelled) return;
      setLastExport(historySummary ?? loadLastExportSummary(currentUserId));
    }

    void loadSummary();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function runExport(target: "all-xlsx" | "all-json" | "module-xlsx" | "module-json") {
    if (!userId) {
      setFeedback({ type: "error", message: "Sessão não encontrada. Entre novamente." });
      return;
    }

    setLoadingTarget(target);
    setFeedback(null);

    try {
      const client = createClient();
      if (target === "all-xlsx") {
        await exportBundleAsXlsx(client, userId, email, "all");
      }
      if (target === "all-json") {
        await exportBundleAsJson(client, userId, email, "all");
      }
      if (target === "module-xlsx") {
        await exportBundleAsXlsx(client, userId, email, selectedModule);
      }
      if (target === "module-json") {
        await exportBundleAsJson(client, userId, email, selectedModule);
      }

      const historySummary = await loadLatestBackupExportSummary(client, userId);
      setLastExport(historySummary ?? loadLastExportSummary(userId));
      setFeedback({ type: "success", message: "Exportação concluída." });
    } catch (error) {
      console.error("Erro técnico ao exportar backup:", error);
      setFeedback({ type: "error", message: "Não foi possível exportar os dados." });
    } finally {
      setLoadingTarget(null);
    }
  }

  return (
    <SectionCard title="Backup e exportação" description="Exporte seus dados para conferência externa ou backup manual. Apenas dados do usuário logado entram no arquivo.">
      <CrudFeedback feedback={feedback} />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-lg border border-ink-950/10 bg-slate-50 p-4 text-sm leading-6 text-ink-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200">
            <p className="font-semibold text-ink-950 dark:text-slate-100">Aviso de segurança</p>
            <p className="mt-1">Backup manual não substitui backup do Supabase, mas ajuda a recuperar e auditar dados.</p>
            <p className="mt-2">A exportação não inclui tokens, segredos, chaves privadas, refresh token do Google nem access token do Google.</p>
            <p className="mt-3 font-semibold text-ink-950 dark:text-slate-100">Formatos disponíveis</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>XLSX com uma aba por módulo e cabeçalhos legíveis.</li>
              <li>JSON com metadata, versão, data de exportação e módulos separados.</li>
              <li>Somente dados do usuário logado entram no arquivo.</li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-3">
            <ActionButton type="button" onClick={() => void runExport("all-xlsx")} disabled={Boolean(loadingTarget)}>
              {loadingTarget === "all-xlsx" ? "Exportando..." : "Exportar backup XLSX"}
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => void runExport("all-json")} disabled={Boolean(loadingTarget)}>
              {loadingTarget === "all-json" ? "Exportando..." : "Exportar backup JSON"}
            </ActionButton>
          </div>

          {lastExport ? (
            <div className="rounded-lg border border-ink-950/10 bg-white p-4 text-sm leading-6 text-ink-700 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200">
              <p className="font-semibold text-ink-950 dark:text-slate-100">Último backup/exportação</p>
              <p className="mt-1">Arquivo: {lastExport.fileName}</p>
              <p>Formato: {lastExport.format.toUpperCase()} · Escopo: {lastExport.scope === "all" ? "Tudo" : exportModuleOptions.find((option) => option.value === lastExport.scope)?.label ?? lastExport.scope}</p>
              {typeof lastExport.rowsExported === "number" ? <p>Registros exportados: {lastExport.rowsExported}</p> : null}
              {lastExport.modulesExported?.length ? <p>Módulos incluídos: {lastExport.modulesExported.map((moduleName) => exportModuleOptions.find((option) => option.value === moduleName)?.label ?? moduleName).join(", ")}</p> : null}
              <p>Gerado em: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(lastExport.exportedAt))}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-ink-950/10 bg-white p-4 text-sm text-ink-600 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-300">
              Nenhum backup/exportação registrado nesta sessão ainda.
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-lg border border-ink-950/10 bg-white p-4 dark:border-white/10 dark:bg-slate-950/60">
          <FieldShell label="Exportar módulo específico">
            <select className={inputClassName} value={selectedModule} onChange={(event) => setSelectedModule(event.target.value as ExportModule)}>
              {exportModuleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FieldShell>
          <p className="text-sm leading-6 text-ink-600 dark:text-slate-300">
            Módulos disponíveis: contas, receitas, pessoas, categorias, cartões, faturas, lançamentos, reembolsos, parcelamentos, compras e desejos, metas, revisão semanal, histórico, diagnóstico e importações.
          </p>
          <div className="flex flex-wrap gap-3">
            <ActionButton type="button" onClick={() => void runExport("module-xlsx")} disabled={Boolean(loadingTarget)}>
              {loadingTarget === "module-xlsx" ? "Exportando..." : "Exportar módulo em XLSX"}
            </ActionButton>
            <ActionButton type="button" variant="secondary" onClick={() => void runExport("module-json")} disabled={Boolean(loadingTarget)}>
              {loadingTarget === "module-json" ? "Exportando..." : "Exportar módulo em JSON"}
            </ActionButton>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
