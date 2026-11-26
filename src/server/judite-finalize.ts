// Contexto de finalização (padrão na rota de diagnóstico aberto desde 22/11/2026;
// JUDITE_FINAL_CONTEXT=0 desliga): antes da
// primeira resposta final do diagnóstico aberto, o servidor diz ao modelo o que
// existe nesta pergunta e o que os validadores vão aceitar. Não é uma regra
// nova: as permissões saem dos mesmos predicados de checkHypotheses
// (hypothesisAllowances) e de checkMoney (savingUse sobre os papéis de
// moneyRoles). A conferência depois continua igual.
import { hypothesisAllowances, type RefIndex } from "../domain/hypothesis-check.ts";
import { moneyIn, savingUse, type MoneyRole } from "../domain/money-check.ts";
import type { ToolResult } from "./judite-loop.ts";

/** Ligado por padrão; só vale para a rota aberta (help.ts decide pela rota). */
export const finalContextEnabled = () => process.env.JUDITE_FINAL_CONTEXT !== "0";

type Money = { valor: string; origem: string; natureza: string; uso: ReturnType<typeof savingUse>; condicao?: string };

/** Natureza do número pelo que a ferramenta disse dele (só descreve; quem decide o uso é savingUse). */
function moneyOf(results: readonly ToolResult[], roles: ReadonlyMap<string, ReadonlySet<MoneyRole>>): Money[] {
  const out: Money[] = [];
  const seen = new Set<string>();
  const push = (formatted: unknown, origem: string, natureza: string, condicao?: unknown) => {
    if (typeof formatted !== "string") return;
    const key = [...moneyIn(formatted)][0];
    if (!key || seen.has(`${key}|${origem}`)) return;
    seen.add(`${key}|${origem}`);
    out.push({ valor: formatted, origem, natureza, uso: savingUse(roles.get(key)), ...(typeof condicao === "string" && condicao ? { condicao } : {}) });
  };
  for (const r of results) {
    const res = r.resultado as Record<string, unknown> | null;
    if (!res || typeof res !== "object") continue;
    if (r.chamada.name === "padroes")
      for (const h of (res.destaques ?? []) as Record<string, unknown>[]) {
        const ref = String(h.ref ?? "");
        for (const l of (h.alavancas ?? []) as Record<string, unknown>[])
          push(l.formatted, ref, l.tipo === "cancelar_recorrencia" ? "alavanca_cancelamento" : "alavanca_condicional");
        if (h.em_jogo_natureza === "diferenca_historica" || h.em_jogo_natureza === "movimentado")
          push(h.em_jogo_formatted, ref, h.em_jogo_natureza === "movimentado" ? "dinheiro_movimentado" : "diferenca_historica");
      }
    if (r.chamada.name === "simular_mudanca") {
      const kind = String(res.tipo_de_resultado ?? "");
      const natureza = kind === "economia_calculada" ? "economia_simulada" : kind === "economia_hipotetica" ? "economia_simulada_condicional" : kind;
      push(res.diferenca_mensal_formatted, String(res.ref ?? "s?"), natureza, res.condicao);
      push(res.diferenca_anual_estimada_formatted, String(res.ref ?? "s?"), natureza, res.condicao);
    }
  }
  return out.slice(0, 40);
}

type Warn = {
  sem_categoria?: { compras: number; total_cents: string; total_formatted?: string; parte_da_saida?: number; grupos?: unknown[] };
  fora_da_curva?: Record<string, string>[];
  em_revisao?: { linhas: number; saidas_cents: string; saidas_formatted?: string; entradas_formatted?: string };
  entradas_suspeitas?: { entradas: number; total_cents: string; total_formatted?: string };
};

/** Os 2 maiores avisos de avisos_de_dados, com os valores já formatados pela ferramenta. */
export function warningsToCite(results: readonly ToolResult[]): Record<string, unknown>[] {
  const res = results.find((r) => r.chamada.name === "avisos_de_dados")?.resultado as (Warn & { erro?: string }) | null | undefined;
  if (!res || typeof res !== "object" || res.erro) return [];
  const found: { cents: bigint; aviso: Record<string, unknown> }[] = [];
  const sem = res.sem_categoria;
  if (sem && sem.compras > 0)
    found.push({
      cents: BigInt(sem.total_cents),
      aviso: { tipo: "sem_categoria", compras: sem.compras, total: sem.total_formatted, parte_da_saida: sem.parte_da_saida, grupos: sem.grupos?.length ?? 0 },
    });
  for (const o of res.fora_da_curva ?? [])
    found.push({
      cents: BigInt(o.valor_cents ?? "0"),
      aviso: { tipo: "fora_da_curva", categoria: o.categoria, mes: o.mes, valor: o.valor_formatted, rotulo: o.rotulo, mes_sem_ela: o.mes_sem_ela_formatted, normal: o.normal_formatted },
    });
  const rev = res.em_revisao;
  if (rev && rev.linhas > 0)
    found.push({ cents: BigInt(rev.saidas_cents), aviso: { tipo: "em_revisao", linhas: rev.linhas, saidas: rev.saidas_formatted, entradas: rev.entradas_formatted } });
  const sus = res.entradas_suspeitas;
  if (sus && sus.entradas > 0) found.push({ cents: BigInt(sus.total_cents), aviso: { tipo: "entradas_suspeitas", entradas: sus.entradas, total: sus.total_formatted } });
  return found.sort((a, b) => (a.cents > b.cents ? -1 : a.cents < b.cents ? 1 : 0)).slice(0, 2).map((f) => f.aviso);
}

/** Aprendizados lidos nesta pergunta (refs mN), curtos, para o modelo tratar como restrição. */
export function houseConstraints(results: readonly ToolResult[]): { ref: string; texto: string }[] {
  const seen = new Set<string>();
  const out: { ref: string; texto: string }[] = [];
  for (const r of results) {
    if (r.chamada.name !== "search_memory") continue;
    const hits = ((r.resultado as { memorias?: { ref: string; tipo: string; texto: string }[] } | null)?.memorias ?? []);
    for (const m of hits) {
      if (m.tipo !== "aprendizado" || seen.has(m.ref)) continue;
      seen.add(m.ref);
      out.push({ ref: m.ref, texto: m.texto.slice(0, 200) });
    }
  }
  return out.slice(0, 5);
}

export function finalizationContext(p: { results: readonly ToolResult[]; refs: RefIndex; roles: ReadonlyMap<string, ReadonlySet<MoneyRole>>; short?: boolean }) {
  const avisos = warningsToCite(p.results);
  const restricoes = houseConstraints(p.results);
  return {
    para_que: "O que existe nesta pergunta e o que a conferência aceita. Não muda o que você pode recomendar: só evita afirmar o que não tem base.",
    ...(avisos.length ? { avisos_a_citar: avisos } : {}),
    ...(restricoes.length ? { restricoes_da_casa: restricoes } : {}),
    hipoteses: hypothesisAllowances(p.refs),
    dinheiro_como_economia: {
      valores: moneyOf(p.results, p.roles),
      uso: {
        livre: "pode ser dito como economia",
        com_condicao: "economia só com a condição na mesma frase (se, caso, depende, hipotético...)",
        nao_e_economia: "nunca como economia: é diferença histórica, dinheiro movimentado ou descrição; pode ser citado como fato",
      },
      outros_valores: "valores de investigar_gastos descrevem o gasto e não são economia; fora de frase de economia, qualquer valor formatado dos resultados pode ser citado",
    },
    liberdade:
      process.env.JUDITE_FORMAT === "classic"
        ? "Intervenções de organização e rotina (valor separado de antemão, um lugar só para acompanhar, automação, margem de segurança) e benefícios caixa, visibilidade, menos_decisoes e protecao_futura não precisam de número nem de simulação. Sem economia que a conferência aceite, Impacto diz o tipo de benefício, sem valor."
        : "Intervenções de organização e rotina (valor separado de antemão, um lugar só para acompanhar, automação, margem de segurança) e benefícios caixa, visibilidade, menos_decisoes e protecao_futura não precisam de número nem de simulação. Sem economia que a conferência aceite, a sugestão diz o tipo de benefício, sem valor.",
    // Experimento de latência (JUDITE_FINAL_SHORT=1): a resposta final é o que mais demora (cerca de 1.200 tokens a ~57 por segundo).
    ...((p.short ?? process.env.JUDITE_FINAL_SHORT === "1")
      ? {
          formato:
            process.env.JUDITE_FORMAT === "classic"
              ? "Mesmo formato e mesmos rótulos, mais curto: Síntese em até 3 frases; cada campo de oportunidade em 1 ou 2 frases; não repita numa oportunidade o que já disse em outra; hipoteses só com as consideradas de fato."
              : "Mais curto: não repita uma ideia já dita; detalhe numérico longo em contas; hipoteses só com as consideradas de fato.",
        }
      : {}),
  };
}
