import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardCompetence,
  type CompetenceInput,
  type CycleVersion,
} from "../src/domain/card-competence.ts";

const C1: CycleVersion = {
  closing_day: 13,
  due_day: 20,
  due_month_offset: 0,
  valid_from: "2026-01-01",
  valid_until: null,
};
const pick = (i: CompetenceInput) => {
  const r = cardCompetence(i);
  return { month: r.month, dueDate: r.dueDate, source: r.source };
};

test("compra no dia do fechamento e no dia seguinte caem em faturas diferentes", () => {
  assert.deepEqual(pick({ transactionDate: "2026-11-13", cycles: [C1] }), {
    month: "2026-11",
    dueDate: "2026-11-20",
    source: "cycle",
  });
  assert.deepEqual(pick({ transactionDate: "2026-11-14", cycles: [C1] }), {
    month: "2026-12",
    dueDate: "2026-12-20",
    source: "cycle",
  });
});

test("compra em um mês com fatura no mês seguinte, inclusive com offset", () => {
  assert.equal(
    cardCompetence({ transactionDate: "2026-10-25", cycles: [C1] }).month,
    "2026-11",
  );
  const offset: CycleVersion = {
    ...C1,
    closing_day: 25,
    due_day: 5,
    due_month_offset: 1,
  };
  assert.deepEqual(pick({ transactionDate: "2026-10-20", cycles: [offset] }), {
    month: "2026-11",
    dueDate: "2026-11-05",
    source: "cycle",
  });
});

test("pendente e aprovada têm a mesma competência", () => {
  const pending = cardCompetence({
    transactionDate: "2026-10-25",
    billDueDate: "2026-11-20",
    cycles: [C1],
  });
  const approved = cardCompetence({
    transactionDate: "2026-10-25",
    declaredDueDate: "2026-11-20",
    cycles: [C1],
  });
  assert.equal(pending.month, approved.month);
  assert.equal(pending.dueDate, approved.dueDate);
  assert.deepEqual(
    cardCompetence({ transactionDate: "2026-10-25", cycles: [C1] }),
    cardCompetence({ transactionDate: "2026-10-25", cycles: [C1] }),
  );
});

test("parcelas seguem a data da compra, não a data de lançamento", () => {
  const base = { purchaseDate: "2026-10-25", cycles: [C1] };
  const months = [1, 2, 3].map((number) =>
    pick({
      ...base,
      transactionDate: "2026-10-25",
      installment: { number, total: 3 },
    }),
  );
  assert.deepEqual(
    months.map((m) => [m.month, m.source]),
    [
      ["2026-11", "cycle"],
      ["2026-12", "installment_cycle"],
      ["2027-01", "installment_cycle"],
    ],
  );
  assert.equal(
    cardCompetence({
      ...base,
      transactionDate: "2026-11-25",
      installment: { number: 2, total: 3 },
    }).month,
    "2026-12",
  );
});

test("parcela sem data da compra só tem competência com fatura explícita", () => {
  const second = { number: 2, total: 3 };
  assert.equal(
    cardCompetence({
      transactionDate: "2026-11-25",
      installment: second,
      cycles: [C1],
    }).source,
    "unknown",
  );
  assert.deepEqual(
    pick({
      transactionDate: "2026-11-25",
      installment: second,
      billDueDate: "2026-12-20",
      cycles: [C1],
    }),
    { month: "2026-12", dueDate: "2026-12-20", source: "bill" },
  );
});

test("alteração de ciclo respeita a versão vigente e não retroage", () => {
  const v1: CycleVersion = {
    ...C1,
    valid_from: "2026-09-14",
    valid_until: "2026-11-13",
  };
  const v2: CycleVersion = {
    ...C1,
    closing_day: 5,
    due_day: 12,
    valid_from: "2026-11-14",
    valid_until: null,
  };
  const cycles = [v1, v2];
  assert.equal(
    cardCompetence({ transactionDate: "2026-11-10", cycles }).month,
    "2026-11",
  );
  assert.deepEqual(pick({ transactionDate: "2026-11-20", cycles }), {
    month: "2026-12",
    dueDate: "2026-12-12",
    source: "cycle",
  });
  assert.equal(
    cardCompetence({ transactionDate: "2026-09-01", cycles }).source,
    "unknown",
  );
});

test("parcela cuja fatura fecha depois da troca de ciclo fica incerta", () => {
  const v1: CycleVersion = {
    ...C1,
    valid_from: "2026-09-14",
    valid_until: "2026-11-13",
  };
  // Só a versão v1: a fatura da parcela 2/3 fecharia depois da troca, incerto.
  const r = cardCompetence({
    transactionDate: "2026-10-25",
    purchaseDate: "2026-10-25",
    installment: { number: 2, total: 3 },
    cycles: [v1],
  });
  assert.equal(r.source, "unknown");
  // Com v1 + v2, cada parcela segue a versão que governa a fatura do seu mês:
  // a 1ª fatura (compra) é pela v1 (2026-11), e as seguintes pela v2.
  const v2: CycleVersion = {
    ...C1,
    closing_day: 5,
    due_day: 12,
    valid_from: "2026-11-14",
    valid_until: null,
  };
  const installment = (number: number) =>
    cardCompetence({
      transactionDate: "2026-10-25",
      purchaseDate: "2026-10-25",
      installment: { number, total: 3 },
      cycles: [v1, v2],
    });
  assert.deepEqual(
    [installment(2).month, installment(2).dueDate, installment(2).source],
    ["2026-12", "2026-12-12", "installment_cycle"],
  );
  assert.deepEqual(
    [installment(3).month, installment(3).dueDate, installment(3).source],
    ["2027-01", "2027-01-12", "installment_cycle"],
  );
});

test("fatura explícita vence a inferência e registra o conflito", () => {
  const r = cardCompetence({
    transactionDate: "2026-11-10",
    billDueDate: "2026-12-20",
    cycles: [C1],
  });
  assert.equal(r.month, "2026-12");
  assert.equal(r.source, "bill");
  assert.deepEqual(r.conflict, { cycleMonth: "2026-11" });
  assert.equal(
    cardCompetence({
      transactionDate: "2026-11-10",
      billDueDate: "2026-11-20",
      cycles: [C1],
    }).conflict,
    null,
  );
});

test("compra manual usa o ciclo vigente", () => {
  assert.deepEqual(pick({ transactionDate: "2026-11-02", cycles: [C1] }), {
    month: "2026-11",
    dueDate: "2026-11-20",
    source: "cycle",
  });
});

test("primeira fatura de uma versão nova (transição de ciclo)", () => {
  const old: CycleVersion = {
    ...C1,
    valid_from: "2026-10-01",
    valid_until: "2026-11-13",
  };
  const next: CycleVersion = {
    closing_day: 15,
    due_day: 22,
    due_month_offset: 0,
    valid_from: "2026-11-14",
    valid_until: null,
    first_due_month: "2026-12",
  };
  const at = (transactionDate: string) =>
    pick({ transactionDate, cycles: [old, next] });
  assert.deepEqual(at("2026-11-13"), {
    month: "2026-11",
    dueDate: "2026-11-20",
    source: "cycle",
  });
  assert.deepEqual(at("2026-11-14"), {
    month: "2026-12",
    dueDate: "2026-12-22",
    source: "cycle",
  });
  assert.equal(at("2026-12-15").month, "2026-12");
  assert.deepEqual(at("2026-12-16"), {
    month: "2027-01",
    dueDate: "2027-01-22",
    source: "cycle",
  });
  assert.equal(
    cardCompetence({
      transactionDate: "2026-11-20",
      purchaseDate: "2026-11-20",
      installment: { number: 2, total: 3 },
      cycles: [old, next],
    }).month,
    "2027-01",
  );
});

test("dados insuficientes ou inválidos", () => {
  const none = cardCompetence({ transactionDate: "2026-11-10", cycles: [] });
  assert.equal(none.source, "unknown");
  assert.equal(none.month, null);
  assert.equal(none.dueDate, null);
  for (const installment of [
    { number: 4, total: 3 },
    { number: 1.5, total: 3 },
  ])
    assert.equal(
      cardCompetence({
        transactionDate: "2026-11-10",
        installment,
        cycles: [C1],
      }).source,
      "unknown",
    );
  assert.throws(() =>
    cardCompetence({ transactionDate: "2026-13-01", cycles: [C1] }),
  );
});

test("ciclo 28/30 em fevereiro: o vencimento cortado vira o dia seguinte ao fechamento", () => {
  // closing 28 / due 30: em fevereiro não bissexto os dois dias caem em 28/02;
  // antes a fatura sumia. Agora o vencimento vira 01/03 (fechamento + 1 dia) e
  // a fatura cobre as compras de 29/01 a 28/02.
  const rule: CycleVersion = { ...C1, closing_day: 28, due_day: 30 };
  assert.deepEqual(pick({ transactionDate: "2026-02-10", cycles: [rule] }), {
    month: "2026-02",
    dueDate: "2026-03-01",
    source: "cycle",
  });
  assert.deepEqual(pick({ transactionDate: "2026-01-29", cycles: [rule] }), {
    month: "2026-02",
    dueDate: "2026-03-01",
    source: "cycle",
  });
  // Mês normal: fecha 28, vence 30 (sem corte), fatura inalterada.
  assert.deepEqual(pick({ transactionDate: "2026-03-01", cycles: [rule] }), {
    month: "2026-03",
    dueDate: "2026-03-30",
    source: "cycle",
  });
  // Bissexto: 28/02 e 29/02 existem, due > close, nada muda.
  assert.deepEqual(pick({ transactionDate: "2028-02-10", cycles: [rule] }), {
    month: "2028-02",
    dueDate: "2028-02-29",
    source: "cycle",
  });
});

test("não altera a entrada nem a data original", () => {
  const input: CompetenceInput = {
    transactionDate: "2026-10-25",
    purchaseDate: "2026-10-20",
    installment: Object.freeze({ number: 2, total: 3 }),
    cycles: Object.freeze([Object.freeze({ ...C1 })]),
  };
  Object.freeze(input);
  const before = structuredClone(input);
  cardCompetence(input);
  assert.deepEqual(input, before);
  assert.equal(input.transactionDate, "2026-10-25");
});

test("parcela de compra anterior ao primeiro ciclo conhecido cai pela data da cobrança", () => {
  // Seguro em 12x comprado em 09/06, ciclo (fecha 16, vence 26) só conhecido
  // desde 17/10: o banco lista cada parcela no dia 16 de cada mês.
  const late: CycleVersion = { ...C1, closing_day: 16, due_day: 26, due_month_offset: 0, valid_from: "2026-10-17", valid_until: null, first_due_month: "2026-11" };
  const at = (date: string, k: number) =>
    cardCompetence({ transactionDate: date, purchaseDate: "2026-06-09", installment: { number: k, total: 12 }, cycles: [late] });
  assert.equal(at("2026-11-16", 6).month, "2026-11");
  assert.equal(at("2027-05-16", 12).month, "2027-05");
  assert.equal(at("2027-05-16", 12).source, "installment_cycle");
  // Sem data de cobrança diferente da compra, continua sem competência.
  assert.equal(at("2026-06-09", 6).month, null);
});
