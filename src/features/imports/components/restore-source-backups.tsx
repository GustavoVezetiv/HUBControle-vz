"use client";
import { useState } from "react";

export function RestoreSourceBackups() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return <details className="rounded-lg border border-ink-950/10 px-4 py-3 text-sm dark:border-white/10">
    <summary className="cursor-pointer font-semibold">Restaurar históricos de origem</summary>
    <p className="my-3 text-ink-600 dark:text-slate-400">Preserve arquivos de histórico Pluggy ou Organizze nesta conta. Isso não cria despesas, receitas ou reembolsos.</p>
    <input aria-label="Arquivos de histórico Pluggy ou Organizze" type="file" accept=".json,application/json" multiple disabled={busy} onChange={async (event) => {
      const files = [...(event.target.files ?? [])];
      if (!files.length) return;
      setBusy(true); setMessage("Preservando históricos…");
      let count = 0;
      try {
        for (const file of files) {
          if (file.size > 80 * 1024 * 1024) throw new Error("Histórico excede 80 MiB.");
          const value = JSON.parse(await file.text());
          const source = value.source ?? value.snapshot?.source;
          if (!["pluggy", "organizze"].includes(source)) throw new Error("Arquivo de histórico inválido.");
          const compressed = await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob();
          if (compressed.size > 4 * 1024 * 1024) throw new Error("Histórico compactado excede 4 MiB.");
          const response = await fetch(`/api/imports/backups?source=${source}`, {
            method: "POST", headers: { "Content-Type": "application/gzip" }, body: compressed,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Falha ao preservar histórico.");
          count++;
        }
        setMessage(`${count} histórico(s) preservado(s). Recarregue a caixa de entrada para conferir.`);
      } catch (error) { setMessage(`${count} histórico(s) preservado(s). ${error instanceof Error ? error.message : "Falha ao restaurar."}`); }
      finally { setBusy(false); }
    }} />
    {message ? <p role="status" className="mt-3">{message}</p> : null}
  </details>;
}
