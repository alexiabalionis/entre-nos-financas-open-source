// Família H da avaliação da Judite (SPEC-JUDITE-PROFUNDIDADE, Fase 4): diagnóstico
// no formato novo, o que entra antes do que sai, apelido de Pix e o que tem dentro
// de uma categoria. Mesma base de judite-eval-copiloto.ts (family); tudo fictício e
// em memória. Os números ficam nas constantes ao lado de cada família;
// tests-js/judite-eval-principios.test.ts confere contra as ferramentas.
import { randomUUID } from "node:crypto";
import { shiftMonth } from "../src/domain/card-cycle.ts";
import { addDays } from "../src/domain/day.ts";
import { settledToday } from "../src/server/bank-settled.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import type { Database } from "../src/server/db.ts";
import { setMerchantAlias } from "../src/server/merchant-alias.ts";
import { createGoal } from "../src/server/reserve-goal.ts";
import { BACKS, OPEN_QUESTION, family, near } from "./judite-eval-copiloto.ts";
import type { Question } from "./judite-eval-score.ts";
import { day, q, type Ledger, type Scenario } from "./judite-eval-scenarios.ts";

const ask = (id: string, text: string, p: Partial<Omit<Question, "id" | "q">>) => q(id, text, p);

// ------------------------------------------------------------ H1 fatura em 10 dias e reserva com prazo

/**
 * Salário 8.000. Fatura do Cartão Roxo vence em 10 dias (compra de 600 aberta no ciclo) e a reserva
 * "Viagem" (3.000, sem depósito) tem prazo no fim do mês seguinte ao da fatura ou do próprio mês.
 */
export const H1 = { salary: 8000, dueIn: 10, billCents: "60000", goal: "Viagem" };

const today = settledToday();
const ahead = (n: number) => addDays(today, n);

async function cardWithBill(db: Database, l: Ledger, name: string, dueIn: number): Promise<void> {
  const due = ahead(dueIn);
  const close = ahead(dueIn - 7);
  const [account, bankAccount, connection] = [randomUUID(), randomUUID(), randomUUID()];
  await db.query("INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')", [l.user.familyId, l.user.userId]);
  await db.query(
    "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2020-01-01')",
    [connection, l.user.familyId, l.user.userId, randomUUID()],
  );
  await db.query("INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,$3,'Banco Fictício','BRL','card',$4)", [
    account,
    l.user.familyId,
    name,
    l.user.userId,
  ]);
  await db.query(
    "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,$5,'BRL','CREDIT',$6)",
    [bankAccount, l.user.familyId, connection, randomUUID(), name, account],
  );
  await saveCardCycle(
    db,
    l.user,
    { account_id: account, close_date: shiftMonth(close.slice(0, 7), -2) + close.slice(7), due_date: shiftMonth(due.slice(0, 7), -2) + due.slice(7) },
    { today: day(2, 1) },
  );
  await db.query(
    `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,card_meta)
     VALUES($1,$2,$3,$4,$5,$6,'LOJA DE ROUPAS',$7,'BRL','POSTED','synthetic',$8,'{}')`,
    [randomUUID(), l.user.familyId, bankAccount, account, randomUUID(), ahead(-1), -Number(H1.billCents), randomUUID()],
  );
}

/** Fim do mês escolhido cai depois da fatura e dentro de 45 dias (horizonte de proximas_decisoes). */
const reserveMonth = () => {
  const here = today.slice(0, 7);
  const end = (m: string) => addDays(`${shiftMonth(m, 1)}-01`, -1);
  return end(here) > ahead(H1.dueIn) && end(here) <= ahead(45) ? here : shiftMonth(here, 1);
};

async function buildH1(db: Database, n: number) {
  const f = await family(db, n, "h1", 5, H1.salary);
  await cardWithBill(db, f, "Cartão Roxo", H1.dueIn);
  await createGoal(db, f.user, { name: H1.goal, target: "3000,00", deadline_month: reserveMonth() });
  return f.user;
}

// ------------------------------------------------------------ H2 freela parou, gasto ficou

/**
 * Salário 6.000 todo mês. Freelas de 2.500 só nos 3 primeiros meses (origens diferentes, avulsa).
 * Saída por mês: base 2.090 + aluguel 1.800 + compras 1.500 + 1.610 = 7.000, igual nos 6 meses.
 * Estrutural: 6.000 - 7.000 = -1.000. Nos 3 últimos meses: 6.000 - 7.000 = -1.000 por mês.
 */
export const H2 = { salary: 6000, freelas: [2500, 2500, 2500], clients: ["ALFA", "BETA", "GAMA"], compras: [1500, 1610], structural: -1000 };
async function buildH2(db: Database, n: number) {
  const f = await family(db, n, "h2", 5, H2.salary);
  const compras = await f.category("Compras");
  for (const back of BACKS) for (const [i, v] of H2.compras.entries()) await f.add("expense", day(back, 14 + i * 8), v, compras, "LOJA DE DEPARTAMENTO");
  for (const [i, back] of [6, 5, 4].entries()) await f.add("income", day(back, 15), H2.freelas[i]!, null, `PIX RECEBIDO CLIENTE ${H2.clients[i]} LTDA`);
  return f.user;
}

// ------------------------------------------------------------ H3 Pix com apelido

/**
 * 16 Pix de 200 à mesma pessoa em Casa (2, 2, 2, 3, 3, 4 por mês, 3.200 no total), com o apelido "Faxina".
 * Nos 3 meses fechados Casa soma 10 x 200 = 2.000: terceira em total, atrás de Moradia (5.400) e Mercado (4.080) e
 * à frente de Transporte (1.800), então entra na abertura.
 */
export const H3 = { count: 16, value: 200, perMonth: [2, 2, 2, 3, 3, 4], desc: "PIX ENVIADO FERNANDA SOUZA CPF 111.222.333-44", alias: "Faxina", total: 3200 };
async function buildH3(db: Database, n: number) {
  const f = await family(db, n, "h3", 5, 8000);
  const casa = await f.category("Casa");
  let first = "";
  for (const [i, back] of BACKS.entries())
    for (let k = 0; k < H3.perMonth[i]!; k++) {
      const id = await f.add("expense", day(back, 3 + k * 7), H3.value, casa, H3.desc);
      first ||= id;
    }
  await setMerchantAlias(db, f.user, { movement_id: `event:${first}`, alias: H3.alias });
  return f.user;
}

// ------------------------------------------------------------ H4 o que tem dentro de Compras pessoais

/**
 * Compras pessoais: LOJA ESTILO uma vez por mês nos 6 meses (6 x 120 = 720) e um notebook de 2.400 no mês -2.
 * Nos 3 meses fechados soma 3 x 120 + 2.400 = 2.760: terceira em total, atrás de Moradia (5.400) e Mercado (4.080) e
 * à frente de Transporte (1.800). A loja repete 3 vezes nesses meses.
 */
export const H4 = { place: "LOJA ESTILO", placeValue: 120, big: "NOTEBOOK LOJA TECNO", bigValue: 2400, bigBack: 2 };
async function buildH4(db: Database, n: number) {
  const f = await family(db, n, "h4", 5, 8000);
  const compras = await f.category("Compras pessoais");
  for (const back of BACKS) await f.add("expense", day(back, 12), H4.placeValue, compras, H4.place);
  await f.add("expense", day(H4.bigBack, 20), H4.bigValue, compras, H4.big);
  return f.user;
}

// ------------------------------------------------------------ perguntas

const DECISION_WORD = /fatura|vence|at[eé] |dia \d|semana|fim de semana|prazo/i;
const SERMON = /disciplina|se controlar|exager\w*|culpa|voc[eê]s precisam|irrespons[aá]vel/i;
const INCOME_FIRST = /^(?:(?!cort|reduz|diminu|cancel|enxug)[\s\S])*(renda|entra|freela|entrada)/i;
const STRUCTURAL_SOBRA = /sobra estrutural|(s[oó]|apenas) (o )?sal[aá]rio|sal[aá]rio (sozinho )?n[aã]o (cobre|paga|sustenta)|renda que se repete/i;

export const PRINCIPIOS_SCENARIOS: Scenario[] = [
  {
    id: "H1",
    label: "H1: diagnóstico com fatura em 10 dias e reserva com prazo",
    build: buildH1,
    questions: [ask("H1a", OPEN_QUESTION, { needs: [{ tool: "proximas_decisoes" }], must: [DECISION_WORD], mustNot: [SERMON], maxNumbers: 5, needsContas: true })],
  },
  {
    id: "H2",
    label: "H2: freela parou há 3 meses, gasto igual, nunca sobra",
    build: buildH2,
    questions: [ask("H2a", "Por que nunca sobra?", { needs: [{ tool: "renda_por_tipo" }], must: [INCOME_FIRST, STRUCTURAL_SOBRA] })],
  },
  {
    id: "H3",
    label: "H3: 16 Pix com o apelido Faxina",
    build: buildH3,
    questions: [
      ask("H3a", OPEN_QUESTION, {
        needs: [[{ tool: "abertura" }, { tool: "investigar_gastos" }]],
        must: [/faxina/i],
        mustNot: [/fernanda/i, near("faxina", "(cort|reduz|cancel)")],
      }),
    ],
  },
  {
    id: "H4",
    label: "H4: Compras pessoais com um lugar que se repete e uma compra grande",
    build: buildH4,
    questions: [ask("H4a", "Onde está indo o dinheiro de Compras pessoais?", { needs: [[{ tool: "abertura" }, { tool: "detalhar_categoria" }]], must: [/estilo|notebook/i] })],
  },
];
