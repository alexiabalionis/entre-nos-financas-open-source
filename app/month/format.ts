// Helpers puros de formatação de data/dinheiro para a tela Mês. Sem domínio,
// sem React: strings/numbers apenas. Extraído de month-screen.tsx (Etapa 1).

/** 'YYYY-MM-DD' -> 'DD/MM'. */
export function ddmm(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** Rótulo do mês em pt-BR a partir de 'YYYY-MM' (capitalizado), sem lib de data. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Centavos (string) -> reais exatos (number), sem truncar. Só para animação/
 *  desenho (CountUp, gráfico) — o valor FINAL renderizado continua vindo de
 *  formatted() sobre os centavos exatos, nunca deste number. */
export function toReais(cents: string): number {
  return Number(BigInt(cents)) / 100;
}

/** Centavos (string) -> reais INTEIROS, truncando os centavos (divisão BigInt
 *  por 100n ANTES de virar number). Semântica DIFERENTE de toReais: só para
 *  peso visual de barra (proporção), nunca para valor exibido. NÃO unificar
 *  com toReais — trocar uma pela outra muda a proporção das barras em frações
 *  de real (ver brief da Etapa 1).
 */
export function toWholeReais(cents: string): number {
  return Number(BigInt(cents) / 100n);
}
