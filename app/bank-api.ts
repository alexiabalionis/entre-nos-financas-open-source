import type { FormEvent } from "react";
import type { readBanks } from "../src/server/banks.ts";

export type Banks = Awaited<ReturnType<typeof readBanks>>;
export type LocalAccount = {
  id: string;
  name: string;
  currency: string;
  kind: string;
};
/** Executa uma ação do servidor e, no sucesso, recarrega a tela com a mensagem. */
export type Work = (
  action: () => Promise<unknown>,
  message: string,
  financial?: boolean,
) => Promise<unknown>;

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Não foi possível concluir. Tente novamente.",
    );
  return data;
}

export function fields(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
