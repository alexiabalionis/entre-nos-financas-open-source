// Regra única de "o banco já confirmou": um movimento POSTED, ou qualquer um
// com data anterior a hoje (BRT). Um Pix de ontem já saiu da conta, mesmo que
// o provedor continue mandando PENDING. Só o que tem data de hoje em diante e
// ainda vem PENDING é agendado/aguardando. A mesma regra em TS e em SQL.

const TODAY_SQL = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

/** Hoje em BRT (YYYY-MM-DD), o mesmo dia do TODAY_SQL. */
export function settledToday(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

/** Status efetivo: PENDING com data passada vira POSTED. */
export function effectiveProviderStatus(
  status: string,
  date: string,
  today: string,
): string {
  return status !== "POSTED" && date < today ? "POSTED" : status;
}

/** SQL: o movimento `a` conta como confirmado pelo banco. */
export function settledSql(a: string): string {
  return `(${a}.provider_status='POSTED' OR ${a}.transaction_date<${TODAY_SQL})`;
}

/** SQL: o movimento `a` ainda é agendado (PENDING de hoje em diante). `today`: expressão SQL do dia de referência (a projeção passa o seu). */
export function scheduledSql(a: string, today: string = TODAY_SQL): string {
  return `(${a}.provider_status='PENDING' AND ${a}.transaction_date>=${today})`;
}

/** SQL: status efetivo de `a`, para listas que mostram o status. */
export function effectiveStatusSql(a: string): string {
  return `CASE WHEN ${settledSql(a)} THEN 'POSTED' ELSE ${a}.provider_status END`;
}
