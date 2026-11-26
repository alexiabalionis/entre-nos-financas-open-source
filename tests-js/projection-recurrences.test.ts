import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyCandidates, type Spend } from "../src/domain/projection-recurrences.ts";

// 4a: detectRecurrences saiu da projeção (e do código); sobra monthlyCandidates,
// que só alimenta sugestões. currentMonth = 2026-11, janela = ago/set/out.
function spend(month: string, over: Partial<Spend> = {}): Spend {
  return { scope: "cash", merchant: "ACADEMIA", month, day: 5, cents: 9900n, ...over };
}

test("contas que se repetem: uma por mês e valor parecido; mercado e valor solto não entram", () => {
  const car = (month: string, cents = 140000n) =>
    spend(month, { merchant: "CARRO", day: 4, cents });
  const market = (month: string, day: number) =>
    spend(month, { merchant: "MERCADO", day, cents: 30000n });
  const out = monthlyCandidates(
    [
      car("2026-08"),
      car("2026-09", 141000n),
      car("2026-10"),
      // Kiro só em 2 dos 3 meses, no cartão: entra.
      spend("2026-09", { scope: "card-1", merchant: "KIRO", day: 12, cents: 100000n }),
      spend("2026-10", { scope: "card-1", merchant: "KIRO", day: 12, cents: 100000n }),
      // Várias compras por mês: não é conta.
      market("2026-08", 3),
      market("2026-08", 20),
      market("2026-09", 5),
      market("2026-09", 25),
      // Valor muito diferente entre meses: não é conta.
      spend("2026-09", { merchant: "LOJA", cents: 10000n }),
      spend("2026-10", { merchant: "LOJA", cents: 90000n }),
    ],
    "2026-11",
  );
  assert.deepEqual(
    out.map((c) => [c.scope, c.merchant, c.nom, c.day, c.months]),
    [
      ["cash", "CARRO", 140000n, 4, 3],
      ["card-1", "KIRO", 100000n, 12, 2],
    ],
  );
});

test("4a: com 2 meses, nom é a média inteira truncada; o dia mais frequente vence e o empate vai ao menor", () => {
  const two = monthlyCandidates(
    [spend("2026-09", { cents: 9000n, day: 8 }), spend("2026-10", { cents: 10001n, day: 2 })],
    "2026-11",
  );
  assert.deepEqual(
    two.map((c) => [c.nom, c.day]),
    [[9500n, 2]],
  );
  const three = monthlyCandidates(
    [
      spend("2026-08", { day: 10 }),
      spend("2026-09", { day: 3 }),
      spend("2026-10", { day: 3 }),
    ],
    "2026-11",
  );
  assert.equal(three[0].day, 3);
});
