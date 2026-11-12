"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Inbox, RefreshCw } from "lucide-react";
import type { PluggyDashboard } from "@/features/pluggy/service";
import { InboxCompositionChart } from "@/features/pluggy/components/inbox-composition-chart";
import styles from "@/features/pluggy/components/inbox-visuals.module.css";

export function DashboardInboxPreview({
  start,
  end,
  periodLabel,
}: {
  start: string;
  end: string;
  periodLabel: string;
}) {
  const [data, setData] = useState<PluggyDashboard | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await fetch("/api/pluggy/dashboard", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!result.ok) throw new Error("Unavailable");
        setData(await result.json());
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  const href = `/dashboard/imports/pluggy?${new URLSearchParams({ from: start, to: end })}`;
  const rows = (data?.movements ?? []).filter(
    (row) => !row.date || ((!start || row.date >= start) && (!end || row.date <= end)),
  );
  return (
    <section
      className={styles.preview}
      aria-label="Caixa de entrada financeira no Dashboard"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Inbox className={`h-5 w-5 ${styles.previewLink}`} aria-hidden />
            Caixa de Entrada Financeira
          </h2>
          <p className="mt-1 text-xs text-ink-600">
            {periodLabel} · recebido dos bancos, fora do saldo do Hub
          </p>
        </div>
        <Link
          className={`${styles.previewLink} inline-flex items-center gap-2 text-sm font-semibold hover:underline`}
          href={href}
        >
          Revisar movimentações
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      {data ? (
        <InboxCompositionChart rows={rows} compact />
      ) : (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-600">
          {failed ? (
            "Não foi possível consultar a caixa de entrada. Abra a revisão para conferir as conexões."
          ) : (
            <>
              <RefreshCw
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              Consultando itens recebidos…
            </>
          )}
        </p>
      )}
    </section>
  );
}
