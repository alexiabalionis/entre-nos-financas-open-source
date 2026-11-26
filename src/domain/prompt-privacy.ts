// Sanitização central do que vai ao provedor de IA (Fase 7.5). O banco guarda
// o original; isto transforma só a cópia que sai, num ponto só (requestLlm).
// Vale para fatos, catálogo, resultados de ferramentas, notas, memórias e
// histórico do chat.
//
// Fica: valores (centavos e formatados), datas, meses, categorias, etiquetas,
// tipos e referências (c0, m0): é o que a análise financeira precisa.
// Sai ou é mascarado:
//  - documentos e números longos (CPF, CNPJ, cartão, conta, chave aleatória);
//  - email e telefone;
//  - o nome de quem pagou ou recebeu num Pix, TED ou transferência.
// Nomes soltos em texto livre não são detectáveis com segurança; a auditoria
// (scripts/judite-payload-audit.ts) mede quanto texto livre sai e de onde.

const MASK = "…";
export type Detector =
  | "cpf"
  | "cnpj"
  | "cartao"
  | "telefone"
  | "email"
  | "nome_apos_transferencia"
  | "digitos_longos";

const RULES: [Detector, RegExp, string][] = [
  ["email", /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]"],
  ["digitos_longos", /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, MASK],
  ["cnpj", /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, MASK],
  ["cpf", /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, MASK],
  ["cartao", /\b(?:\d[ -]?){13,19}\b/g, MASK],
  ["telefone", /(?:\+?55[\s-]?)?\(?\b\d{2}\)?[\s-]?9?\d{4}[\s-]\d{4}\b/g, "[telefone]"],
  ["digitos_longos", /\b\d{6,}\b/g, MASK],
];

const TRANSFER =
  /\b(pix|ted|doc|transfer[eê]ncia|transf)\b((?:\s+(?:(?:enviad[oa]|recebid[oa]|agendad[oa]|para|de)\b|p\/))*)/gi;
// Depois de "Pix" estas palavras descrevem a operação ou o estabelecimento, não uma pessoa.
const MERCHANT_CONTEXT = /^\s+(qr\s*code|delivery|pagamento|compra|cobran[cç]a|saque|troco)\b/i;
// Palavra de nome próprio: começa com maiúscula (os extratos vêm em CAIXA ALTA).
const PROPER = /^\s+(\p{Lu}[\p{L}'.]*)/u;

/** "PIX ENVIADO MARIA DA SILVA" → "PIX ENVIADO …"; "Pix de agosto" fica. */
function maskTransferNames(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TRANSFER)) {
    const end = m.index + m[0].length;
    let rest = text.slice(end);
    if (MERCHANT_CONTEXT.test(rest)) continue;
    let took = 0;
    for (let i = 0; i < 5; i++) {
      const w = PROPER.exec(rest);
      // Conectivos de nome (da, de, dos) só contam entre palavras de nome.
      const connector = /^\s+(da|de|do|das|dos|e)\b/i.exec(rest);
      if (w) {
        took += w[0].length;
        rest = rest.slice(w[0].length);
      } else if (connector && took > 0 && PROPER.test(rest.slice(connector[0].length))) {
        took += connector[0].length;
        rest = rest.slice(connector[0].length);
      } else break;
    }
    if (!took) continue;
    out += text.slice(last, end) + " " + MASK;
    last = end + took;
  }
  return out + text.slice(last);
}

// Valor estrutural inteiro (número, data, mês, referência, dinheiro): passa.
const STRUCTURAL_VALUE = /^(-?\d+|\d{4}-\d{2}(-\d{2})?|[a-z]\d+|-?(R\$|US\$|€)\s?-?[\d.,]+)$/;

function scan(text: string): { out: string; hits: Map<Detector, number> } {
  const hits = new Map<Detector, number>();
  const count = (d: Detector, n: number) => n && hits.set(d, (hits.get(d) ?? 0) + n);
  let out = maskTransferNames(text);
  count("nome_apos_transferencia", out.split(MASK).length - text.split(MASK).length);
  for (const [detector, re, to] of RULES) {
    count(detector, out.match(re)?.length ?? 0);
    out = out.replace(re, to);
  }
  return { out, hits };
}

export function sanitizeText(text: string): string {
  return scan(text).out;
}

export interface PayloadAudit {
  campos: { caminho: string; tipo: "numero" | "estrutural" | "texto_livre" }[];
  deteccoes: { caminho: string; detector: Detector; contagem: number }[];
}

/** Mede o payload sem devolver nenhum valor: só caminhos, tipos e contagens. */
export function auditPayload(value: unknown, path = "$", audit: PayloadAudit = { campos: [], deteccoes: [] }): PayloadAudit {
  if (typeof value === "string") {
    const structural = STRUCTURAL_VALUE.test(value.trim());
    audit.campos.push({ caminho: path, tipo: structural ? "estrutural" : "texto_livre" });
    if (!structural)
      for (const [detector, contagem] of scan(value).hits) audit.deteccoes.push({ caminho: path, detector, contagem });
  } else if (typeof value === "number") audit.campos.push({ caminho: path, tipo: "numero" });
  else if (Array.isArray(value)) value.forEach((v, i) => auditPayload(v, `${path}[${i}]`, audit));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) auditPayload(v, `${path}.${k}`, audit);
  return audit;
}

/** Percorre um valor JSON e sanitiza todos os textos livres. */
export function sanitizeForProvider(value: unknown): unknown {
  if (typeof value === "string") return STRUCTURAL_VALUE.test(value.trim()) ? value : sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeForProvider);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeForProvider(v)]));
  return value;
}

/** Para entradas que são JSON em texto (input, inputTail); texto puro passa pelas regras. */
export function sanitizePayloadText(raw: string): string {
  try {
    return JSON.stringify(sanitizeForProvider(JSON.parse(raw)));
  } catch {
    return sanitizeText(raw);
  }
}
