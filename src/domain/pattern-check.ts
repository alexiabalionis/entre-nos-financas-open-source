// Proveniência dos padrões na resposta da IA (SPEC-JUDITE-VISAO-AMPLA), no
// mesmo molde do dinheiro: vale a ETIQUETA {{pN}} que aponta para um destaque
// devolvido por `padroes` nesta pergunta, não as palavras da frase.
//  - frase com etiqueta: o que ela afirma (dia, hora, parte do mês...) precisa
//    estar no destaque citado; a etiqueta sai do texto mostrado;
//  - etiqueta que não existe ou não bate: a frase entra no reparo;
//  - dia da semana ou hora afirmados sem etiqueta: idem. Só esses dois, porque
//    só `padroes` sabe disso; "todo mês" ou "subiu" também aparecem em contas
//    fixas e nos fatos, e só são conferidos quando etiquetados.

export type PatternRef = {
  analise: string;
  corte: string;
  recorte: { tipo: string; chave: string };
  ids?: readonly string[];
  /** Etiquetas prontas (investigar_gastos, ref iN): o que o resultado sustenta, nas mesmas etiquetas de claimTags. */
  tags?: readonly string[];
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const WEEKDAY = /(?<![\p{L}])(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?s?(?![\p{L}])(?!\s+(?:semana|quinzena|parte|vez|metade|opcao))/gu;
const BAND =
  /(?<![\p{L}])(?:a|as|de|na|nas|pela|pelas|durante a|pra|para)\s+(tarde da noite|noite|manha|tarde|madrugada)(?![\p{L}])|(?<![\p{L}])(?:no|na hora do|hora do)\s+(almoco)(?![\p{L}])|(?<![\p{L}])(tarde da noite)(?![\p{L}])/gu;
const TIME_TAG = /^(dia|hora):/;
// Frase que pergunta, supõe ou diz o que não dá para saber não afirma padrão.
// "se" só como condição ("se vocês...", "para saber se"), não o pronome.
const NOT_A_CLAIM =
  /\?|(?:^[\s\-*•\d.)]*|[,;:]\s*|(?:saber|ver|verificar|conferir|dizer|afirmar|confirmar|checar|perguntar)\s+)se\s|(?<![\p{L}])(nao|sem|nenhum|nenhuma|vence|vencimento|agendad\w*)(?![\p{L}])/u;

/** O que uma frase afirma, em etiquetas comparáveis ("dia:segunda", "hora:noite"...). */
export function claimTags(sentence: string): Set<string> {
  const s = fold(sentence);
  const tags = new Set<string>();
  // "na primeira metade ... e na segunda": com "primeira" na frase, "segunda" sozinha é ordinal (só "segunda-feira" é dia).
  const ordinal = /(?<![\p{L}])primeir[ao]s?(?![\p{L}])/u.test(s);
  for (const m of s.matchAll(WEEKDAY))
    if (!(ordinal && m[1] === "segunda" && !/^segunda-feira/.test(s.slice(m.index ?? 0)))) tags.add(`dia:${m[1]}`);
  for (const m of s.matchAll(BAND)) tags.add(`hora:${m[1] ?? m[2] ?? m[3]}`);
  if (/fim de semana|fins de semana/.test(s)) tags.add("fds:fim de semana");
  if (/dias? ute?is/.test(s)) tags.add("fds:dia util");
  if (/(inicio|comeco|primeiros dias) do mes/.test(s)) tags.add("parte:inicio");
  if (/(meio|metade) do mes/.test(s)) tags.add("parte:meio");
  if (/(fim|final|ultimos dias) do mes/.test(s)) tags.add("parte:fim");
  for (const m of s.matchAll(/(primeira|segunda|terceira|quarta|quinta|[1-5]a?) semana/g))
    tags.add(`semana:${{ primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5 }[m[1]!] ?? m[1]![0]}`);
  if (/(depois|apos) (d[oa] |o )?(salario|pagamento)|salario cai/.test(s)) tags.add("salario");
  if (/todo mes|toda semana|assinatura|recorren/.test(s)) tags.add("recorrencia");
  if (/(?<![\p{L}])(subiu|aumentou|cresceu|caiu|diminuiu|em alta|em queda)(?![\p{L}])/u.test(s)) tags.add("tendencia");
  return tags;
}

// Oração negada ("não encontrei assinatura", "não se confirmou", "nenhuma compra"):
// o que ela menciona não é afirmado. Vale por oração, não pela frase inteira, para
// "não X, mas Y" continuar conferindo Y.
const CLAUSE = /[,;:()\u2014\u2013]|\s(?:e|mas|porem|entao|porque|pois)\s/;
const NEGATION = /(?<![\p{L}])(nao|nenhum|nenhuma|nunca|jamais|sem)(?![\p{L}])/u;
// Oração que só diz o que foi procurado ("procurei assinaturas", sem "que"): o objeto da busca não é afirmado
// quando uma oração seguinte nega o achado ("e não encontrei nenhum"). "Verifiquei que..." continua afirmando.
const SEARCH = /^\s*(procurei|busquei|olhei|verifiquei|conferi|investiguei|testei|chequei|analisei|pesquisei)(?![\p{L}])(?!\s+que(?![\p{L}]))/u;
// Oração condicional ("só vale se vocês mantiverem ... todo mês", "caso ..."): descreve a condição de uma hipótese,
// não afirma padrão. Só formas inequívocas: "se" reflexivo ("se concentra na segunda") continua afirmando.
const CONDITIONAL =
  /(?<![\p{L}])so\s+(?:(?:vale|funciona|acontece|da|compensa)\s+)?se\s|^\s*(?:(?:e|mas)\s+)?caso\s|^\s*(?:(?:e|mas)\s+)?se\s+(?:voces|voce|a gente|eles|houver|for|forem|mantiverem|conseguirem|reduzirem|cortarem|pagarem|fizerem|deixarem|trocarem|quiserem|acontecer|der)(?![\p{L}])/u;

/** As etiquetas afirmadas: as de claimTags, menos as que só aparecem em orações negadas, condicionais ou em buscas sem achado. */
export function assertedTags(sentence: string): Set<string> {
  const all = claimTags(sentence);
  const clauses = fold(sentence).split(CLAUSE);
  if (clauses.length < 2 && !NEGATION.test(fold(sentence)) && !CONDITIONAL.test(fold(sentence))) return all;
  const asserted = new Set<string>();
  clauses.forEach((clause, i) => {
    if (NEGATION.test(clause) || CONDITIONAL.test(clause)) return;
    if (SEARCH.test(clause) && clauses.slice(i + 1).some((c) => NEGATION.test(c))) return;
    for (const t of claimTags(clause)) asserted.add(t);
  });
  return new Set([...all].filter((t) => asserted.has(t)));
}

/** O que um destaque de `padroes` sustenta, nas mesmas etiquetas. */
export function refTags(ref: PatternRef): Set<string> {
  const c = fold(ref.corte);
  const tags = new Set<string>();
  const value = c.slice(c.indexOf(":") + 1).trim();
  if (c.startsWith("dia_da_semana_e_hora:")) {
    const [day, ...band] = value.split(" ");
    tags.add(`dia:${day}`).add(`hora:${band.join(" ")}`);
  } else if (c.startsWith("dia_da_semana:")) tags.add(`dia:${value}`);
  else if (c.startsWith("hora_do_dia:")) tags.add(`hora:${value}`);
  else if (c.startsWith("dia_util_ou_fim_de_semana:")) tags.add(`fds:${value}`);
  else if (c.startsWith("parte_do_mes:")) tags.add(`parte:${value}`);
  else if (c.startsWith("semana_do_mes:")) tags.add(`semana:${value[0]}`);
  if (ref.analise === "dias_fora_da_curva") tags.add(`dia:${c.split(":")[0]!.trim()}`);
  if (ref.analise === "ritmo_salario") tags.add("salario");
  if (ref.analise === "recorrencia_escondida") tags.add("recorrencia");
  if (ref.analise === "tendencia" || ref.analise === "forma_pagamento") tags.add("tendencia");
  for (const t of ref.tags ?? []) tags.add(fold(t));
  return tags;
}

const MARK = /\s?\{\{\s*([pis]\d+)\s*\}\}/g;

/**
 * Confere as etiquetas de padrão e tira as etiquetas do texto. Nunca apaga
 * nada (decisão de 22/11/2026: a conferência de padrão não pode fazer perder
 * resposta): o texto volta igual, só sem as etiquetas.
 *  - aceita: frase etiquetada que o destaque sustenta, e frase SEM etiqueta
 *    cujo dia ou hora algum resultado desta pergunta (padroes ou
 *    investigar_gastos) sustenta (vai em `untagged`, só para medir);
 *  - `rejected`: o que nenhum resultado sustenta, ou etiqueta que não existe ou
 *    não bate. Serve para pedir UMA reescrita ao modelo; se ela não vier, a
 *    frase fica como está.
 */
export function checkPatterns(
  text: string,
  refs: ReadonlyMap<string, PatternRef>,
): { text: string; rejected: string[]; untagged: string[] } {
  const rejected: string[] = [];
  const untagged: string[] = [];
  const backedAll = new Set([...refs.values()].flatMap((r) => [...refTags(r)]));
  const out = text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => {
          const cited = [...sentence.matchAll(MARK)].map((m) => m[1]!);
          const clean = sentence.replace(MARK, "");
          const claims = assertedTags(clean);
          if (cited.length) {
            const found = cited.map((r) => refs.get(r));
            const backed = new Set(found.flatMap((r) => (r ? [...refTags(r)] : [])));
            // Etiqueta que não bate: vale se outro resultado da pergunta sustenta o que a frase diz.
            const bad = found.some((r) => !r) || [...claims].some((t) => !backed.has(t) && !backedAll.has(t));
            if (bad) rejected.push(`padrão sem base: "${clean.trim()}"`);
            return clean;
          }
          const uncited = [...claims].filter((t) => TIME_TAG.test(t));
          if (uncited.length && !NOT_A_CLAIM.test(fold(clean))) {
            // Sustentado por algum resultado da pergunta: aceito sem etiqueta. Sem base: pede reescrita, não apaga.
            if (uncited.every((t) => backedAll.has(t))) untagged.push(clean.trim());
            else rejected.push(`padrão sem base: "${clean.trim()}"`);
            return clean;
          }
          return clean;
        })
        .join(" "),
    )
    .join("\n");
  return { text: out, rejected, untagged };
}
