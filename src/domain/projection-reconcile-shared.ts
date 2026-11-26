import type { Day, Flow } from "./projection.ts";

// Tipos e construtores de fluxo compartilhados pelas regras de conciliação
// (itens, faturas e caixa). A qualidade e a explicação de cada fluxo carregam a
// confiança da conciliação para a UI do Copiloto.

export type Quality =
  | "confirmed"
  | "scheduled"
  | "planned"
  | "structural"
  | "estimated"
  | "inconsistent";

export type ReconciledFlow = Flow & {
  quality: Quality;
  sources: string[];
  explain: string;
};

export const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

// Pousa a data mais tarde entre `date` e `today` (vencido cai em hoje).
export const laterDay = (date: Day, today: Day): Day =>
  date > today ? date : today;

export function outFlow(
  key: string,
  nomDate: Day,
  nomCents: bigint,
  consDate: Day,
  consCents: bigint,
  quality: Quality,
  sources: string[],
  explain: string,
  initiated?: boolean,
): ReconciledFlow {
  const flow: ReconciledFlow = {
    key,
    direction: "out",
    nom: { date: nomDate, cents: nomCents },
    cons: { date: consDate, cents: consCents },
    quality,
    sources,
    explain,
  };
  if (initiated) flow.initiated = true;
  return flow;
}

export function inFlow(
  key: string,
  nomDate: Day,
  nomCents: bigint,
  consDate: Day,
  consCents: bigint,
  quality: Quality,
  sources: string[],
  explain: string,
): ReconciledFlow {
  return {
    key,
    direction: "in",
    nom: { date: nomDate, cents: nomCents },
    cons: { date: consDate, cents: consCents },
    quality,
    sources,
    explain,
  };
}
