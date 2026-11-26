// F1a do Copiloto (leituras): helpers compartilhados pelos leitores por família
// (projection-reads-cash / -bills / -plan). Toda leitura é por família (RLS
// cuida do escopo); nada aqui registra lançamento. Sem barrel: cada módulo é
// importado direto pelo coletor (projection.ts).

// Mês seguinte a YYYY-MM.
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

// Regra EFETIVA e ÚNICA de inclusão de uma conta no caixa conservador (sConf).
// include_in_cash é a decisão explícita do usuário: null = seguir o padrão
// (conta corrente em BRL entra), true/false = incluir/excluir à mão. A regra
// mora SÓ aqui; todo leitor que precisa "esta conta entra no caixa?" referencia
// este fragmento com o alias da tabela accounts, nunca reescreve a condição.
// Assim uma conta criada depois da migration 023 também segue o padrão (não
// fica fora do caixa por acidente de default).
export function includedInCashSql(alias: string): string {
  return `coalesce(${alias}.include_in_cash, ${alias}.kind='checking' AND ${alias}.currency='BRL')`;
}
