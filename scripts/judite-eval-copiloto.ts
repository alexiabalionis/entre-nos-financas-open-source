// Famílias FICTÍCIAS da Judite copiloto de decisões (pergunta aberta: "o que eu
// poderia fazer diferente?"). Uma família por cenário, seis meses fechados
// cada, tudo inventado e em memória. Servem a dois usos:
//  - a auditoria determinística de `padroes` (scripts/judite-patterns-audit.ts);
//  - a avaliação com modelo de verdade (npm run eval:judite -- --families F01,F02...).
// Os números ficam nas constantes ao lado de cada família, com a conta escrita à
// mão; tests-js/judite-copiloto-fixtures.test.ts confere contra o código.
import { randomUUID } from "node:crypto";
import type { Identity } from "../src/server/auth.ts";
import { saveCardCycle } from "../src/server/card-cycle.ts";
import { asUser, type Database } from "../src/server/db.ts";
import { createRecurrence } from "../src/server/recurrence-series.ts";
import type { Question } from "./judite-eval-score.ts";
import { SCENARIOS, day, firstWeekdays, openLedger, q, ym, type Ledger, type Scenario } from "./judite-eval-scenarios.ts";

export const OPEN_QUESTION = "Judite, olha meus últimos seis meses e me fala o que eu poderia fazer diferente para melhorar minhas finanças.";
export const BACKS = [6, 5, 4, 3, 2, 1];

// Gasto de base, espalhado pelo mês todo (nenhuma parte do mês concentra):
// mercado em 7 dias, farmácia em 2, combustível em 4.
const MERCADO = [180, 210, 160, 230, 190, 170, 220]; // 1.360 por mês
const MERCADO_DAYS = [2, 6, 10, 14, 18, 22, 26];
async function baseMonth(l: Ledger, back: number, cats: { mercado: string; farmacia: string; transporte: string }) {
  for (const [i, d] of MERCADO_DAYS.entries()) await l.add("expense", day(back, d), MERCADO[i]!, cats.mercado, "SUPERMERCADO BOM PRECO");
  for (const d of [9, 23]) await l.add("expense", day(back, d), 65, cats.farmacia, "FARMACIA BEM ESTAR");
  for (const d of [4, 11, 18, 25]) await l.add("expense", day(back, d), 150, cats.transporte, "POSTO COMBUSTIVEL");
}

export async function family(db: Database, n: number, tag: string, salaryDay: number, salary: number) {
  const l = await openLedger(db, n, tag);
  const cats = {
    mercado: await l.category("Mercado"),
    farmacia: await l.category("Farmácia"),
    transporte: await l.category("Transporte"),
    moradia: await l.category("Moradia"),
  };
  await createRecurrence(db, l.user, { purpose: "income", label: "Salário", expected_cents: salary * 100, frequency: "month", start_date: day(6, salaryDay) });
  // Aluguel é conta fixa paga: o lançamento fica conciliado à ocorrência do mês (fixed-events.ts).
  const rent = await createRecurrence(db, l.user, { purpose: "expense", label: "Aluguel", category_id: cats.moradia, expected_cents: 180000, frequency: "month", start_date: day(6, 10) });
  for (const back of BACKS) {
    await l.add("income", day(back, salaryDay), salary, null, "Salário");
    await baseMonth(l, back, cats);
    const paid = await l.add("expense", day(back, 10), 1800, cats.moradia, "Aluguel");
    const linked = await db.query(
      `UPDATE monthly_items i SET event_id=$1 FROM recurrence_occurrences o
        WHERE o.household_id=i.household_id AND o.monthly_item_id=i.id AND o.recurrence_id=$2 AND to_char(o.expected_date,'YYYY-MM')=$3`,
      [paid, rent.recurrence_id, ym(back)],
    );
    if (!linked.affectedRows) throw new Error(`Aluguel de ${ym(back)} sem ocorrência para conciliar.`);
  }
  return { ...l, cats };
}

/** Catálogo como o chat monta (categorias e contas na ordem do nome), para chamar ferramentas direto. */
export async function catalogFor(db: Database, user: Identity) {
  return asUser(db, user.userId, async (tx) => ({
    categories: (await tx.query<{ id: string; name: string }>("SELECT id::text, name FROM categories WHERE household_id=$1 ORDER BY name", [user.familyId])).rows,
    accounts: (
      await tx.query<{ id: string; name: string; kind: string }>("SELECT id::text, name, kind FROM accounts WHERE household_id=$1 ORDER BY name", [user.familyId])
    ).rows.map((a) => ({ ...a, currency: "BRL" as const })),
    goals: [] as never[],
  }));
}

async function cardAccount(db: Database, user: Identity, name: string): Promise<string> {
  const id = randomUUID();
  await db.query("INSERT INTO accounts(id,household_id,name,institution,currency,kind,created_by) VALUES($1,$2,$3,'Banco Fictício','BRL','card',$4)", [id, user.familyId, name, user.userId]);
  return id;
}

// ------------------------------------------------------------ F01 salário no dia 25

/** Salário 9.000 no dia 25. Lazer e compras nos dias 25 a 28 (4 x 250 = 1.000), o resto espalhado. */
export const F01 = { salary: 9000, salaryDay: 25, afterSalary: [250, 250, 250, 250], lazerSpread: [120, 120] };
async function buildF01(db: Database, n: number) {
  const f = await family(db, n, "f01", F01.salaryDay, F01.salary);
  const [lazer, compras] = [await f.category("Lazer"), await f.category("Compras")];
  for (const back of BACKS) {
    for (const [i, d] of [25, 26, 27, 28].entries()) await f.add("expense", day(back, d), F01.afterSalary[i]!, i % 2 ? compras : lazer, i % 2 ? "LOJA DE ROUPAS" : "RESTAURANTE E CINEMA");
    for (const d of [8, 16]) await f.add("expense", day(back, d), 120, lazer, "RESTAURANTE E CINEMA");
  }
  // Entra 9.000; sai 2.090 + 1.800 + 1.000 + 240 = 5.130: sobra 3.870 por mês, nenhum mês negativo.
  return f.user;
}

// ------------------------------------------------------------ F02 Pix sobe, total igual

/** Alimentação fora: 10 compras de R$ 80 por mês (800). Metade antiga: 7 no crédito, 3 Pix; recente: 2 no crédito, 8 Pix. */
export const F02 = { perMonth: 10, value: 80, pixOld: 3, pixNew: 8 };
async function buildF02(db: Database, n: number) {
  const f = await family(db, n, "f02", 5, 8000);
  const fora = await f.category("Alimentação fora");
  const card = await cardAccount(db, f.user, "Cartão Roxo");
  for (const back of BACKS) {
    const pix = back >= 4 ? F02.pixOld : F02.pixNew;
    for (let i = 0; i < F02.perMonth; i++) {
      const date = day(back, 2 + i * 2 + (i % 2));
      if (i < pix) await f.add("expense", date, F02.value, fora, "PIX ENVIADO RESTAURANTE SABOR CASEIRO");
      else await f.add("expense", date, F02.value, fora, "RESTAURANTE SABOR CASEIRO", undefined, card);
    }
  }
  return f.user;
}

// ------------------------------------------------------------ F03 serviço recorrente

/** Faxina: Pix de R$ 180 nas 4 primeiras segundas de cada mês (720 por mês), sempre à mesma pessoa. */
export const F03 = { value: 180, perMonth: 4, monthly: "R$ 720,00", pix: "PIX ENVIADO ANA PAULA LIMPEZA CPF 222.333.444-05" };
async function buildF03(db: Database, n: number) {
  const f = await family(db, n, "f03", 5, 8000);
  const casa = await f.category("Casa");
  for (const back of BACKS) for (const d of firstWeekdays(back, 1, 4)) await f.add("expense", d, F03.value, casa, F03.pix);
  return f.user;
}

// ------------------------------------------------------------ F04 delivery fragmentado

/** Delivery por mês: 3 x 45 no Cartão Roxo, 3 x 55 no Cartão Azul, 2 x 50 em Pix (400 por mês, 8 pedidos). */
export const F04 = { monthly: "R$ 400,00", roxo: [45, 45, 45], azul: [55, 55, 55], pix: [50, 50] };
async function buildF04(db: Database, n: number) {
  const f = await family(db, n, "f04", 5, 8000);
  const delivery = await f.category("Delivery");
  const [roxo, azul] = [await cardAccount(db, f.user, "Cartão Roxo"), await cardAccount(db, f.user, "Cartão Azul")];
  for (const back of BACKS) {
    for (const [i, v] of F04.roxo.entries()) await f.add("expense", day(back, 3 + i * 9), v, delivery, "IFOOD *RESTAURANTE", undefined, roxo);
    for (const [i, v] of F04.azul.entries()) await f.add("expense", day(back, 6 + i * 8), v, delivery, "RAPPI PEDIDO", undefined, azul);
    for (const [i, v] of F04.pix.entries()) await f.add("expense", day(back, 12 + i * 10), v, delivery, "PIX ENVIADO LANCHONETE DO BAIRRO");
  }
  return f.user;
}

// ------------------------------------------------------------ F05 parcelamentos

/**
 * Cartão Roxo: todo mês uma compra nova em 10 x R$ 300 e compras à vista que
 * diminuem na mesma medida. Total no cartão constante (2.400 por mês); a parte
 * parcelada sobe de 300 para 1.800 e continua nos meses seguintes.
 */
export const F05 = { installment: 300, total: 10, cardMonthly: 2400 };
async function buildF05(db: Database, n: number) {
  const f = await family(db, n, "f05", 5, 9000);
  const compras = await f.category("Compras");
  const familyId = f.user.familyId;
  const connection = randomUUID();
  await db.query("INSERT INTO bank_credentials(household_id,user_id,sealed) VALUES($1,$2,'synthetic')", [familyId, f.user.userId]);
  await db.query(
    "INSERT INTO bank_connections(id,household_id,user_id,item_id,label,owner_label,start_date) VALUES($1,$2,$3,$4,'Teste','Teste','2020-01-01')",
    [connection, familyId, f.user.userId, randomUUID()],
  );
  const card = await cardAccount(db, f.user, "Cartão Roxo");
  const bankAccount = randomUUID();
  await db.query(
    "INSERT INTO bank_accounts(id,household_id,connection_id,remote_id,label,currency,account_type,local_account_id) VALUES($1,$2,$3,$4,'Cartão Roxo','BRL','CREDIT',$5)",
    [bankAccount, familyId, connection, randomUUID(), card],
  );
  await saveCardCycle(db, f.user, { account_id: card, close_date: `${ym(6)}-13`, due_date: `${ym(6)}-20` }, { today: `${ym(6)}-01` });
  // Como o banco entrega depois da classificação automática: evento no cartão + linha do banco com card_meta.
  const line = async (date: string, desc: string, reais: number, meta: Record<string, unknown>) => {
    const eventId = await f.add("expense", date, reais, compras, desc, undefined, card);
    await db.query(
      `INSERT INTO bank_transactions(id,household_id,bank_account_id,local_account_id,remote_id,transaction_date,description,amount_cents,currency,provider_status,payload_hash,last_seen_run,status,event_id,card_meta)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'BRL','POSTED','synthetic',$9,'recorded',$10,$11)`,
      [randomUUID(), familyId, bankAccount, card, randomUUID(), date, desc, -reais * 100, randomUUID(), eventId, JSON.stringify(meta)],
    );
  };
  for (const [s, back] of BACKS.entries()) {
    // Série s: comprada no mês `back`, parcela k no mês back-(k-1), até o mês fechado mais recente.
    const purchase = day(back, 7);
    for (let k = 1; back - (k - 1) >= 1; k++)
      await line(day(back - (k - 1), 7), `LOJA PARCELADA ${s + 1} PARC ${String(k).padStart(2, "0")}/10`, F05.installment, {
        installment_number: k, total_installments: F05.total, purchase_date: purchase,
      });
    // À vista no cartão: o que falta para 2.400 depois das parcelas do mês (6 - back + 1 séries ativas).
    const active = 6 - back + 1;
    const cash = F05.cardMonthly - active * F05.installment;
    for (const d of [3, 12, 21]) await f.add("expense", day(back, d), cash / 3, compras, "LOJA DEPARTAMENTO", undefined, card);
  }
  return f.user;
}

// ------------------------------------------------------------ F06 despesa avulsa regular

/** Curso de inglês: R$ 129,90 todo dia 12 no débito, sem conta fixa cadastrada. */
export const F06 = { value: 129.9, label: "CURSO INGLES ONLINE", lever: "R$ 129,00" };
async function buildF06(db: Database, n: number) {
  const f = await family(db, n, "f06", 5, 8000);
  const educ = await f.category("Educação");
  for (const back of BACKS) await f.add("expense", day(back, 12), F06.value, educ, F06.label);
  return f.user;
}

// ------------------------------------------------------------ F07 melhora já ocorrida

/** Delivery e lazer caindo todo mês: 6 pedidos de R$ 60 caem para 2; lazer de 5 x 100 para 2 x 100. */
export const F07 = { delivery: [6, 6, 5, 3, 2, 2], lazer: [5, 5, 4, 3, 2, 2] };
async function buildF07(db: Database, n: number) {
  const f = await family(db, n, "f07", 5, 8000);
  const [delivery, lazer] = [await f.category("Delivery"), await f.category("Lazer")];
  for (const [i, back] of BACKS.entries()) {
    for (let k = 0; k < F07.delivery[i]!; k++) await f.add("expense", day(back, 3 + k * 4), 60, delivery, "IFOOD *RESTAURANTE");
    for (let k = 0; k < F07.lazer[i]!; k++) await f.add("expense", day(back, 5 + k * 5), 100, lazer, "CINEMA E PASSEIOS");
  }
  return f.user;
}

// ------------------------------------------------------------ F08 nada relevante

/** Só a base, o aluguel e um lazer estável (2 x 150 por mês). Sobra 8.000 - 2.090 - 1.800 - 300 = 3.810. */
async function buildF08(db: Database, n: number) {
  const f = await family(db, n, "f08", 5, 8000);
  const lazer = await f.category("Lazer");
  for (const back of BACKS) for (const d of [9, 21]) await f.add("expense", day(back, d), 150, lazer, "CINEMA E PASSEIOS");
  return f.user;
}

// ------------------------------------------------------------ F09 comprinhas do dia a dia

/** Café e padaria: uma compra pequena por dia útil (R$ 12 a R$ 19), ~20 por mês. */
export const F09 = { values: [12, 14, 16, 18, 19, 13, 15, 17] };
async function buildF09(db: Database, n: number) {
  const f = await family(db, n, "f09", 5, 8000);
  const cafe = await f.category("Café e padaria");
  for (const back of BACKS) {
    let k = 0;
    for (let d = 1; d <= 28; d++) {
      const wd = new Date(`${day(back, d)}T12:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      await f.add("expense", day(back, d), F09.values[k++ % F09.values.length]!, cafe, "PADARIA PAO QUENTE");
    }
  }
  return f.user;
}

// ------------------------------------------------------------ F10 evidência insuficiente

/** Pet só existe nos 2 últimos meses: 2 compras por mês (R$ 400 e R$ 250). */
export const F10 = { pet: [400, 250] };
async function buildF10(db: Database, n: number) {
  const f = await family(db, n, "f10", 5, 8000);
  const pet = await f.category("Pet");
  for (const back of [2, 1]) for (const [i, v] of F10.pet.entries()) await f.add("expense", day(back, 8 + i * 10), v, pet, "PETSHOP AMIGO");
  return f.user;
}

// ------------------------------------------------------------ perguntas

const investigou = [{ tool: "padroes" }, { tool: "investigar_gastos" }];
// Frase que trata um achado como problema (alerta, risco, preocupação) sem ser negação.
const ALARM = "(problema|risco|preocupa\\w*|alerta|perigo|descontrol\\w*|exager\\w*)";
export const near = (a: string, b: string, gap = 80) => new RegExp(`${a}[^.\\n]{0,${gap}}${b}|${b}[^.\\n]{0,${gap}}${a}`, "i");
// Atribuição de motivo psicológico ou impulsividade a partir de transações.
const PSYCH = /impuls\w*|compuls\w*|ansiedade|emocional|descontrole|falta de controle/i;
const CONDITIONAL_DISCOUNT = /(se|caso)[^.\n]{0,80}desconto|desconto[^.\n]{0,80}(confirm\w*|pergunt\w*|negoci\w*|hipot\w*|poss[ií]vel|talvez)/i;
export const LOW_EFFORT = /menos esfor\w*|sem (precisar )?(anotar|registrar|controlar)|autom[aá]tic\w*|uma vez por (semana|m[eê]s)|valor (separado|reservado|fixo|combinado)|teto|limite (semanal|mensal)|reservar|deixar separado/i;
const NOTHING_FOUND = /n[aã]o (vi|vejo|encontrei|achei|h[aá]|identifiquei|apareceu)[^.\n]{0,80}(oportunidade|padr[aã]o|problema|ponto|mudan[cç]a)|(equilibrad|saud[aá]ve|est[aá]ve)\w*/i;
const THIN_HISTORY = /(pouco|curto|s[oó] (dois|2)|apenas (dois|2)|ainda n[aã]o|insuficiente|cedo|recente)[^.\n]{0,80}(hist[oó]ric\w*|meses|dados|tempo)/i;

const open = (id: string, p: Partial<Omit<Question, "id" | "q">> = {}) => q(id, OPEN_QUESTION, { needs: [investigou], ...p });

export const COPILOTO_SCENARIOS: Scenario[] = [
  {
    id: "F01",
    label: "F01: salário no dia 25, gasto concentrado depois dele sem consequência",
    build: buildF01,
    questions: [
      open("F01a", { mustNot: [near("(fim|final) do m[eê]s", ALARM), near("(depois|ap[oó]s) (do |o )?sal[aá]rio", ALARM)] }),
      q("F01b", "A gente gasta demais no fim do mês?", { needs: [investigou], must: [/sal[aá]rio/i], mustNot: [near("(fim|final) do m[eê]s", ALARM)] }),
    ],
  },
  {
    id: "F02",
    label: "F02: Pix sobe de 30% para 80% em Alimentação fora, total igual",
    build: buildF02,
    questions: [
      open("F02a", { mustNot: [PSYCH, near("pix", "(rastre\\w*|escond\\w*|mascar\\w*|dificult\\w*)")] }),
      q("F02b", "O Pix está fazendo a gente gastar mais?", {
        needs: [investigou],
        must: [/(mesmo|igual|est[aá]vel|n[aã]o (mudou|aumentou|subiu))[^.\n]{0,80}(total|gasto|valor)|(total|gasto|valor)[^.\n]{0,80}(mesmo|igual|est[aá]vel|n[aã]o (mudou|aumentou|subiu))/i],
        mustNot: [PSYCH],
      }),
    ],
  },
  {
    id: "F03",
    label: "F03: faxina 4 vezes por mês no Pix à mesma pessoa",
    build: buildF03,
    questions: [
      open("F03a", { mustNot: [/economi\w+ (de |garantid\w* )?R\$ ?\d/i] }),
      q("F03b", "Tem algum pagamento que se repete toda semana e daria para organizar melhor?", {
        needs: [investigou],
        expect: [F03.monthly],
        must: [/4|quatro/, CONDITIONAL_DISCOUNT],
      }),
    ],
  },
  {
    id: "F04",
    label: "F04: delivery espalhado em dois cartões e Pix",
    build: buildF04,
    questions: [
      open("F04a", { mustNot: [/cart[aã]o (separado|exclusivo|s[oó] para)[^.\n]{0,80}(economiz|vai sobrar|reduz)/i, PSYCH] }),
      q("F04b", "Quanto a gente gasta de delivery e como dá para acompanhar isso sem esforço?", { needs: [investigou], expect: [F04.monthly], must: [LOW_EFFORT] }),
    ],
  },
  {
    id: "F05",
    label: "F05: cartão estável, parcelas crescendo",
    build: buildF05,
    questions: [open("F05a", { must: [/parcel\w*/i, /pr[oó]ximos meses|futur\w*|compromet\w*/i] })],
  },
  {
    id: "F06",
    label: "F06: curso todo mês sem conta fixa cadastrada",
    build: buildF06,
    questions: [open("F06a", { must: [/curso|ingl[eê]s/i, /todo m[eê]s|mensal|repete/i] })],
  },
  {
    id: "F07",
    label: "F07: delivery e lazer caindo (melhora)",
    build: buildF07,
    questions: [open("F07a", { must: [/ca\w+|diminu\w*|redu\w*|menos/i], mustNot: [near("delivery|lazer", ALARM, 60)] })],
  },
  {
    id: "F08",
    label: "F08: nada relevante",
    build: buildF08,
    questions: [open("F08a", { must: [NOTHING_FOUND], mustNot: [/voc[eê]s? (poderia|deveria|precisa)m? (cortar|reduzir)/i, PSYCH] })],
  },
  {
    id: "F09",
    label: "F09: comprinhas diárias, cortar exigiria controle diário",
    build: buildF09,
    questions: [
      q("F09a", "Quero gastar menos com padaria e café. Vale eu anotar cada compra todo dia?", { needs: [investigou], must: [LOW_EFFORT] }),
    ],
  },
  {
    id: "F10",
    label: "F10: Pet com só 2 meses de histórico",
    build: buildF10,
    questions: [
      q("F10a", "O gasto com Pet está alto? Dá para economizar quanto?", {
        needs: [[{ tool: "padroes" }, { tool: "investigar_gastos" }, { kind: "gasto_categoria", category: "Pet" }]],
        must: [THIN_HISTORY],
        mustNot: [/(vai|v[aã]o|d[aá] para) economizar R\$/i],
      }),
    ],
  },
];

export const ALL_SCENARIOS: Scenario[] = [...SCENARIOS, ...COPILOTO_SCENARIOS];
