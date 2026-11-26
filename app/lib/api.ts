/** Erro da API: mantém a mensagem de sempre e guarda status e corpo para quem precisar decidir. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Transporte HTTP do app (cliente). Extração LITERAL da função `api<T>()` que
 * vive hoje em family.tsx — mesma assinatura e mesmo comportamento, para ser
 * drop-in na virada (family.tsx passará a importar daqui e apagar a cópia
 * local). GET quando não há body; POST com JSON quando há. Lança ApiError
 * (mensagem = value.error) quando a resposta não é ok.
 */
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      value.error || "Não foi possível salvar. Tente novamente.",
      response.status,
      value,
    );
  return value;
}
