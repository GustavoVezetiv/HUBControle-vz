import Link from "next/link";
import { ImportsWorkbench } from "@/features/imports/components/imports-workbench";
export const metadata = { title: "Importar planilha" };
export default function ManualImportsPage() {
  return <div className="space-y-5">
    <Link className="text-sm underline underline-offset-4" href="/dashboard/imports">Voltar à Caixa de Entrada Financeira</Link>
    <div className="flex flex-wrap gap-4 text-sm">
      <Link className="underline" href="/dashboard/imports/organizze">Extrair e conferir histórico Organizze</Link>
      <Link className="underline" href="/dashboard/imports/organizze/history">Histórico Organizze</Link>
    </div>
    <ImportsWorkbench />
  </div>;
}
