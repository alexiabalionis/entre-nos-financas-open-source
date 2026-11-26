// Contratos de evidência (Fase 7.5): pouca coisa, declarada, e só onde a
// necessidade é inequívoca. Não é um roteador: o modelo continua escolhendo
// as ferramentas; o servidor só garante a evidência que uma pergunta
// claramente exige, e diz de onde (escopo) cada evidência veio.
import { normalizeSearch } from "../domain/memory-search.ts";
import type { ToolCall } from "./judite-tools-schema.ts";

/** Evidência com escopo: tipo, categoria, período, população e o que cobre. */
export type Evidence = {
  kind:
    | "sobra_media"
    | "gasto_categoria"
    | "memoria"
    | "reservas"
    | "obrigacoes"
    | "mes_atual"
    | "movimentos"
    | "comparacao"
    | "simulacao"
    | "outra";
  category?: string;
  from?: string;
  to?: string;
  population?: "panorama" | "dia_a_dia" | "movimentos" | "confirmados_competencia";
  /** Partes de um tipo composto (obrigações: fixas, cartoes, atrasadas). */
  covers?: string[];
};

type ToolResult = { chamada: { name: string } & Record<string, unknown>; resultado: unknown };

const ym = (v: unknown) => (v === undefined || v === null ? undefined : String(v).slice(0, 7));

/** O que um resultado de ferramenta realmente cobre (pelo resultado, não pelo nome). */
export function evidenceOf(t: ToolResult): Evidence[] {
  const r = (t.resultado ?? {}) as Record<string, unknown>;
  if ("erro" in r || "sem_historico" in r) return [];
  const months = (r.meses as { mes: string }[] | undefined)?.map((m) => m.mes) ?? [];
  switch (t.chamada.name) {
    case "sobra_atual":
    case "caminhos_para_sobrar":
    case "acima_do_normal":
    case "renda_por_tipo":
      return [{ kind: "sobra_media", population: "panorama" }];
    case "historico_categoria":
      return [{ kind: "gasto_categoria", category: String(r.categoria), from: months[0], to: months.at(-1), population: "dia_a_dia" }];
    case "detalhar_categoria":
      return [{ kind: "gasto_categoria", category: String(r.categoria), from: ym(r.de), to: ym(r.ate), population: "movimentos" }];
    case "buscar_movimentos": {
      const span = { from: ym(r.de), to: ym(r.ate) };
      const filtered = (r.filtros as { categoria?: string } | undefined)?.categoria;
      const cat = (r.linhas as { categoria: string | null }[] | undefined)?.map((l) => l.categoria);
      // Uma categoria: pelo filtro aplicado, ou quando todas as linhas são dela.
      const only = filtered ?? (cat?.length && cat.every((c) => c === cat[0]) ? cat[0] : null);
      const general: Evidence = { kind: "movimentos", ...span, population: "movimentos" };
      return only ? [general, { kind: "gasto_categoria", category: only, ...span, population: "movimentos" }] : [general];
    }
    case "maiores_gastos":
      return [{ kind: "movimentos", from: ym(r.de), to: ym(r.ate), population: "movimentos" }];
    case "comparar_meses":
      return [{ kind: "comparacao", from: ym(r.mes_a), to: ym(r.mes_b) }];
    case "falta_pagar":
      return [{ kind: "obrigacoes", covers: ["fixas", "cartoes", "atrasadas"] }];
    case "contas_fixas":
      return [{ kind: "obrigacoes", covers: ["fixas", "atrasadas"] }];
    case "cartoes":
      return [{ kind: "obrigacoes", covers: ["cartoes"] }];
    case "mes_atual":
      return [{ kind: "mes_atual" }, { kind: "obrigacoes", covers: ["atrasadas"] }];
    case "simular":
      return [{ kind: "simulacao" }];
    case "search_memory":
      return ((r.memorias as unknown[]) ?? []).length ? [{ kind: "memoria" }] : [];
    case "reservas":
      return [{ kind: "reservas" }];
    case "proximas_decisoes": {
      const kinds = new Set(((r.itens as { tipo: string }[] | undefined) ?? []).map((i) => i.tipo));
      const bills = kinds.has("fatura") || kinds.has("conta_fixa");
      return [
        ...(bills ? [{ kind: "obrigacoes" as const, covers: ["fixas", "cartoes"] }] : []),
        ...(kinds.has("reserva") ? [{ kind: "reservas" as const }] : []),
      ];
    }
    case "abertura": {
      const span = { from: ym((r.periodo as { de?: string } | undefined)?.de), to: ym((r.periodo as { ate?: string } | undefined)?.ate) };
      return ((r.categorias as { categoria: string }[] | undefined) ?? []).map((c) => ({
        kind: "gasto_categoria" as const,
        category: c.categoria,
        ...span,
        population: "movimentos" as const,
      }));
    }
    default:
      return [{ kind: "outra" }];
  }
}

// Pedido explícito de lembrar algo decidido ou concluído antes. Lista curta e
// fechada de construções inequívocas; perguntas abertas ficam com o modelo.
const RECALL = [
  /\b(o que|que) (a gente |nos )?(combin|decid|prometem|tinhamos combin)\w*/,
  /\b(combinamos|decidimos|ficou combinado|tinhamos combinado|a gente combinou)\b/,
  /\b(qual|quais) (era|eram|foi|foram) (a |o |as |os )?(nossa |nosso |nossas |nossos )?(meta|objetivo|limite|combinado)s?\b/,
  /\b(nossa meta|nosso objetivo|nosso limite|nosso combinado)\b.*\b(era|foi)\b/,
  // "O que a gente dizia antes sobre Pet?": o que foi dito ou concluído antes.
  /\b(o que|que) (a gente |nos )?(dizia|diziamos|falava|falavamos|achava|achavamos|concluimos|tinhamos (dito|concluido|visto))\b/,
];
const CHECK = /\b(estamos|estou|tamos) cumprindo|\bcumprimos\b|\bdentro do (combinado|limite)\b|\bpassamos do (combinado|limite)\b/;

export const recallIntent = (q: string) => RECALL.some((re) => re.test(normalizeSearch(q))) || CHECK.test(normalizeSearch(q));
const checkIntent = (q: string) => CHECK.test(normalizeSearch(q));

/** Antes da primeira ida ao modelo: só a memória, e só com pedido inequívoco. */
/** Diagnóstico aberto sobre vários meses ("o que eu poderia fazer diferente", "como melhorar as finanças"). */
export function openDiagnosticIntent(question: string): boolean {
  const q = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return (
    /o que (eu|a gente|nos) (poderia|poderiamos|podemos|posso|devo|deveria|deveriamos) (fazer )?(de )?diferente|melhorar (as |minhas |nossas |a nossa |a minha )?(vida )?financ|onde (a gente|eu|nos) (esta|estamos|estou) errando|colocar (as financas )?no trilho/.test(q) ||
    // Aumentar o que sobra (com ou sem alvo): "aumentar o que sobra", "sobrar mais", "elevar a sobra para 10%".
    /aumentar (o que|a|nossa|minha) sobra|(fazer )?sobrar mais|sobra[\s\S]{0,80}\b(elevar|aumentar|subir|chegar)\b|\b(elevar|aumentar|subir) (a |nossa |minha )?sobra/.test(q) ||
    // Economizar ou cortar sem item fechado: "onde dá para economizar", "formas de economizar", "cortar gastos".
    /onde (da|daria|podemos|posso|consigo) (para )?(economizar|cortar|reduzir)|formas? de (economizar|cortar|reduzir|aumentar)|como (economizar|gastar menos)|cortar (os |nossos |meus )?gastos/.test(q) ||
    // Avaliação ampla: "avaliação das contas fixas", "analise meus gastos", "padrões que impactam".
    /\b(avaliacao|avaliar|avalie|analise|analisar|analisa|diagnostico)\b[^.?!]{0,80}\b(contas?|gastos?|despesas?|compras?|compromissos?|financas|orcamento|dinheiro)\b|padroes? que (se repetem|impactam|pesam|prejudicam|atrapalham)/.test(q) ||
    // O que pesa e como ter controle: "o que está impactando minhas finanças", "estratégias para me manter no planejado".
    (!/^\s*(quanto|qual|quais|quando)\b/.test(q) &&
      /\b(impact\w*|pes(a|ando|am)|prejudic\w*|atrapalh\w*|piorando|afundando)\b[^.?!]{0,50}\b(financas|sobra|orcamento|dinheiro|planejad\w*)\b/.test(q)) ||
    /\b(estrategias?|ideias?|dicas?|caminhos?|jeitos?|formas?)\b[^.?!]{0,80}\b(controle|planejad\w*|orcamento|financas|gastar menos|economizar|sobrar)\b|(manter|ficar|seguir) dentro do (planejad\w*|orcamento|combinado)|fora do obvio/.test(q)
  );
}

// Pedido factual ou de ação: nunca herda a rota do diagnóstico, mesmo no meio dele.
const FACTUAL = /quanto (gastei|gastamos|gasto|sobrou|entrou)|o que falta pagar|maiores gastos|registr|lanc[ae]|salv[ae]|cri[ae] (um|uma|o|a) /;
// Os chips rápidos do chat novo também ficam na rota padrão, que responde curto.
const QUICK = /quanto sobra|como estao (nossos|os|meus) investimentos/;

/** Pergunta curta (factual, ação ou chip rápido): fica na rota padrão mesmo com a rota aberta solta. */
export const quickIntent = (question: string) => {
  const q = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return FACTUAL.test(q) || QUICK.test(q);
};

/**
 * Continuação de um diagnóstico: a mensagem anterior da Judite saiu no formato
 * do diagnóstico, ou a pergunta anterior da pessoa era um, e a mensagem atual não
 * é um pedido factual. Assim "Compras pessoais, alimentação fora" depois de um
 * diagnóstico continua sendo investigada.
 */
export function diagnosticFollowUp(question: string, history: readonly { role: string; text: string }[] = []): boolean {
  if (quickIntent(question) || !history.length) return false;
  const lastAssistant = [...history].reverse().find((h) => h.role !== "user");
  // Formato livre não tem título que marque o diagnóstico: vale qualquer das 3 últimas perguntas da pessoa.
  const recentUsers = history.filter((h) => h.role === "user").slice(-3);
  return /(^|\n)\s*(Síntese:|O que percebi:|Onde vocês estão)/.test(lastAssistant?.text ?? "") || recentUsers.some((u) => openDiagnosticIntent(u.text));
}

/** Diagnóstico pela pergunta ou pela conversa (a rota aberta e tudo que vem com ela). */
export const diagnosticIntent = (question: string, history?: readonly { role: string; text: string }[]) =>
  openDiagnosticIntent(question) || diagnosticFollowUp(question, history);

export function initialPrefetch(p: { question: string; activeMemories: number; diagnostic?: boolean; open?: boolean }): ToolCall[] {
  const out: ToolCall[] = [];
  if (p.activeMemories && recallIntent(p.question)) out.push({ name: "search_memory", consulta: p.question.slice(0, 200), limite: 5 });
  // Diagnóstico aberto: os sinais vêm sempre lidos (o modelo decide o que investigar depois).
  const diagnostic = p.diagnostic ?? openDiagnosticIntent(p.question);
  if (diagnostic) {
    out.push({ name: "padroes" });
    // JUDITE_DIAG_PREFETCH=basic volta o prefetch do diagnóstico a só padroes.
    if (process.env.JUDITE_DIAG_PREFETCH !== "basic") {
      out.push({ name: "renda_por_tipo" }, { name: "avisos_de_dados" });
      // Perfil da casa (aprendizados) vira restrição do diagnóstico. Quando o recall já busca
      // memória nesta pergunta, não duplica a busca.
      if (p.activeMemories > 0 && !out.some((c) => c.name === "search_memory")) out.push({ name: "search_memory", tipo: "aprendizado", limite: 8 });
    }
  }
  // Rota aberta: o que tem dentro das categorias que pesam e o que vence logo, em toda pergunta (fora do orçamento).
  // proximas_decisoes vem junto para a resposta nunca dizer "nada marcado" sem ter olhado.
  if (p.open && process.env.JUDITE_DIAG_PREFETCH !== "basic") out.push({ name: "abertura" }, { name: "proximas_decisoes" });
  else if (diagnostic && process.env.JUDITE_DIAG_PREFETCH !== "basic") out.push({ name: "proximas_decisoes" });
  return out;
}

/** Busca de perfil: só aprendizados recentes, sem consulta (a busca de recall tem consulta e continua gastando). */
const isProfilePrefetch = (call: ToolCall) => call.name === "search_memory" && call.tipo === "aprendizado" && call.consulta === undefined;

/** Prefetch obrigatório do diagnóstico que não gasta o orçamento do modelo (padroes continua gastando). */
export const budgetFreePrefetch = (call: ToolCall) => call.name === "renda_por_tipo" || call.name === "avisos_de_dados" || call.name === "abertura" || call.name === "proximas_decisoes" || isProfilePrefetch(call);

type MemoryHit = { ref: string; tipo: string; categoria: string | null; temas: string[]; texto: string };

/**
 * Depois de cada rodada: "estamos cumprindo o combinado?" exige o gasto da
 * categoria do combinado. Se nenhuma evidência obtida cobre essa categoria,
 * devolve a chamada que cobre (histórico da categoria contra o combinado).
 */
export function followUp(p: {
  question: string;
  results: ToolResult[];
  categories: { name: string }[];
}): ToolCall | null {
  if (!checkIntent(p.question)) return null;
  const memory = p.results.filter((t) => t.chamada.name === "search_memory");
  const hits = memory.flatMap((t) => ((t.resultado as { memorias?: MemoryHit[] }).memorias ?? []));
  const evidence = p.results.flatMap(evidenceOf);
  for (const m of hits) {
    if (m.tipo !== "combinado" && m.tipo !== "objetivo") continue;
    if (!/R\$\s?\d/.test(m.texto)) continue;
    const names = [m.categoria, ...m.temas].filter((x): x is string => !!x).map(normalizeSearch);
    const idx = p.categories.findIndex((c) => names.includes(normalizeSearch(c.name)));
    if (idx < 0) continue;
    const name = p.categories[idx].name;
    if (evidence.some((e) => e.kind === "gasto_categoria" && e.category === name)) return null;
    return { name: "historico_categoria", categoria: `c${idx}`, comparar_com: m.ref };
  }
  return null;
}
