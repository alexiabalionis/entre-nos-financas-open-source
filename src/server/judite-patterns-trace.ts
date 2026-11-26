// Arquivo de diagnóstico da ferramenta padroes (M1). Só existe fora de produção e
// com JUDITE_PATTERNS_TRACE=1; grava em work/padroes-trace/ (fora do git), com
// permissão só do dono, e apaga os arquivos com mais de 3 dias a cada gravação.
// Leva ids, valores, categorias e os nomes de lugar que já são recorte; não leva
// descrição completa de movimento nem nome de pessoa.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { TRACE_FORMAT_VERSION } from "../domain/spend-patterns-trace.ts";

const RETENTION_MS = 3 * 24 * 3_600_000;

export function patternTraceEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.JUDITE_PATTERNS_TRACE === "1";
}

const traceDir = () => process.env.JUDITE_PATTERNS_TRACE_DIR ?? path.join(process.cwd(), "work", "padroes-trace");

async function prune(dir: string, now: number) {
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    if (now - (await stat(file)).mtimeMs > RETENTION_MS) await unlink(file);
  }
}

/** Grava o relatório e devolve o caminho. Falha de gravação nunca derruba a resposta. */
export async function writePatternTrace(report: Record<string, unknown>, dir = traceDir()): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const now = Date.now();
    await prune(dir, now);
    const runId = randomUUID();
    const file = path.join(dir, `${new Date(now).toISOString().replace(/[:.]/g, "-")}-${runId.slice(0, 8)}.json`);
    const body = { formato: TRACE_FORMAT_VERSION, execucao: runId, gerado_em: new Date(now).toISOString(), ...report };
    await writeFile(file, JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2), { mode: 0o600 });
    console.info(`[padroes-trace] ${file}`);
    return file;
  } catch (error) {
    console.warn("[padroes-trace] não gravou o diagnóstico", error);
    return null;
  }
}

/**
 * Diagnóstico de uma resposta inteira da Judite (JUDITE_TURN_TRACE=1, fora de produção):
 * a pergunta, a rota, cada ferramenta com o resultado que o modelo viu, a primeira
 * versão do texto e a que sobrou depois das conferências. Mesmas regras de
 * guarda do padroes-trace (work/judite-trace/, só o dono, 3 dias).
 */
export function turnTraceEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.JUDITE_TURN_TRACE === "1";
}

export async function writeTurnTrace(report: Record<string, unknown>): Promise<string | null> {
  return writePatternTrace(report, path.join(process.cwd(), "work", "judite-trace"));
}
