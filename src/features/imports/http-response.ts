export class ImportHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function readImportJson<T>(response: Response): Promise<T> {
  if (response.status === 401)
    throw new ImportHttpError(
      "Sua sessão não está disponível. Entre novamente para continuar.",
      401,
    );
  const unavailable =
    response.status === 429
      ? "Muitas consultas em sequência. Aguarde um pouco e tente novamente."
      : "Não foi possível ler a resposta do servidor. Tente atualizar a tela.";
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new ImportHttpError(unavailable, response.status);
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ImportHttpError(unavailable, response.status);
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new ImportHttpError(unavailable, response.status);
  if (!response.ok)
    throw new ImportHttpError(
      "error" in result && typeof result.error === "string" ? result.error : unavailable,
      response.status,
    );
  return result as T;
}

export function importErrorMessage(error: unknown) {
  if (error instanceof TypeError)
    return "Falha de conexão. Confira sua internet e tente novamente.";
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir. Tente novamente.";
}
