import Link from "next/link";
import { Inbox } from "lucide-react";
import { ImportsWorkbench } from "@/features/imports/components/imports-workbench";

export const metadata = {
  title: "Importações",
};

export default function ImportsPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
          href="/dashboard/imports/pluggy"
        >
          <Inbox className="h-4 w-4" aria-hidden />Caixa de Entrada Financeira · Meu Pluggy
        </Link>
        <Link
          className="inline-block rounded-md border px-4 py-3 text-sm"
          href="/dashboard/imports/organizze/history"
        >
          Histórico Organizze — somente referência
        </Link>
      </div>
      <Link
        className="inline-block rounded-md border px-4 py-3 text-sm"
        href="/dashboard/imports/organizze"
      >
        Organizze — extrair, conferir e importar histórico
      </Link>
      <ImportsWorkbench />
    </div>
  );
}
