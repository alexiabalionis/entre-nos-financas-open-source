import { NextResponse } from "next/server.js";
import { mockMoney } from "./mock-numbers.ts";
import { UserError } from "./imports.ts";
import { deployment } from "./deployment.ts";
export class HttpError extends UserError {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export function assertJsonTree(
  value: unknown,
  depth = 0,
  count = { value: 0 },
): void {
  if (depth > 20 || ++count.value > 20000)
    throw new HttpError("Formulário muito complexo.", 400);
  if (typeof value === "string" && value.includes("\0"))
    throw new HttpError("Texto contém caracteres inválidos.", 400);
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new HttpError("Campo não permitido.", 400);
      assertJsonTree(child, depth + 1, count);
    }
  }
}
/**
 * Host extra liberado SÓ em dev (banco local), via env DEV_ALLOWED_HOST.
 * Serve para acessar o dev server por um host não-loopback (ex.: IP/hostname
 * Tailscale) a partir de outro dispositivo. É opt-in: sem a env, nada muda, e
 * em produção (deployment com origin HTTPS fixo) a var é IGNORADA — o guardrail
 * anti-rebinding continua fechado. Aceita vários, separados por vírgula.
 * Formato: "host:porta" (ex.
 * "100.126.165.4:3210" ou "macbook.tailnet.ts.net:3210").
 */
function devAllowedHosts(): string[] {
  return (process.env.DEV_ALLOWED_HOST || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
}
export function assertLocal(request: Request, mutation = false): void {
  const config = deployment();
  const port = process.env.APP_PORT || "3210";
  // A liberação de dev só vale quando NÃO há deployment remoto (banco local).
  const devHosts = config.origin ? [] : devAllowedHosts();
  const allowed = new Set(
    config.origin
      ? [new URL(config.origin).host]
      : [`localhost:${port}`, `127.0.0.1:${port}`, ...devHosts],
  );
  if (!allowed.has(request.headers.get("host") || ""))
    throw new UserError(
      "Endereço não autorizado. Abra o endereço configurado do aplicativo.",
    );
  if (mutation) {
    const origin = request.headers.get("origin");
    // A origin de escrita aceita http:// e https:// do host de dev liberado
    // (a Tailscale serve por HTTPS; acesso direto por IP é HTTP).
    const devOrigins = devHosts.flatMap((h) => [`https://${h}`, `http://${h}`]);
    if (
      !origin ||
      !(
        config.origin
          ? [config.origin]
          : [
              `http://localhost:${port}`,
              `http://127.0.0.1:${port}`,
              ...devOrigins,
            ]
      ).includes(origin)
    )
      throw new UserError(
        "Origem da operação não autorizada. Reabra o aplicativo pelo endereço configurado.",
      );
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new UserError("Operação entre sites recusada.");
  }
}
/** Call only after authenticating CRON_SECRET. Vercel targets the immutable production deployment. */
export function assertCronHost(request: Request): void {
  const deploymentHost = process.env.VERCEL_URL;
  if (
    deployment().remote &&
    process.env.VERCEL_ENV === "production" &&
    deploymentHost &&
    /^[a-z0-9.-]+\.vercel\.app$/.test(deploymentHost) &&
    request.headers.get("host") === deploymentHost
  )
    return;
  assertLocal(request, false);
}
export function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(
    JSON.stringify(data, (key, value) => {
      const mocked = mockMoney(key, value);
      return typeof mocked === "bigint" ? mocked.toString() : mocked;
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
}
export async function limitedBody(
  request: Request,
  max: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length") || "0") > max)
    throw new HttpError("Arquivo ou formulário excede o limite.", 413);
  if (
    request.headers.has("content-encoding") &&
    request.headers.get("content-encoding") !== "identity"
  )
    throw new HttpError("Codificação de formulário não suportada.", 415);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError("Arquivo ou formulário excede o limite.", 413);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return all;
}
export async function bodyJson(
  request: Request,
  max = 2 * 1024 * 1024,
): Promise<unknown> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json")
    throw new HttpError("Formato de formulário inválido.", 415);
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await limitedBody(request, max),
      ),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new HttpError("Formulário inválido.", 400);
    assertJsonTree(value);
    return value;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError("Formulário inválido.");
  }
}
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^\s*[=+\-@]|^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
