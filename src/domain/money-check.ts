// Proveniência do dinheiro na resposta da IA (SPEC-JUDITE-MEMORIA, apêndice B).
// Vale a ORIGEM do número, não as palavras da frase:
//  - valor apurado pelo app (campo *_formatted de fatos, catálogo, ferramentas): passa;
//  - valor que a pessoa escreveu na pergunta atual: passa como fala dela (declared);
//  - histórico da conversa, notas e texto livre de ferramentas: não são fonte;
//  - memória: só com a marca {{mN:trecho}}, e sai como registro histórico;
//  - sem origem: vira "[valor não conferido]".
import { historicalMoney, normalizeSearch, type MemoryKind } from "./memory-search.ts";

const MONEY_SRC = String.raw`-?(?:R\$|US\$|€)\s?-?\d{1,3}(?:\.\d{3})*(?:,\d{2})?`;
const MONEY = new RegExp(MONEY_SRC, "g");
const UNVERIFIED = "[valor não conferido]";
export { UNVERIFIED };

// Sem espaços, sem sinal e sem ",00": "déficit de R$ 800,00" confere com uma
// fonte "-R$ 800,00". O sinal fica com as palavras da frase.
const norm = (s: string) => s.replace(/[\s-]/g, "").replace(/,00$/, "");

/** Valores em dinheiro de um texto, normalizados para comparar. */
export function moneyIn(text: string): Set<string> {
  return new Set((text.match(MONEY) ?? []).map(norm));
}

/** Quantas vezes o dinheiro aparece no texto (repetido conta de novo). */
export function moneyCount(text: string): number {
  return (text.match(MONEY) ?? []).length;
}

/** "R$ 1.000,00" → 100000n. */
export function moneyCents(value: string): bigint {
  const digits = value.replace(/[^\d,]/g, "");
  const [int, dec = "00"] = digits.split(",");
  return BigInt(int || "0") * 100n + BigInt((dec + "00").slice(0, 2));
}

export type MemorySource = {
  kind: MemoryKind;
  as_of: string;
  values: Set<string>;
  /** Texto e contexto da memória, para conferir trechos citados. */
  content: string;
};
export type MoneySources = {
  /** Valores apurados pelo app: só campos *_formatted de fatos, catálogo e ferramentas. */
  financial: string;
  /**
   * O que a pessoa escreveu NA PERGUNTA ATUAL. Pode ser repetido como fala
   * dela ("os R$ 500,00 que você quer guardar"), nunca vira valor apurado.
   * Mensagens anteriores não entram aqui: o histórico vem do cliente.
   */
  declared?: string;
  /** Memórias recuperadas NESTA pergunta, pela referência m0, m1... */
  memories?: ReadonlyMap<string, MemorySource>;
  /**
   * Período de um valor apurado quando a fonte o rotula: "mes" (média ou
   * alavanca por mês) ou "periodo" (total de vários meses). "neutro" = o mesmo
   * valor também aparece sem rótulo, e então o período não é conferido.
   */
  periods?: ReadonlyMap<string, ReadonlySet<Period>>;
  /** Papel de cada valor quando dito como economia (ver MoneyRole). */
  roles?: ReadonlyMap<string, ReadonlySet<MoneyRole>>;
};
export type Period = "mes" | "periodo" | "neutro";
/**
 * Papel de um valor apurado quando dito como economia ("economizar R$ X",
 * "devolve R$ X por mês"):
 *  - economia: alavanca de padroes ou diferença de simular_mudanca calculada;
 *  - hipotetica: diferença de simular_mudanca que depende de uma condição;
 *  - nao_economia: diferença histórica, dinheiro movimentado ou descrição;
 *  - outro: valor de qualquer outra fonte (fica como hoje, sem conferência de papel).
 * Um valor só é bloqueado se TODAS as suas fontes forem nao_economia, ou se
 * todas forem hipotetica e a frase não disser a condição.
 */
export type MoneyRole = "economia" | "hipotetica" | "nao_economia" | "outro";
const SAYS_SAVING = /econom\w*|poupa\w*|devolv\w*|\bvolta(ria|r)?\b|a mais por m[eê]s/i;
const SAYS_CONDITION = /\b(se|caso|depende\w*|hipot\w*|talvez|confirm\w*|poderia|pode|negoci\w*|perguntar|condi[cç]\w*)\b/i;

/** A frase que contém a posição (entre pontos finais ou quebras de linha). */
function sentenceAt(text: string, offset: number, length: number): string {
  const before = text.slice(0, offset);
  const start = Math.max(before.lastIndexOf(". "), before.lastIndexOf("\n"), before.lastIndexOf("! "), before.lastIndexOf("? ")) + 1;
  const rest = text.slice(offset + length);
  const m = rest.search(/[.!?](\s|$)|\n/);
  return text.slice(start, offset + length + (m < 0 ? rest.length : m));
}

/**
 * O que a conferência permite fazer com um valor numa frase de economia (a mesma
 * decisão de wrongRole, sem a frase): livre, só com a condição na frase, ou nunca.
 */
export function savingUse(roles: ReadonlySet<MoneyRole> | undefined): "livre" | "com_condicao" | "nao_e_economia" {
  if (!roles || !roles.size) return "livre";
  if ([...roles].every((r) => r === "nao_economia")) return "nao_e_economia";
  if ([...roles].every((r) => r === "hipotetica")) return "com_condicao";
  return "livre";
}

export function wrongRole(sentence: string, roles: ReadonlySet<MoneyRole> | undefined): string | null {
  if (!SAYS_SAVING.test(sentence)) return null;
  const use = savingUse(roles);
  if (use === "nao_e_economia") return "dito como economia, mas é diferença histórica, dinheiro movimentado ou descrição";
  if (use === "com_condicao" && !SAYS_CONDITION.test(sentence)) return "economia hipotética dita sem a condição";
  return null;
}

const SAYS_MONTHLY = /^\s*(?:por|ao|\/|a cada)\s*m[eê]s|^\s*mensa(?:l|is)\b|^\s*todo m[eê]s/i;
const SAYS_TOTAL = /^\s*(?:no total|no per[ií]odo|em \d+ meses|nos (?:[uú]ltimos )?\d+ meses|somad)/i;

/** O período que a frase dá ao valor contradiz o que a fonte diz dele? */
function wrongPeriod(after: string, known: ReadonlySet<Period> | undefined): boolean {
  if (!known || known.has("neutro")) return false;
  if (SAYS_MONTHLY.test(after)) return !known.has("mes");
  if (SAYS_TOTAL.test(after)) return !known.has("periodo");
  return false;
}

/**
 * Os valores que o próprio app formatou: só strings em chaves `formatted` ou
 * `*_formatted`. Texto livre (notas, memórias, nomes, histórico) fica de fora,
 * mesmo que diga "verificado pelo banco": a origem é a estrutura, não a frase.
 */
export function formattedMoneyText(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (typeof v === "string" && (key === "formatted" || key.endsWith("_formatted"))) out.push(v);
  };
  walk(value, "");
  return out.join("\n");
}

const MONEY_ONLY = new RegExp(`^${MONEY_SRC}$`);

export function checkMoney(
  text: string,
  sources: MoneySources,
): { text: string; replaced: number; rejected: string[]; declared: string[] } {
  const known = moneyIn(sources.financial);
  const said = moneyIn(sources.declared ?? "");
  const declared: string[] = [];
  const memories = sources.memories ?? new Map<string, MemorySource>();
  const rejected: string[] = [];
  const miss = (value: string) => {
    rejected.push(value);
    return UNVERIFIED;
  };
  // {{pN}}, {{iN}} e {{sN}} são etiquetas de padrão, investigação e simulação (pattern-check.ts), conferidas depois: não são marca de memória.
  const cited = new RegExp(String.raw`\{\{\s*(m\d+)\s*:\s*([^}]+?)\s*\}\}|\{\{(?!\s*[pis]\d+\s*\}\})[^}]*\}\}|${MONEY_SRC}`, "g");
  // O marcador escrito pelo próprio modelo (copiado das regras) é uma afirmação
  // sem valor conferido: entra no reparo como qualquer outro valor sem origem.
  for (let i = text.split(UNVERIFIED).length - 1; i > 0; i--) rejected.push(UNVERIFIED);
  const out = text.replace(cited, (match: string, ref: string | undefined, inner: string | undefined, offset: number) => {
    if (ref && inner) {
      const m = memories.get(ref);
      if (!m) return miss(match);
      if (MONEY_ONLY.test(inner)) return m.values.has(norm(inner)) ? historicalMoney(inner, m.kind, m.as_of) : miss(match);
      // Trecho que não é só dinheiro (ex.: "10%", "limitar Delivery a R$ 600,00"):
      // passa se estiver, literalmente, no texto ou no contexto da memória.
      return normalizeSearch(m.content).includes(normalizeSearch(inner)) ? historicalMoney(inner, m.kind, m.as_of) : miss(match);
    }
    // Marca malformada ({{...}} sem referência e trecho válidos).
    if (match.startsWith("{{")) return miss(match);
    if (known.has(norm(match))) {
      if (wrongPeriod(text.slice(offset + match.length, offset + match.length + 30), sources.periods?.get(norm(match)))) return miss(match);
      const role = wrongRole(sentenceAt(text, offset, match.length), sources.roles?.get(norm(match)));
      if (role) {
        rejected.push(`${match} (${role})`);
        return UNVERIFIED;
      }
      return match;
    }
    if (said.has(norm(match))) {
      declared.push(match);
      return match;
    }
    return miss(match);
  });
  return { text: out, replaced: rejected.length, rejected, declared };
}

/**
 * Último recurso, depois do reparo: tira cada afirmação com valor sem origem.
 * A unidade é o item de lista ou a frase; um parágrafo ou lista que fica vazio
 * sai inteiro, junto com a linha que o introduz (termina em ":"), e uma frase
 * de conclusão que vem logo depois e começa por "Ou seja"/"Com isso"/"Assim"/
 * "Isso" sai junto (depende do número removido). Nunca devolve o marcador.
 */
export function dropUnverified(text: string): { text: string; dropped: number } {
  const DEPENDENT = /^(ou seja|com isso|assim|isso|portanto|entao|então|logo)\b/i;
  let dropped = 0;
  const blocks = text.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    const isList = lines.some((l) => /^\s*-\s/.test(l));
    if (isList) {
      const kept = lines.filter((l) => {
        if (/^\s*-\s/.test(l) && l.includes(UNVERIFIED)) {
          dropped++;
          return false;
        }
        return true;
      });
      const items = kept.filter((l) => /^\s*-\s/.test(l));
      if (!items.length) return kept.filter((l) => !/:\s*$/.test(l) && !l.includes(UNVERIFIED)).join("\n");
      return kept.map((l) => (l.includes(UNVERIFIED) ? dropSentences(l) : l)).join("\n");
    }
    return lines.map(dropSentences).join("\n");
  });
  function dropSentences(line: string): string {
    const parts = line.split(/(?<=[.!?])\s+(?=[\p{Lu}"(])/u);
    let removedPrevious = false;
    return parts
      .filter((s) => {
        const bad = s.includes(UNVERIFIED) || (removedPrevious && DEPENDENT.test(s.trim()));
        removedPrevious = bad;
        if (bad) dropped++;
        return !bad;
      })
      .join(" ")
      .trim();
  }
  const out = blocks.map((b) => b.trim()).filter(Boolean).join("\n\n");
  return { text: out.includes(UNVERIFIED) ? out.split(UNVERIFIED).join("") : out, dropped };
}

export const OMITTED_NOTE = "Deixei de fora alguns valores porque não consegui conferir de onde vieram.";

export const REPAIR_EXPLANATION =
  "Não consegui conferir um dos números dessa análise, então preferi não tirar conclusões a partir dele. Se quiser, pergunte de novo citando o mês ou a categoria.";

const CONCLUSION =
  /(?<![\p{L}])(por isso|portanto|então|entao|logo|assim|consequentemente|dessa forma|com isso|ou seja|o que significa|isso mostra)(?![\p{L}])/iu;

/**
 * Coerência vale mais que completude: se uma afirmação sem origem saiu e depois
 * dela sobrou uma conclusão, a conclusão pode depender do que foi removido e a
 * remoção cirúrgica deixaria um raciocínio sem base. Nesse caso a resposta toda
 * vira uma explicação curta. Sem conclusão restante, só se remove a afirmação.
 */
export function repairFallback(text: string): { text: string; kind: "removed" | "replaced" | "empty"; dropped: number } {
  const dropped = dropUnverified(text);
  if (!dropped.text) return { text: "", kind: "empty", dropped: dropped.dropped };
  if (!dropped.dropped) return { text: dropped.text, kind: "removed", dropped: 0 };
  const head = text.slice(0, text.indexOf(UNVERIFIED));
  const lastStop = [...head.matchAll(/[.!?](?=\s)/g)].pop()?.index ?? -1;
  const boundary = Math.max(lastStop, head.lastIndexOf("\n"));
  const safeHead = boundary > 0 ? head.slice(0, boundary + 1) : "";
  const after = dropped.text.slice(dropUnverified(safeHead).text.length);
  if (CONCLUSION.test(after)) return { text: REPAIR_EXPLANATION, kind: "replaced", dropped: dropped.dropped };
  return { text: dropped.text, kind: "removed", dropped: dropped.dropped };
}
