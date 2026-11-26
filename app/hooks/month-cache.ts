/**
 * Cache de UM slot para os dados do mês (family/month + family/projection).
 * Existe para que trocar de página (Mês <-> Movimentos) reaproveite o que já
 * foi carregado, como acontecia quando o estado vivia em family.tsx.
 *
 * Regras de segurança (cada uma coberta em tests-js/month-cache.test.ts):
 * - Isolamento por pessoa: o slot guarda o dono (e-mail) e só devolve dados
 *   para o mesmo dono. Não depende de nenhum componente desmontar.
 * - Chave: mês + moeda. Outra chave nunca reaproveita o slot.
 * - Concorrência: cada busca recebe um ticket crescente na largada; só grava
 *   quem tem ticket maior que o do slot e maior que o da última limpeza. Uma
 *   resposta velha, ou que chegou depois de um logout, é descartada.
 * - Invalidação determinística: `clear()` (troca de pessoa/logout) esvazia e
 *   invalida buscas em voo; `markStale()` mantém os dados, mas manda a próxima
 *   montagem rebuscar.
 */
export type MonthSnapshot<T, P> = {
  data: T;
  projection: P | null;
  stale: boolean;
};

type Slot<T, P> = {
  owner: string;
  month: string;
  currency: string;
  data: T;
  projection: P | null;
  stale: boolean;
  ticket: number;
};

export function createMonthCache<T, P>() {
  let slot: Slot<T, P> | null = null;
  let issued = 0;
  let clearedAt = 0;
  return {
    /** Abre uma busca: o ticket decide, na volta, se ela ainda pode gravar. */
    begin(): number {
      return ++issued;
    },
    read(
      owner: string,
      month: string,
      currency: string,
    ): MonthSnapshot<T, P> | null {
      if (
        !slot ||
        slot.owner !== owner ||
        slot.month !== month ||
        slot.currency !== currency
      )
        return null;
      return {
        data: slot.data,
        projection: slot.projection,
        stale: slot.stale,
      };
    },
    /** Grava se este ticket for o mais novo visto. Devolve se gravou. */
    commit(
      ticket: number,
      owner: string,
      month: string,
      currency: string,
      data: T,
      projection: P | null,
    ): boolean {
      if (ticket <= clearedAt || (slot && ticket <= slot.ticket)) return false;
      slot = {
        owner,
        month,
        currency,
        data,
        projection,
        stale: false,
        ticket,
      };
      return true;
    },
    markStale(): void {
      if (slot) slot.stale = true;
    },
    clear(): void {
      slot = null;
      clearedAt = issued;
    },
  };
}
