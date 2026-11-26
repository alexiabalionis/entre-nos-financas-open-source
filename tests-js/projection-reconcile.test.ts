import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcile,
  type ReconcileInput,
  type ReconciledFlow,
  type ItemInput,
  type BillInput,
  type ScheduledInput,
  type ReceiptInput,
} from "../src/domain/projection-reconcile.ts";
import { project, type ProjectionInput } from "../src/domain/projection.ts";

const BASE: Omit<ReconcileInput, "items" | "bills" | "scheduled" | "receipts"> =
  {
    today: "2026-11-09",
    snapshotDate: "2026-11-09",
  };

function makeItem(over: Partial<ItemInput> & { id: string }): ItemInput {
  return {
    purpose: "expense",
    planned: null,
    paid: null,
    status: "open",
    due: null,
    paidDate: null,
    derived: false,
    eventCovered: null,
    bankCovered: false,
    ...over,
  };
}
function makeBill(over: Partial<BillInput> & { card: string }): BillInput {
  return {
    dueMonth: "2026-11",
    due: "2026-11-20",
    bankTotal: null,
    bankClosed: false,
    needsReview: false,
    manual: null,
    estimate: 0n,
    payments: [],
    ...over,
  };
}
function makeSched(
  over: Partial<ScheduledInput> & { id: string },
): ScheduledInput {
  return { cents: 0n, date: "2026-11-15", coverage: "unknown", ...over };
}
function makeReceipt(
  over: Partial<ReceiptInput> & { id: string },
): ReceiptInput {
  return {
    cents: 0n,
    expected: "2026-11-15",
    windowEnd: null,
    detected: false,
    ...over,
  };
}
function run(over: Partial<ReconcileInput>): ReconciledFlow[] {
  return reconcile({
    ...BASE,
    items: [],
    bills: [],
    scheduled: [],
    receipts: [],
    ...over,
  });
}
function byKey(flows: ReconciledFlow[]): Map<string, ReconciledFlow> {
  return new Map(flows.map((f) => [f.key, f]));
}

test("item pago e coberto some; derived ignorado", () => {
  const flows = run({
    items: [
      makeItem({
        id: "a",
        purpose: "expense",
        planned: 5000n,
        paid: 5000n,
        status: "done",
        eventCovered: true,
      }),
      makeItem({
        id: "b",
        purpose: "expense",
        planned: 9000n,
        due: "2026-11-20",
        derived: true,
      }),
    ],
  });
  assert.equal(flows.length, 0);
});

test("item done sem evento com paidDate=snapshotDate continua saindo em today", () => {
  // paidDate não < snapshotDate e sem evento => pagamento ainda não refletido.
  const flows = run({
    items: [
      makeItem({
        id: "a",
        purpose: "expense",
        planned: 5000n,
        paid: 5000n,
        status: "done",
        paidDate: "2026-11-09",
        eventCovered: null,
      }),
    ],
  });
  const f = byKey(flows).get("item:a:paid");
  assert.ok(f, "fluxo do pagamento não refletido");
  assert.equal(f.direction, "out");
  assert.equal(f.nom.date, "2026-11-09");
  assert.equal(f.nom.cents, 5000n);
  assert.equal(f.cons.cents, 5000n);
  // status done => sem restante.
  assert.equal(byKey(flows).get("item:a"), undefined);
});

test("item pago refletido (paidDate < snapshot) e restante a pagar no vencimento", () => {
  const flows = run({
    snapshotDate: "2026-11-09",
    items: [
      makeItem({
        id: "a",
        purpose: "expense",
        planned: 10000n,
        paid: 4000n,
        status: "partial",
        paidDate: "2026-11-05",
        due: "2026-11-20",
      }),
    ],
  });
  // pago já refletido => não gera fluxo de :paid.
  assert.equal(byKey(flows).get("item:a:paid"), undefined);
  const f = byKey(flows).get("item:a");
  assert.ok(f);
  assert.equal(f.nom.date, "2026-11-20");
  assert.equal(f.nom.cents, 6000n);
  assert.equal(f.quality, "planned");
});

test("item sem due => estimated em today; planned null não-done não gera fluxo", () => {
  const flows = run({
    items: [
      makeItem({ id: "a", purpose: "expense", planned: 3000n, due: null }),
      makeItem({ id: "b", purpose: "expense", planned: null, status: "open" }),
    ],
  });
  const f = byKey(flows).get("item:a");
  assert.ok(f);
  assert.equal(f.nom.date, "2026-11-09");
  assert.equal(f.quality, "estimated");
  assert.equal(byKey(flows).get("item:b"), undefined);
  assert.equal(flows.length, 1);
});

test("item card 1150 + fatura aberta do banco 1090 no mesmo mês => bill 1090 e cardplan 60", () => {
  const flows = run({
    items: [
      makeItem({
        id: "compra",
        purpose: "card",
        planned: 1150n,
        due: "2026-11-20",
      }),
    ],
    bills: [
      makeBill({
        card: "nubank",
        dueMonth: "2026-11",
        due: "2026-11-20",
        bankTotal: 1090n,
        bankClosed: false,
      }),
    ],
  });
  const bill = byKey(flows).get("bill:nubank:2026-11");
  assert.ok(bill);
  assert.equal(bill.nom.cents, 1090n);
  assert.equal(bill.cons.cents, 1090n);
  const plan = byKey(flows).get("cardplan:2026-11");
  assert.ok(plan);
  assert.equal(plan.nom.cents, 0n);
  assert.equal(plan.cons.cents, 60n);
  assert.equal(plan.quality, "inconsistent");
  // Não existe fluxo próprio do item card.
  assert.equal(byKey(flows).get("item:compra"), undefined);
  // total cons out = 1090 + 60 = 1150, não 1150 + 1090.
  const totalCons = flows.reduce((s, f) => s + f.cons.cents, 0n);
  assert.equal(totalCons, 1150n);
});

test("card items abaixo do total das faturas => sem cardplan", () => {
  const flows = run({
    items: [
      makeItem({ id: "c", purpose: "card", planned: 500n, due: "2026-11-20" }),
    ],
    bills: [
      makeBill({
        card: "nubank",
        dueMonth: "2026-11",
        due: "2026-11-20",
        bankTotal: 1090n,
        bankClosed: false,
      }),
    ],
  });
  assert.equal(byKey(flows).get("cardplan:2026-11"), undefined);
});

test("fatura fechada 115000 com covered 40000 e agendado 30000 => 30000 em 11-18 e 45000 em 11-20", () => {
  const input: ReconcileInput = {
    today: "2026-11-09",
    snapshotDate: "2026-11-09",
    items: [],
    bills: [
      makeBill({
        card: "nubank",
        dueMonth: "2026-11",
        due: "2026-11-20",
        bankTotal: 115000n,
        bankClosed: true,
        payments: [
          { id: "p1", cents: 40000n, date: "2026-11-02", covered: true },
          { id: "p2", cents: 30000n, date: "2026-11-18", covered: false },
        ],
      }),
    ],
    scheduled: [],
    receipts: [],
  };
  const flows = reconcile(input);
  const sched = byKey(flows).get("bill:nubank:2026-11:sched:p2");
  assert.ok(sched);
  assert.equal(sched.nom.date, "2026-11-18");
  assert.equal(sched.nom.cents, 30000n);
  assert.equal(sched.cons.cents, 30000n);
  assert.equal(sched.initiated, true);
  const rest = byKey(flows).get("bill:nubank:2026-11");
  assert.ok(rest);
  assert.equal(rest.nom.date, "2026-11-20");
  assert.equal(rest.nom.cents, 45000n);
  assert.equal(rest.cons.cents, 45000n);
  assert.equal(rest.quality, "confirmed");

  const totalOut = flows.reduce((s, f) => s + f.cons.cents, 0n);
  assert.equal(totalOut, 75000n);

  // Com project() o saldo final cai exatamente 75000.
  const proj: ProjectionInput = {
    today: "2026-11-09",
    horizonEnd: "2026-11-30",
    sConf: 200000n,
    cushion: 0n,
    flows,
  };
  const r = project(proj);
  assert.equal(r.series.at(-1)?.cons, 200000n - 75000n);
});

test("dois pagamentos covered mesmos valor e data com ids diferentes contam os dois", () => {
  const flows = run({
    bills: [
      makeBill({
        card: "nubank",
        dueMonth: "2026-11",
        due: "2026-11-20",
        bankTotal: 100000n,
        bankClosed: true,
        payments: [
          { id: "p1", cents: 20000n, date: "2026-11-02", covered: true },
          { id: "p2", cents: 20000n, date: "2026-11-02", covered: true },
        ],
      }),
    ],
  });
  const rest = byKey(flows).get("bill:nubank:2026-11");
  assert.ok(rest);
  // 100000 - 20000 - 20000 = 60000.
  assert.equal(rest.cons.cents, 60000n);
});

test("dois agendados não-covered mesmos valor e data com ids diferentes geram dois fluxos", () => {
  const flows = run({
    bills: [
      makeBill({
        card: "nubank",
        dueMonth: "2026-11",
        due: "2026-11-25",
        bankTotal: 100000n,
        bankClosed: true,
        payments: [
          { id: "p1", cents: 20000n, date: "2026-11-18", covered: false },
          { id: "p2", cents: 20000n, date: "2026-11-18", covered: false },
        ],
      }),
    ],
  });
  assert.ok(byKey(flows).get("bill:nubank:2026-11:sched:p1"));
  assert.ok(byKey(flows).get("bill:nubank:2026-11:sched:p2"));
  const totalOut = flows.reduce((s, f) => s + f.cons.cents, 0n);
  assert.equal(totalOut, 100000n);
});

test("manual paid => sem fluxo; só manual => nom manual, cons max com estimate", () => {
  const paid = run({
    bills: [
      makeBill({
        card: "x",
        manual: { amount: 50000n, paid: true },
        estimate: 10000n,
      }),
    ],
  });
  assert.equal(paid.length, 0);

  const onlyManual = run({
    bills: [
      makeBill({
        card: "y",
        dueMonth: "2026-11",
        due: "2026-11-20",
        manual: { amount: 50000n, paid: false },
        estimate: 80000n,
      }),
    ],
  });
  const f = byKey(onlyManual).get("bill:y:2026-11");
  assert.ok(f);
  assert.equal(f.nom.cents, 50000n);
  assert.equal(f.cons.cents, 80000n);
  assert.equal(f.quality, "planned");
});

test("fatura needsReview sem total => nom estimate, cons max com manual, inconsistent", () => {
  const flows = run({
    bills: [
      makeBill({
        card: "z",
        dueMonth: "2026-11",
        due: "2026-11-20",
        needsReview: true,
        bankTotal: null,
        manual: { amount: 90000n, paid: false },
        estimate: 70000n,
      }),
    ],
  });
  const f = byKey(flows).get("bill:z:2026-11");
  assert.ok(f);
  assert.equal(f.nom.cents, 70000n);
  assert.equal(f.cons.cents, 90000n);
  assert.equal(f.quality, "inconsistent");
});

test("fatura só com estimate => nom=cons=estimate, estimated", () => {
  const flows = run({
    bills: [
      makeBill({
        card: "w",
        dueMonth: "2026-11",
        due: "2026-11-20",
        estimate: 42000n,
      }),
    ],
  });
  const f = byKey(flows).get("bill:w:2026-11");
  assert.ok(f);
  assert.equal(f.nom.cents, 42000n);
  assert.equal(f.cons.cents, 42000n);
  assert.equal(f.quality, "estimated");
});

test("scheduled not_covered => initiated na data; covered => nada", () => {
  const flows = run({
    scheduled: [
      makeSched({
        id: "a",
        cents: 5000n,
        date: "2026-11-15",
        coverage: "not_covered",
      }),
      makeSched({
        id: "b",
        cents: 9000n,
        date: "2026-11-15",
        coverage: "covered",
      }),
    ],
  });
  const f = byKey(flows).get("sched:a");
  assert.ok(f);
  assert.equal(f.nom.date, "2026-11-15");
  assert.equal(f.nom.cents, 5000n);
  assert.equal(f.cons.cents, 5000n);
  assert.equal(f.initiated, true);
  assert.equal(f.quality, "scheduled");
  assert.equal(byKey(flows).get("sched:b"), undefined);
});

test("PIX unknown: D (project) reduz e nom não", () => {
  const flows = run({
    scheduled: [
      makeSched({
        id: "pix",
        cents: 7000n,
        date: "2026-11-15",
        coverage: "unknown",
      }),
    ],
  });
  const f = byKey(flows).get("sched:pix");
  assert.ok(f);
  assert.equal(f.nom.date, "2026-11-15");
  assert.equal(f.nom.cents, 0n);
  assert.equal(f.cons.date, "2026-11-09");
  assert.equal(f.cons.cents, 7000n);
  assert.equal(f.initiated, true);
  assert.equal(f.quality, "inconsistent");

  const r = project({
    today: "2026-11-09",
    horizonEnd: "2026-11-30",
    sConf: 100000n,
    cushion: 0n,
    flows,
  });
  // cons em today reduz; nom não (0 cents no nom).
  assert.equal(r.D, 100000n - 7000n);
  assert.equal(r.series[0].nom, 100000n);
  assert.equal(r.series[0].cons, 100000n - 7000n);
});

test("salário atrasado => nom today com valor, cons 0, inconsistent", () => {
  const flows = run({
    receipts: [
      makeReceipt({
        id: "sal",
        cents: 620000n,
        expected: "2026-11-05",
        detected: false,
      }),
    ],
  });
  const f = byKey(flows).get("inc:sal");
  assert.ok(f);
  assert.equal(f.direction, "in");
  assert.equal(f.nom.date, "2026-11-09");
  assert.equal(f.nom.cents, 620000n);
  assert.equal(f.cons.date, "2026-11-09");
  assert.equal(f.cons.cents, 0n);
  assert.equal(f.quality, "inconsistent");
});

test("recebimento previsto no futuro usa windowEnd no cons; detected some", () => {
  const flows = run({
    receipts: [
      makeReceipt({
        id: "sal",
        cents: 620000n,
        expected: "2026-11-15",
        windowEnd: "2026-11-18",
        detected: false,
      }),
      makeReceipt({
        id: "det",
        cents: 100n,
        expected: "2026-11-15",
        detected: true,
      }),
    ],
  });
  const f = byKey(flows).get("inc:sal");
  assert.ok(f);
  assert.equal(f.nom.date, "2026-11-15");
  assert.equal(f.cons.date, "2026-11-18");
  assert.equal(f.cons.cents, 620000n);
  assert.equal(f.quality, "scheduled");
  assert.equal(byKey(flows).get("inc:det"), undefined);
});

test("resultado determinístico: inputs embaralhados dão o mesmo resultado e não mutam o input", () => {
  const items = [
    makeItem({
      id: "a",
      purpose: "expense",
      planned: 3000n,
      due: "2026-11-20",
    }),
    makeItem({
      id: "b",
      purpose: "expense",
      planned: 2000n,
      due: "2026-11-15",
    }),
  ];
  const bills = [
    makeBill({
      card: "m",
      dueMonth: "2026-11",
      due: "2026-11-20",
      estimate: 1000n,
    }),
    makeBill({
      card: "n",
      dueMonth: "2026-11",
      due: "2026-11-22",
      estimate: 2000n,
    }),
  ];
  const scheduled = [
    makeSched({
      id: "s1",
      cents: 100n,
      date: "2026-11-12",
      coverage: "not_covered",
    }),
    makeSched({
      id: "s2",
      cents: 200n,
      date: "2026-11-13",
      coverage: "unknown",
    }),
  ];
  const receipts = [
    makeReceipt({ id: "r1", cents: 5000n, expected: "2026-11-25" }),
    makeReceipt({ id: "r2", cents: 6000n, expected: "2026-11-26" }),
  ];
  const original = JSON.stringify(
    { items, bills, scheduled, receipts },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
  const a = run({ items, bills, scheduled, receipts });
  const b = run({
    items: [...items].reverse(),
    bills: [...bills].reverse(),
    scheduled: [...scheduled].reverse(),
    receipts: [...receipts].reverse(),
  });
  assert.deepEqual(b, a);
  // input não mutado.
  const after = JSON.stringify(
    { items, bills, scheduled, receipts },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  );
  assert.equal(after, original);
  // ordenado por key.
  const keys = a.map((f) => f.key);
  assert.deepEqual(keys, [...keys].sort());
});

test("débito automático agendado da fatura não conta duas vezes", () => {
  const flows = byKey(
    run({
      bills: [makeBill({ card: "c1", due: "2026-11-26", bankTotal: 1183683n, bankClosed: true })],
      scheduled: [
        makeSched({ id: "deb", cents: 1183683n, date: "2026-11-26", coverage: "not_covered" }),
        makeSched({ id: "outro", cents: 40000n, date: "2026-11-26", coverage: "not_covered" }),
      ],
    }),
  );
  assert.equal(flows.get("bill:c1:2026-11")?.cons.cents, 1183683n);
  assert.equal(flows.has("sched:deb"), false);
  assert.equal(flows.get("sched:outro")?.cons.cents, 40000n);
});

test("agendamento com valor da fatura mas longe do vencimento continua saindo", () => {
  const flows = byKey(
    run({
      bills: [makeBill({ card: "c1", due: "2026-11-26", bankTotal: 50000n, bankClosed: true })],
      scheduled: [makeSched({ id: "pix", cents: 50000n, date: "2026-11-15", coverage: "not_covered" })],
    }),
  );
  assert.equal(flows.has("sched:pix"), true);
  assert.equal(flows.has("bill:c1:2026-11"), true);
});

test("conta fixa coberta por linha do banco não sai de novo", () => {
  const flows = byKey(
    run({
      items: [
        makeItem({ id: "pix", planned: 16330n, due: "2026-12-01", bankCovered: true }),
        makeItem({ id: "faxina", planned: 23000n, due: "2026-11-27" }),
      ],
      scheduled: [makeSched({ id: "agendado", cents: 16330n, date: "2026-12-01", coverage: "not_covered" })],
    }),
  );
  assert.equal(flows.has("item:pix"), false);
  assert.equal(flows.get("sched:agendado")?.cons.cents, 16330n);
  assert.equal(flows.get("item:faxina")?.cons.cents, 23000n);
});
