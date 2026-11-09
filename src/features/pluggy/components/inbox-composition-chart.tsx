import { ArrowDownLeft, ArrowUpRight, CreditCard, CircleHelp } from "lucide-react";
import { inboxComposition, type InboxMovement, type InboxCompositionKey } from "../inbox";
import styles from "./inbox-visuals.module.css";

const groups = [
  { key: "expense", label: "Saídas em conta", icon: ArrowUpRight },
  { key: "income", label: "Entradas em conta", icon: ArrowDownLeft },
  { key: "card", label: "Compras no cartão", icon: CreditCard },
  { key: "review", label: "Outros a revisar", icon: CircleHelp },
] satisfies { key: InboxCompositionKey; label: string; icon: typeof CreditCard }[];

export function InboxCompositionChart({
  rows,
  compact = false,
}: {
  rows: InboxMovement[];
  compact?: boolean;
}) {
  const counts = inboxComposition(rows);
  const description = groups
    .map((group) => `${group.label}: ${counts[group.key]}`)
    .join("; ");
  return (
    <section className={styles.chart} aria-label="Composição dos itens a revisar">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {compact ? "A revisar nos bancos" : "O que ainda precisa entrar no Hub"}
        </h3>
        <p className="text-xs text-ink-600">
          <strong className="text-ink-950">{counts.total}</strong> item(ns) a revisar
          {!compact ? ` · ${rows.length} na seleção` : ""}
        </p>
      </div>
      <div
        className={styles.track}
        role="img"
        aria-label={counts.total ? description : "Nenhum item a revisar na seleção"}
      >
        {groups.map((group) =>
          counts[group.key] ? (
            <span
              key={group.key}
              className={styles.segment}
              style={{
                width: `${(counts[group.key] / counts.total) * 100}%`,
                backgroundColor: `var(--inbox-${group.key}-fill)`,
              }}
              title={`${group.label}: ${counts[group.key]}`}
            />
          ) : null,
        )}
      </div>
      <dl className={styles.legend}>
        {groups.map((group) => (
          <div key={group.key} data-kind={group.key} className={styles.legendItem}>
            <dt className={styles.legendLabel}>
              <group.icon aria-hidden />
              {group.label}
            </dt>
            <dd className={styles.legendValue}>
              {counts[group.key]}
              <span className="ml-2 text-xs font-normal text-ink-600">
                {counts.total ? Math.round((counts[group.key] / counts.total) * 100) : 0}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-600">
        {!counts.total
          ? "Nenhum item a revisar neste recorte. "
          : "Contagens de pré-importação, fora do saldo financeiro. "}
        {counts.ignored} ignorado(s) e {counts.linked} vinculado(s) fora do gráfico.
      </p>
    </section>
  );
}
