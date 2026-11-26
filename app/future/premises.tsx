"use client";
import { Icon } from "../ds/index.ts";
import { Collapsible } from "../collapsible.tsx";
import { cx } from "../ds/shared.ts";
import { maskMoney } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";

/**
 * "Premissas desta projeção": o que a conta supõe (médias, saldo lido em data
 * antiga, compras ignoradas). Fica sempre na tela, por honestidade sobre o que
 * é estimativa. Não calcula nada.
 */
export function Premises() {
  const f = useFutureContext();
  const list = (f.draft ?? f.base)?.premises ?? [];
  return (
    <Collapsible
      className={cx("ds-reset", "fut-premises")}
      summary={
        <>
          <Icon name="info" size={16} />
          <span>Premissas desta projeção</span>
        </>
      }
    >
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {list.length === 0 ? <li>Nenhuma premissa adicional além do plano salvo.</li> : null}
        {list.map((p) => (
          <li key={p}>{maskMoney(p, f.hidden)}</li>
        ))}
      </ul>
    </Collapsible>
  );
}
