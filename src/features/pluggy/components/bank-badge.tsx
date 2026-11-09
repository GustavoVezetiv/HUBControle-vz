import { CreditCard, Landmark } from "lucide-react";
import { bankBrands, identifyBank } from "@/features/imports/bank-identity";

export function BankBadge({
  bank,
  account,
  accountType,
}: {
  bank: string;
  account?: string;
  accountType?: string | null;
}) {
  const identity = identifyBank(bank);
  const brand = identity ? bankBrands[identity] : null;
  const card = accountType === "CREDIT";
  const Icon = card ? CreditCard : Landmark;
  return (
    <span className="block min-w-0">
      <span
        className="inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded px-2 py-1 text-xs font-semibold"
        style={{
          background: brand?.background ?? "#475569",
          color: brand?.color ?? "#ffffff",
          borderLeft: `3px solid ${brand?.accent ?? "#94a3b8"}`,
        }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {card ? "Cartão " : ""}
          {brand?.name ?? bank}
        </span>
      </span>
      {account ? (
        <span className="mt-1 block truncate text-xs text-ink-600" title={account}>
          {account}
        </span>
      ) : null}
    </span>
  );
}
