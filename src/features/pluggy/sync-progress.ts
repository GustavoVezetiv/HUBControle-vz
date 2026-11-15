export type SyncProgress = {
  phase: "connection" | "accounts" | "transactions" | "bills" | "investments" | "saving" | "review" | "complete";
  message: string;
  percent: number;
};
export type SyncEvent<T> =
  | { type: "progress"; progress: SyncProgress }
  | { type: "result"; data: T }
  | { type: "error"; error: string };

export async function readSyncResponse<T>(response: Response, onProgress: (progress: SyncProgress) => void): Promise<T> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Consulta indisponível.");
    return result as T;
  }
  if (!response.ok || !response.body) throw new Error("Consulta indisponível.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: T | undefined;
  let received = false;
  let previous = 0;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as SyncEvent<T>;
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "result") { result = event.data; received = true; }
    if (event.type === "progress") {
      const percent = Math.max(previous, Math.min(100, event.progress.percent));
      if (!Number.isFinite(percent)) throw new Error("Progresso inválido.");
      previous = percent;
      onProgress({ ...event.progress, percent });
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 32 * 1024 * 1024) throw new Error("Resposta excede o limite.");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      lines.forEach(consume);
      if (done) { consume(pending); break; }
    }
    if (!received) throw new Error("Consulta interrompida antes da conclusão. Tente novamente.");
    return result as T;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
