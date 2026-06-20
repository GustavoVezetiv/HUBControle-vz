import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
      <StatusBadge tone="info">Beta privado</StatusBadge>

      <div className="mt-6 max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-mint-600">
          Hub VZ
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink-950 sm:text-6xl">
          Hub pessoal para finanças, metas, decisões e planejamento.
        </h1>
        <p className="mt-5 text-lg leading-8 text-ink-600">
          O Hub VZ está em validação privada. O módulo financeiro já usa Supabase Auth,
          banco Supabase e rotas protegidas para organizar faturas, contas, reembolsos,
          fluxo de caixa, metas, compras, anotações e planos de pagamento.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard"
          className="hub-action hub-action-primary inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold shadow-soft transition"
        >
          Abrir dashboard
        </Link>
        <Link
          href="/login"
          className="hub-action hub-action-secondary inline-flex items-center justify-center rounded-md px-5 py-3 text-sm font-semibold transition"
        >
          Ver tela de login
        </Link>
      </div>
    </main>
  );
}
