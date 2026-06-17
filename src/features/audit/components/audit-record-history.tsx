"use client";

import { useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { createClient } from "@/lib/supabase/client";
import type { AuditLog } from "@/lib/supabase/types";

import { listRecordAuditLogs } from "@/features/audit/queries";
import { formatAuditValue, getAuditActionLabel } from "@/features/audit/types";

export function AuditRecordHistory({
  userId,
  module,
  recordId,
  title = "Histórico",
}: {
  userId: string | null;
  module: string;
  recordId: string | null;
  title?: string;
}) {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !recordId) return;

    let active = true;
    setLoading(true);
    setError(null);

    void listRecordAuditLogs(createClient(), userId, module, recordId)
      .then((result) => {
        if (!active) return;
        if (result.error) {
          console.error("Erro técnico ao carregar histórico do registro:", result.error);
          setError("Não foi possível carregar o histórico deste registro.");
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
  }, [module, recordId, userId]);

  if (!recordId) return null;

  return (
    <SectionCard title={title} description="Últimas alterações registradas para este item.">
      {error ? <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}
      {loading ? <p className="text-sm text-ink-600 dark:text-slate-300">Carregando histórico...</p> : null}
      {!loading && rows.length === 0 ? (
        <EmptyState title="Sem histórico ainda" description="As próximas alterações importantes aparecerão aqui." />
      ) : null}
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-ink-950/10 bg-white/80 px-4 py-3 text-sm text-ink-700 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-ink-950 dark:text-slate-100">{getAuditActionLabel(row.action)}</strong>
                <span className="text-xs text-ink-500 dark:text-slate-400">{formatDateTime(row.created_at)}</span>
              </div>
              {row.field_name ? (
                <p className="mt-2">
                  <span className="font-medium">Campo:</span> {row.field_name}
                </p>
              ) : null}
              <p className="mt-1">
                <span className="font-medium">Antes:</span> {formatAuditValue(row.old_value)}
              </p>
              <p className="mt-1">
                <span className="font-medium">Depois:</span> {formatAuditValue(row.new_value)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
