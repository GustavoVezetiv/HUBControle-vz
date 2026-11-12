"use client";

import { useMemo, useRef, useState } from "react";
import { SectionCard } from "@/components/ui/section-card";
import { ActionButton, inputClassName, Modal } from "@/features/shared/crud-ui";
import { OrganizzeReconciliation } from "./organizze-reconciliation";
import type { ReconciliationDecisions, ReconciliationReview } from "@/features/imports/organizze";
import { createSnapshot, extract, pendingTask } from "../extraction";
import { buildOrganizzePreview } from "../preview";
import type { PageResult, References, Snapshot, Task } from "../types";

type ImportSummary = { total: number; create: number; linkExisting: number; sourceOnly: number; newMovements: number; pending: number; ambiguous: number; byTarget: Record<string, number> };
type ImportPreview = { summary: ImportSummary; ready: boolean; reviews: ReconciliationReview[]; blockers: { sourceKey: string; reason: string }[]; notes: { sourceKey: string; reason: string }[] };
type Result = { created: number; reused: number; sourceOnly: number; total: number };
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Cuiaba" }).format(new Date());
const labels: Record<string, string> = { category: "Categorias", account: "Contas bancárias", card: "Cartões", invoice: "Faturas", transaction: "Movimentações" };
async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Não foi possível concluir a operação.");
  return data;
}
const post = <T,>(body: unknown) => readJson<T>("/api/organizze/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function download(snapshot: Snapshot) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ snapshot, selectedKeys: [] })], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "organizze-backup.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function OrganizzeImportWorkbench() {
  const [start, setStart] = useState("2023-01-01");
  const [end, setEnd] = useState(today);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [refs, setRefs] = useState<References | null>(null);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPreview | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<ReconciliationDecisions>({});
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const controller = useRef<AbortController | null>(null);
  const preview = useMemo(() => !controller.current && snapshot && refs ? buildOrganizzePreview(snapshot, refs) : null, [snapshot, refs]);
  async function references(active: Snapshot) {
    return readJson<References>(`/api/organizze/preview?${new URLSearchParams({ action: "references", start: active.period.start, end: active.period.end })}`);
  }
  async function prepare(active: Snapshot, id: string, cardMappings: Record<string, string>) {
    setSnapshot(active); setBackupId(id); setStart(active.period.start); setEnd(active.period.end);
    const reference = await references(active);
    if (reference.ownerId !== active.ownerId) throw new Error("O backup pertence a outro usuário.");
    setRefs(reference);
    if (!pendingTask(active) && !active.errors.length) setPlan(await post<ImportPreview>({ action: "preview", backupId: id, cardMappings, decisions: {} }));
    else setPlan(null);
  }
  async function loadBackup() {
    setWorking(true); setMessage(""); setResult(null); setMappings({}); setDecisions({}); setPlan(null);
    try {
      const data = await readJson<{ snapshot: Snapshot; backupId: string }>("/api/organizze/import");
      await prepare(data.snapshot, data.backupId, {});
      setMessage("Backup local carregado. Confira a cobertura e os vínculos abaixo.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao abrir backup."); }
    finally { setWorking(false); }
  }
  async function openFile(file: File | undefined) {
    if (!file) return;
    setWorking(true); setMessage(""); setResult(null); setPlan(null); setMappings({}); setDecisions({});
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error("Backup excede 80 MiB.");
      const parsed = JSON.parse(await file.text());
      const active: Snapshot = parsed.snapshot ?? parsed;
      const saved = await post<{ backupId: string }>({ action: "backup", snapshot: active });
      await prepare(active, saved.backupId, {});
      setMessage("JSON aberto e cópia local salva. Nenhum dado financeiro foi importado.");
    } catch { setMessage("JSON inválido, de outro usuário ou indisponível. Nenhum dado financeiro foi importado."); }
    finally { setWorking(false); }
  }
  async function run(resume: boolean) {
    setWorking(true); setMessage("Consultando o Organizze apenas por GET…"); setResult(null); setPlan(null); setBackupId(null); setMappings({}); setDecisions({});
    const abort = new AbortController(); controller.current = abort;
    let active: Snapshot | null = null;
    try {
      const period = resume && snapshot ? snapshot.period : { start, end };
      const reference = await readJson<References>(`/api/organizze/preview?${new URLSearchParams({ action: "references", start: period.start, end: period.end })}`);
      setRefs(reference);
      active = resume && snapshot ? structuredClone(snapshot) : createSnapshot(reference.ownerId, period);
      if (active.ownerId !== reference.ownerId) throw new Error("Usuário do backup diferente da sessão.");
      setSnapshot({ ...active });
      let updated = 0;
      await extract(active, async (task: Task) => {
        const query = new URLSearchParams({ action: "extract", path: task.path, page: String(task.page ?? 1) });
        if (task.period) { query.set("start", task.period.start); query.set("end", task.period.end); }
        await new Promise(resolve => setTimeout(resolve, 150));
        return readJson<PageResult>(`/api/organizze/preview?${query}`, { signal: abort.signal });
      }, () => { if (active && Date.now() - updated > 1000) { setSnapshot({ ...active }); updated = Date.now(); } }, abort.signal);
      const saved = await post<{ backupId: string }>({ action: "backup", snapshot: active });
      await prepare(active, saved.backupId, {});
      setMessage("Extração concluída e backup JSON salvo localmente. Revise antes de confirmar a importação.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Extração interrompida; os dados recuperados foram mantidos.");
      if (active) { setSnapshot({ ...active }); try { const saved = await post<{ backupId: string }>({ action: "backup", snapshot: active }); setBackupId(saved.backupId); } catch { /* Download remains available. */ } }
    } finally { controller.current = null; setWorking(false); }
  }
  async function updateMappings(next: Record<string, string>) {
    setMappings(next); setWorking(true); setMessage("");
    try { if (backupId) setPlan(await post<ImportPreview>({ action: "preview", backupId, cardMappings: next, decisions })); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao conferir vínculos."); }
    finally { setWorking(false); }
  }
  async function updateDecisions(next: ReconciliationDecisions) {
    setDecisions(next); setWorking(true); setMessage("");
    try { if (backupId) setPlan(await post<ImportPreview>({ action: "preview", backupId, cardMappings: mappings, decisions: next })); }
    catch (error) { setPlan(null); setMessage(error instanceof Error ? error.message : "Falha ao conferir decisões."); }
    finally { setWorking(false); }
  }
  async function confirm() {
    if (!backupId || !plan?.ready || plan.blockers.length > 0) return;
    setWorking(true); setMessage("Importando no HubVZ…");
    try {
      const data = await post<{ result: Result }>({ action: "confirm", backupId, cardMappings: mappings, decisions, confirm: true });
      setResult(data.result); setConfirmOpen(false);
      setMessage("Conciliação concluída. Somente novos registros aprovados entram nos totais; histórico e reembolsos preservados.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao importar. Atualize a prévia."); }
    finally { setWorking(false); }
  }
  return <div className="space-y-5">
    <SectionCard title="Organizze — importar histórico" description="O histórico fica fora dos totais por padrão. Vincule correspondências ou selecione explicitamente o que é novo. A API Organizze é consultada somente por GET.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label>Data inicial<input aria-label="Data inicial Organizze" className={inputClassName} type="date" value={start} disabled={working} onChange={event => setStart(event.target.value)} /></label>
        <label>Data final<input aria-label="Data final Organizze" className={inputClassName} type="date" max={today()} value={end} disabled={working} onChange={event => setEnd(event.target.value)} /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ActionButton disabled={working || !start || !end || start > end || end > today()} onClick={() => void run(false)}>Extrair histórico</ActionButton>
        {snapshot && pendingTask(snapshot) && <ActionButton variant="secondary" disabled={working} onClick={() => void run(true)}>Retomar extração</ActionButton>}
        <ActionButton variant="secondary" disabled={working} onClick={() => void loadBackup()}>Carregar backup local</ActionButton>
        <label className="text-sm">Abrir JSON<input aria-label="Abrir backup Organizze" className="ml-2 max-w-60" type="file" accept=".json,application/json" disabled={working} onChange={event => void openFile(event.target.files?.[0])} /></label>
        {snapshot && <ActionButton variant="secondary" disabled={working} onClick={() => download(snapshot)}>Baixar backup JSON</ActionButton>}
        {controller.current && <ActionButton variant="secondary" onClick={() => controller.current?.abort()}>Interromper</ActionButton>}
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-sm">{message || "Nenhum dado foi importado. Extraia ou carregue seu backup para conferir."}</p>
      {snapshot && <p className="mt-2 text-sm">{snapshot.records.length} registros únicos · {snapshot.receipts.length + (snapshot.unavailable?.length ?? 0)}/{snapshot.tasks.length} consultas · período {snapshot.period.start} a {snapshot.period.end}.</p>}
    </SectionCard>
    {preview && snapshot && <SectionCard title={preview.complete ? "Confira antes de importar" : "Extração parcial — retome as consultas"}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries(labels).map(([entity, label]) => <div key={entity} className="rounded-md border p-3"><span className="text-sm">{label}</span><p className="text-xl font-semibold">{snapshot.records.filter(row => row.entity === entity).length}</p></div>)}</div>
      <p className="mt-3 text-sm">Histórico encontrado: {preview.actualPeriod.start ?? "sem movimentações"} a {preview.actualPeriod.end ?? "sem movimentações"}. Possíveis correspondências (Hub e histórico): {plan?.summary.ambiguous ?? preview.possibleDuplicates}.</p>
      <p className="mt-2 text-sm">Tags ({preview.tags.length}): {preview.tags.join(", ") || "nenhuma retornada"}. Os IDs e payloads originais permanecem no backup e no lote importado.</p>
      {!!snapshot.unavailable?.length && <p className="mt-2 text-sm">A API não disponibilizou {snapshot.unavailable.length} consultas secundárias. Os demais dados podem ser importados; nenhuma ocorrência ausente será inventada.</p>}
      <details className="mt-4"><summary className="cursor-pointer font-semibold">Categorias existentes e novas</summary><ul className="mt-2 space-y-1 text-sm">{preview.rows.filter(row => row.entity === "category").map(row => <li key={row.key}>{String(row.raw.name)} · {row.raw.parent_id ? `pai #${row.raw.parent_id}` : "principal"} · {row.categoryCandidates.length === 1 ? "vincular existente" : "preservar como categoria de origem"}</li>)}</ul></details>
      <details className="mt-4"><summary className="cursor-pointer font-semibold">Vínculos dos cartões</summary><p className="mt-2 text-sm">Escolha um cartão existente se ele corresponde ao mesmo cartão do Organizze. Os cadastros existentes não serão sobrescritos.</p><div className="mt-2 grid gap-3 sm:grid-cols-2">{preview.rows.filter(row => row.entity === "card").map(row => <label key={row.key} className="text-sm">{String(row.raw.name)}<select aria-label={`Vincular cartão ${String(row.raw.name)}`} className={inputClassName} disabled={working || !!result} value={mappings[row.sourceId] ?? ""} onChange={event => void updateMappings({ ...mappings, [row.sourceId]: event.target.value })}><option value="">Reconhecer por nome; revisar se não existir</option><option value="new">Confirmo: criar cartão novo</option>{refs?.cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}</select></label>)}</div></details>
      {plan && <><p className="mt-4 font-semibold">{plan.summary.newMovements} novas movimentações selecionadas · {plan.summary.linkExisting} vínculos existentes · {plan.summary.sourceOnly} somente na origem · {plan.summary.pending} pendentes de classificação.</p><p className="mt-2 text-sm">Serão criados {plan.summary.create} registros, incluindo apenas cadastros necessários às movimentações aprovadas.</p>{!plan.ready && <p role="alert" className="mt-3 text-sm">A nova migration de conciliação ainda não foi aplicada. O fluxo antigo está bloqueado nesta versão local. Confira as decisões; nenhuma importação será executada.</p>}<OrganizzeReconciliation snapshot={snapshot} references={refs!} reviews={plan.reviews} decisions={decisions} disabled={working || !!result} onChange={next => void updateDecisions(next)} /><p className="mt-2 text-sm">Contas bancárias, transferências, pagamentos e estornos sem representação no Hub ficam no lote com seus vínculos e tags; não viram uma segunda despesa ou receita. Recorrências não ativam geração automática.</p><details className="mt-3"><summary className="cursor-pointer">Conferir itens preservados para conciliação</summary><ul className="mt-2 space-y-1 text-sm">{plan.notes.map(note => <li key={note.sourceKey}>{note.sourceKey}: {note.reason}</li>)}</ul></details><ActionButton className="mt-4" disabled={working || !plan.ready || !!result || plan.blockers.length > 0} onClick={() => setConfirmOpen(true)}>Revisar e confirmar importação</ActionButton></>}
      {result && <p className="mt-4 font-semibold">Concluído: {result.created} criados, {result.reused} já existentes e {result.sourceOnly} preservados na origem.</p>}
    </SectionCard>}
    {confirmOpen && plan && <Modal title="Confirmar importação Organizze" onClose={() => { if (!working) setConfirmOpen(false); }}>
      <div className="space-y-4"><p>{plan.summary.newMovements} movimentações explicitamente aprovadas como novas. O restante será vinculado a registros existentes ou guardado no histórico de origem, fora dos totais.</p><p>As titularidades e naturezas das entradas foram escolhidas por registro. Lançamentos existentes, faturas, recebimentos e reembolsos não serão sobrescritos. Nenhum reembolso será criado automaticamente.</p><div className="flex gap-2"><ActionButton disabled={working || !!plan.blockers.length} onClick={() => void confirm()}>Confirmar histórico e decisões</ActionButton><ActionButton variant="secondary" disabled={working} onClick={() => setConfirmOpen(false)}>Cancelar</ActionButton></div></div>
    </Modal>}
  </div>;
}
