// Modo `npm run dev:mock`: a API multiplica todo valor em dinheiro por um
// único fator, só na resposta. O banco não é tocado. Um fator único mantém os
// totais batendo com as linhas, então a tela continua coerente para tirar
// prints sem mostrar os números reais.

const CENTS_KEY = /cents/i;
const PLAIN_MONEY_KEY =
  /^(amount|balance|total|available|limit|expected|planned|paid|actual|saldo|valor)$/i;
const WHOLE_NUMBER = /^-?\d+$/;

function factorFromEnv(): { num: bigint; den: bigint } | null {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env.FINANCE_MOCK_FACTOR;
  if (!raw) return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw);
  if (!match || Number(raw) <= 0)
    throw new Error("FINANCE_MOCK_FACTOR inválido. Use algo como 0.43");
  const decimals = match[2] ?? "";
  return {
    num: BigInt(match[1] + decimals),
    den: 10n ** BigInt(decimals.length),
  };
}

const factor = factorFromEnv();
// Chaves numéricas que NÃO foram escaladas, avisadas uma vez cada no terminal,
// para achar um campo de dinheiro que o filtro esqueceu.
const unscaledSeen = new Set<string>();

function reportUnscaled(key: string, value: unknown): void {
  const numeric =
    typeof value === "bigint" ||
    (typeof value === "string" && /^-?\d{3,}$/.test(value));
  if (!numeric || key === "" || unscaledSeen.has(key)) return;
  unscaledSeen.add(key);
  console.warn(`[dev:mock] "${key}" tem número e não foi alterado`);
}

const scale = (cents: bigint): bigint =>
  factor ? (cents * factor.num) / factor.den : cents;

/** Valor de `key` para a resposta da API: escalado só quando é dinheiro. */
export function mockMoney(key: string, value: unknown): unknown {
  if (!factor) return value;
  const isCentsKey = CENTS_KEY.test(key);
  if (!isCentsKey && !PLAIN_MONEY_KEY.test(key)) {
    reportUnscaled(key, value);
    return value;
  }
  if (typeof value === "bigint") return scale(value);
  if (typeof value === "string" && WHOLE_NUMBER.test(value))
    return scale(BigInt(value)).toString();
  // Número puro só em chave *_cents; "total"/"amount" numéricos podem ser contagem.
  if (isCentsKey && typeof value === "number" && Number.isInteger(value))
    return Number(scale(BigInt(value)));
  return value;
}
