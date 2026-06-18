"use client";

import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { createClient } from "@/lib/supabase/client";
import type { AuditLog, DashboardUser } from "@/lib/supabase/types";

import { FieldShell, inputClassName } from "@/features/shared/crud-ui";
import { listAuditLogs } from "@/features/audit/queries";
import {
  auditActions,
  auditModules,
  formatAuditValue,
  getAuditActionLabel,
  getAuditModuleLabel,
} from "@/features/audit/types";

export function AuditHistoryPage() {
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [module, setModule] = useState("all");
  const [action, setAction] = useState("all");
  const [text, setText] = useState("");
  const [recordId, setRecordId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    void createClient().auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
      if (!data.user) setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    let active = true;
    setLoading(true);
    setError(null);

    void listAuditLogs(createClient(), user.id, {
      module,
      action,
      text,
      recordId,
      dateFrom,
      dateTo,
    })
      .then((result) => {
        if (!active) return;
        if (result.error) {
          console.error("Erro técnico ao carregar histórico geral:", result.error);
          setError("Não foi possível carregar o histórico.");
          return;
        }
        setRows(result.data ?? []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [action, dateFrom, dateTo, module, recordId, text, user?.id]);

  const countByAction = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.action] = (acc[row.action] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  return (
    <div className="space-y-6">
      <SectionCard title="Filtros" description="Refine por módulo, ação, data, texto ou registro.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FieldShell label="Módulo">
            <select className={inputClassName} value={module} onChange={(event) => setModule(event.target.value)}>
              <option value="all">Todos</option>
              {auditModules.map((item) => (
                <option key={item} value={item}>
                  {getAuditModuleLabel(item)}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Ação">
            <select className={inputClassName} value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="all">Todas</option>
              {auditActions.map((item) => (
                <option key={item} value={item}>
                  {getAuditActionLabel(item)}
                </option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Registro">
            <input className={inputClassName} value={recordId} onChange={(event) => setRecordId(event.target.value)} placeholder="ID do registro" />
          </FieldShell>
          <FieldShell label="Texto">
            <input className={inputClassName} value={text} onChange={(event) => setText(event.target.value)} placeholder="Campo, módulo ou ação" />
          </FieldShell>
          <FieldShell label="Data inicial">
            <input type="date" className={inputClassName} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </FieldShell>
          <FieldShell label="Data final">
            <input type="date" className={inputClassName} value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </FieldShell>
        </div>
      </SectionCard>

      <SectionCard title="Histórico" description="Alterações importantes registradas por módulo e ação.">
        {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
        {loading ? <p className="text-sm text-ink-600 dark:text-slate-300">Carregando histórico...</p> : null}
        {!loading && rows.length === 0 ? (
          <EmptyState title="Nenhum histórico encontrado" description="Ajuste os filtros ou faça uma alteração importante para ver registros aqui." />
        ) : null}
        {rows.length > 0 ? (
          <>
            <div className="mb-4 flex flex-wrap gap-2 text-xs text-ink-600 dark:text-slate-300">
              {Object.entries(countByAction).map(([name, count]) => (
                <span key={name} className="rounded-full border border-ink-950/10 px-3 py-1 dark:border-white/10">
                  {getAuditActionLabel(name)}: {count}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-ink-950/[0.03] text-left text-xs uppercase tracking-wide text-ink-500 dark:bg-white/[0.04] dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Quando</th>
                    <th className="px-4 py-3">Módulo</th>
                    <th className="px-4 py-3">Ação</th>
                    <th className="px-4 py-3">Registro</th>
                    <th className="px-4 py-3">Campo</th>
                    <th className="px-4 py-3">Antes</th>
                    <th className="px-4 py-3">Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-ink-950/10 align-top dark:border-white/10">
                      <td className="px-4 py-3 text-ink-600 dark:text-slate-300">{formatDateTime(row.created_at)}</td>
                      <td className="px-4 py-3">{getAuditModuleLabel(row.module)}</td>
                      <td className="px-4 py-3">{getAuditActionLabel(row.action)}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.record_id ?? "-"}</td>
                      <td className="px-4 py-3">{row.field_name ?? "-"}</td>
                      <td className="px-4 py-3">{formatAuditValue(row.old_value)}</td>
                      <td className="px-4 py-3">{formatAuditValue(row.new_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </SectionCard>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
