"use client";
import type { ReactNode } from "react";
import type { Currency } from "../../../src/domain/finance.ts";
import { formatted } from "../../../src/domain/format.ts";
import { CountUp } from "../../ds/count-up.tsx";
import { toReais } from "../format.ts";

// Número do herói/banner subindo de 0 até o valor (CountUp é number puro, sem
// domínio): convertemos os centavos-string pra reais só pra animar e voltamos
// a formatted() em cada quadro, que é quem sabe moeda/sinal. O valor FINAL
// renderizado continua vindo de formatted() sobre os centavos exatos — o
// number só passa pelos quadros intermediários da subida. Único lugar que
// define isto (hero-block.tsx e path-block.tsx importam daqui).
export function countUpMoney(cents: string, currency: Currency, hidden = false): ReactNode {
  if (hidden) return "••••";
  return (
    <CountUp
      value={toReais(cents)}
      format={(v) => formatted(BigInt(Math.round(v * 100)).toString(), currency)}
    />
  );
}
