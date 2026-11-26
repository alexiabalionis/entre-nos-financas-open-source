"use client";
import { Button } from "../../ds/button";
import { money } from "../../lib/money.ts";
import { canConvert } from "./overview-form-model.ts";
import { OverviewItemRow } from "./overview-item-row";
import type { OverviewLegacy } from "./overview-types.ts";

/** Itens do jeito antigo, marcados como fixos mas que não se repetem sozinhos. */
export function OverviewLegacyList({
  legacy,
  hidden,
  onConvert,
}: {
  legacy: OverviewLegacy[];
  hidden: boolean;
  /** Sem a ação, a pessoa só acompanha. */
  onConvert: ((l: OverviewLegacy) => void) | null;
}) {
  return (
    <>
      {legacy.map((l) => (
        <OverviewItemRow
          key={l.item_id}
          title={l.label}
          sub={
            canConvert(l)
              ? "Veio da lista antiga · não se repete sozinho"
              : "Veio da lista antiga · defina um valor no Mês para transformar"
          }
          trail={money(l.planned_cents, "BRL", hidden)}
        >
          {onConvert && canConvert(l) && (
            <Button
              variant="quiet"
              size="sm"
              icon="refresh"
              onClick={() => onConvert(l)}
            >
              Transformar em conta fixa
            </Button>
          )}
        </OverviewItemRow>
      ))}
    </>
  );
}
