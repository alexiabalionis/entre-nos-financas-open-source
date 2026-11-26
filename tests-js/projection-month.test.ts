import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_WORD,
  deficitWithin,
  lowWithin,
  monthBounds,
  monthMode,
  sliceToMonth,
  startCentsAt,
} from "../src/domain/projection-month.ts";
import type { DayPoint } from "../src/domain/projection.ts";

const pt = (day: string, nom: bigint, cons: bigint): DayPoint => ({
  day,
  nom,
  cons,
});

test("monthMode: modos nas bordas e virada dez->jan", () => {
  assert.equal(monthMode("2026-11-09", "2026-11"), "current");
  assert.equal(monthMode("2026-11-30", "2026-11"), "current");
  assert.equal(monthMode("2026-11-09", "2026-12"), "future");
  assert.equal(monthMode("2026-11-09", "2027-01"), "unavailable");
  assert.equal(monthMode("2026-11-09", "2026-10"), "closed");
  assert.equal(monthMode("2026-11-09", "2025-12"), "closed");
  // Virada de ano: em dezembro o mês seguinte é janeiro.
  assert.equal(monthMode("2026-12-31", "2027-01"), "future");
  assert.equal(monthMode("2026-12-31", "2027-02"), "unavailable");
  assert.equal(monthMode("2027-01-01", "2026-12"), "closed");
});

test("monthMode/monthBounds rejeitam mês inválido", () => {
  assert.throws(() => monthMode("2026-11-09", "2026-13"));
  assert.throws(() => monthBounds("2026-00"));
  assert.throws(() => monthBounds("2026-1"));
});

test("monthBounds: fev bissexto, dezembro e meses de 30/31 dias", () => {
  assert.deepEqual(monthBounds("2028-02"), {
    start: "2028-02-01",
    end: "2028-02-29",
  });
  assert.deepEqual(monthBounds("2026-02"), {
    start: "2026-02-01",
    end: "2026-02-28",
  });
  assert.deepEqual(monthBounds("2026-12"), {
    start: "2026-12-01",
    end: "2026-12-31",
  });
  assert.deepEqual(monthBounds("2026-11"), {
    start: "2026-11-01",
    end: "2026-11-30",
  });
});

test("STATUS_WORD: palavras do estado e dos modos", () => {
  assert.equal(STATUS_WORD.CONFIRMADO, "Confiável");
  assert.equal(STATUS_WORD.COM_RESSALVA, "Com ressalva");
  assert.equal(STATUS_WORD.DEPENDE_DE_DADOS, "Faltam dados");
  assert.equal(STATUS_WORD.SEM_FOLGA, "Sem folga");
  assert.equal(STATUS_WORD.INDETERMINADO, "Indeterminado");
  assert.equal(STATUS_WORD.future, "Estimativa");
  assert.equal(STATUS_WORD.closed, "Realizado");
  assert.equal(STATUS_WORD.unavailable, "Sem projeção");
});

test("startCentsAt carrega adiante o último ponto da série comprimida", () => {
  const series = [
    pt("2026-11-09", 100n, 90n),
    pt("2026-11-20", 500n, 450n),
    pt("2026-12-05", 300n, 250n),
  ];
  assert.equal(startCentsAt(series, "2026-12-01"), 450n);
  assert.equal(startCentsAt(series, "2026-12-05"), 250n);
  assert.equal(startCentsAt(series, "2026-11-09"), 90n);
  assert.equal(startCentsAt(series, "2026-11-08"), null);
  assert.equal(startCentsAt([], "2026-12-01"), null);
});

test("sliceToMonth mantém só os dias do mês", () => {
  const series = [
    pt("2026-11-30", 1n, 1n),
    pt("2026-12-01", 2n, 2n),
    pt("2026-12-31", 3n, 3n),
    pt("2027-01-01", 4n, 4n),
  ];
  const days = sliceToMonth(series, monthBounds("2026-12")).map((p) => p.day);
  assert.deepEqual(days, ["2026-12-01", "2026-12-31"]);
});

test("lowWithin ignora pontos fora do mês e escolhe o primeiro mínimo", () => {
  const series = [
    pt("2026-11-15", -900n, -900n), // fora do mês: não conta
    pt("2026-12-02", 500n, 400n),
    pt("2026-12-10", 300n, 200n),
    pt("2026-12-20", 300n, 200n), // empate: fica o primeiro
    pt("2027-01-03", -1n, -1n),
  ];
  const low = lowWithin(series, monthBounds("2026-12"));
  assert.deepEqual(low, {
    nom: { day: "2026-12-10", cents: 300n },
    cons: { day: "2026-12-10", cents: 200n },
  });
  assert.equal(lowWithin(series, monthBounds("2027-05")), null);
});

test("deficitWithin: mesma definição do motor (low.cons - cushion < 0), só no mês", () => {
  const series = [
    pt("2026-11-15", -900n, -900n), // déficit de novembro não vaza pra dezembro
    pt("2026-12-02", 500n, 400n),
    pt("2026-12-10", 300n, 150n),
  ];
  const dec = monthBounds("2026-12");
  // cCons = 150 - 100 = 50 >= 0 -> sem déficit.
  assert.equal(deficitWithin(series, dec, 100n), null);
  // cCons = 150 - 200 = -50 -> déficit de 50 no dia do mínimo.
  assert.deepEqual(deficitWithin(series, dec, 200n), {
    cents: 50n,
    day: "2026-12-10",
  });
  // cCons == 0 não é déficit.
  assert.equal(deficitWithin(series, dec, 150n), null);
  // O déficit de novembro existe em novembro.
  assert.deepEqual(deficitWithin(series, monthBounds("2026-11"), 0n), {
    cents: 900n,
    day: "2026-11-15",
  });
});
