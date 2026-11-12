"use client";

import { Download, RefreshCw } from "lucide-react";
import { ActionButton } from "@/features/shared/crud-ui";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PluggyDashboard } from "../service";
import { dateLabel, money } from "./inbox-movement";

const states: Record<string, string> = {
  missing_credentials: "Configuração pendente",
  missing_proxy: "Autorização pendente",
  invalid_proxy: "Conexão inválida",
  not_validated: "Aguardando primeira consulta",
  available: "Dados disponíveis",
  partial: "Dados parciais",
  needs_attention: "Revisar conexão",
};

export function BankConnections({
  data,
  errors,
  busy,
  onSync,
  onSelect,
}: {
  data: PluggyDashboard;
  errors: Record<string, string>;
  busy: boolean;
  onSync: (institution: string) => void;
  onSelect: (institution: string) => void;
}) {
  return (
    <div className="mt-4 divide-y divide-ink-950/10">
      {data.banks.map((bank) => (
        <section key={bank.id} className="py-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">{bank.name}</h3>
              <p className="mt-1 text-xs text-ink-600">
                {bank.fetchedAt
                  ? `Coleta: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(new Date(bank.fetchedAt))}`
                  : "Sem coleta disponível"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                tone={
                  errors[bank.id] || bank.state === "needs_attention"
                    ? "warning"
                    : bank.state === "available"
                      ? "success"
                      : "neutral"
                }
              >
                {errors[bank.id] ? "Falha na última consulta" : states[bank.state]}
              </StatusBadge>
              <ActionButton variant="secondary" onClick={() => onSelect(bank.id)}>
                Ver itens
              </ActionButton>
              <button
                type="button"
                title={`Sincronizar ${bank.name}`}
                aria-label={`Sincronizar ${bank.name}`}
                disabled={busy || !bank.configured}
                className="rounded-md border border-ink-950/15 p-2 disabled:opacity-40"
                onClick={() => onSync(bank.id)}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </div>
          {errors[bank.id] ? (
            <p role="alert" className="mt-2 text-amber-700 dark:text-amber-300">
              {errors[bank.id]}
            </p>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-ink-600">
              Contas, cartões, faturas e investimentos
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <h4 className="mb-2 font-medium">Contas e cartões</h4>
                {data.accounts
                  .filter((row) => row.institutionId === bank.id)
                  .map((row) => (
                    <p className="mb-2 text-xs text-ink-600" key={row.id}>
                      {row.name} · {row.type === "CREDIT" ? "Cartão" : "Conta"} · Saldo de
                      referência {money(row.balance, row.currency)}
                      {row.fromPreviousSync ? " · Dado da coleta anterior" : ""}
                    </p>
                  ))}
                {!data.accounts.some((row) => row.institutionId === bank.id) ? (
                  <p className="text-xs text-ink-600">Nenhuma conta retornada.</p>
                ) : null}
              </div>
              <div>
                <h4 className="mb-2 font-medium">Faturas do banco</h4>
                {data.bills
                  .filter((row) => row.institutionId === bank.id)
                  .map((row) => (
                    <p
                      className="mb-2 text-xs text-ink-600"
                      key={`${row.accountId}:${row.id}`}
                    >
                      {
                        data.accounts.find(
                          (account) =>
                            account.id === row.accountId &&
                            account.institutionId === bank.id,
                        )?.name
                      }{" "}
                      · {dateLabel(row.dueDate)} · {money(row.total, row.currency)} ·{" "}
                      {row.payments} pagamento(s)
                    </p>
                  ))}
                {!data.bills.some((row) => row.institutionId === bank.id) ? (
                  <p className="text-xs text-ink-600">Nenhuma fatura retornada.</p>
                ) : null}
              </div>
              <div>
                <h4 className="mb-2 font-medium">Investimentos · somente referência</h4>
                {data.investments
                  .filter((row) => row.institutionId === bank.id)
                  .map((row) => (
                    <p className="mb-2 text-xs text-ink-600" key={row.id}>
                      {row.name} · {money(row.balance, row.currency)} · {row.status}
                    </p>
                  ))}
                {!data.investments.some((row) => row.institutionId === bank.id) ? (
                  <p className="text-xs text-ink-600">Nenhuma posição retornada.</p>
                ) : null}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">
                    Movimentações de investimentos
                  </summary>
                  {data.investmentTransactions
                    .filter((row) => row.institutionId === bank.id)
                    .map((row) => (
                      <p
                        className="mt-2 text-xs text-ink-600"
                        key={`${row.investmentId}:${row.id}`}
                      >
                        {dateLabel(row.date)} · {row.description || row.type} ·{" "}
                        {row.amount ?? "Não informado"} (valor original)
                      </p>
                    ))}
                </details>
              </div>
            </div>
          </details>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-ink-600">
              Diagnóstico e dados de origem
            </summary>
            <p className="mt-2 text-xs text-ink-600">
              Atualização no provedor:{" "}
              {bank.lastUpdatedAt ? String(bank.lastUpdatedAt) : "Não informada"}
            </p>
            {!bank.configured ? (
              <p className="mt-2 text-xs text-ink-600">
                Configuração necessária no servidor: {bank.env}. Autorize a conexão no Meu
                Pluggy.
              </p>
            ) : null}
            {bank.warnings.map((warning) => (
              <p
                className="mt-2 text-xs text-amber-700 dark:text-amber-300"
                key={warning}
              >
                {warning}
              </p>
            ))}
            {bank.fetchedAt ? (
              <a
                className="mt-3 inline-flex items-center gap-2 text-xs underline"
                href={`/api/pluggy/dashboard?action=download&institution=${bank.id}`}
              >
                <Download className="h-3.5 w-3.5" />
                Baixar origem JSON (contém dados pessoais)
              </a>
            ) : null}
          </details>
        </section>
      ))}
    </div>
  );
}
