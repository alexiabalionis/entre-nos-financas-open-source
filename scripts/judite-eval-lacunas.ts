// Família G da avaliação da Judite (SPEC-JUDITE-LACUNAS, Fase 5): renda por tipo,
// dados sujos, cruzamento de categorias e perfil. Mesma base de
// judite-eval-copiloto.ts (family); tudo fictício e em memória. Os números ficam
// nas constantes ao lado de cada família; tests-js/judite-eval-lacunas.test.ts
// confere contra as ferramentas.
import { saveMemoryTx } from "../src/server/ai-assistant-memories.ts";
import { asUser, type Database } from "../src/server/db.ts";
import { ALL_SCENARIOS as BASE_SCENARIOS, BACKS, LOW_EFFORT, OPEN_QUESTION, family } from "./judite-eval-copiloto.ts";
import type { Question } from "./judite-eval-score.ts";
import { PRINCIPIOS_SCENARIOS } from "./judite-eval-principios.ts";
import { day, q, type Scenario } from "./judite-eval-scenarios.ts";

// ------------------------------------------------------------ G1 renda que não se repete

/**
 * Salário 6.000 todo mês (recorrente). Freelas de 2.500 em 4 meses, origens diferentes (avulsa).
 * Saída por mês: base 2.090 + aluguel 1.800 + compras 1.500 + 1.610 = 7.000.
 * Estrutural: 6.000 - 7.000 = -1.000. Atual: 6.000 + 4 x 2.500 / 6 - 7.000 = +666,67.
 */
export const G1 = { salary: 6000, freelas: [2500, 2500, 2500, 2500], clients: ["ALFA", "BETA", "GAMA", "DELTA"], compras: [1500, 1610], structural: -1000 };
async function buildG1(db: Database, n: number) {
  const f = await family(db, n, "g1", 5, G1.salary);
  const compras = await f.category("Compras");
  for (const back of BACKS) for (const [i, v] of G1.compras.entries()) await f.add("expense", day(back, 14 + i * 8), v, compras, "LOJA DE DEPARTAMENTO");
  for (const [i, back] of [6, 5, 4, 3].entries()) await f.add("income", day(back, 15), G1.freelas[i]!, null, `PIX RECEBIDO CLIENTE ${G1.clients[i]} LTDA`);
  return f.user;
}

// ------------------------------------------------------------ G2 entrada que é dinheiro de vocês

/** Resgate de 3.000 (mês -2) e Pix de 1.500 do próprio membro "Pessoa fictícia" (mês -1), ambos como entrada. Duas suspeitas. */
export const G2 = { rescue: 3000, own: 1500, rescueLabel: "RESGATE RDB", ownLabel: "PIX RECEBIDO PESSOA FICTICIA" };
async function buildG2(db: Database, n: number) {
  const f = await family(db, n, "g2", 5, 6000);
  await f.add("income", day(2, 12), G2.rescue, null, G2.rescueLabel);
  await f.add("income", day(1, 12), G2.own, null, G2.ownLabel);
  return f.user;
}

// ------------------------------------------------------------ G3 Pix sem categoria

/** 30 Pix sem categoria, 10 para cada um dos 3 destinatários: 10 x (100 + 200 + 300) = 6.000. */
export const G3 = { recipients: ["CARLOS ALVARENGA", "DENISE MOTTA", "EDUARDO PRADO"], values: [100, 200, 300], total: 6000 };
async function buildG3(db: Database, n: number) {
  const f = await family(db, n, "g3", 5, 8000);
  for (let i = 0; i < 30; i++)
    await f.add("expense", day(BACKS[i % 6]!, 16 + Math.floor(i / 6)), G3.values[i % 3]!, null, `PIX ENVIADO ${G3.recipients[i % 3]!} CPF 123.456.789-00`);
  return f.user;
}

// ------------------------------------------------------------ G4 câmera em Outras

/** Outras: 200 por mês nos 6 meses; no mês -3 mais uma câmera de 8.700 (mês de 8.900, normal 200). */
export const G4 = { monthly: 200, camera: 8700, cameraMonth: 3 };
async function buildG4(db: Database, n: number) {
  const f = await family(db, n, "g4", 5, 8000);
  const outras = await f.category("Outras");
  for (const back of BACKS) await f.add("expense", day(back, 8), G4.monthly, outras, "PAPELARIA CENTRAL");
  await f.add("expense", day(G4.cameraMonth, 20), G4.camera, outras, "CAMERA FOTOGRAFICA");
  return f.user;
}

// ------------------------------------------------------------ G5 mercado grande, delivery depois

/**
 * Mercado grande (450) nos dias 4, 11, 18 e 25 de cada mês: 24 compras. Em 3 de cada 4 (18) há delivery (60)
 * 1, 2 ou 3 dias depois. As compras pequenas do mercado de base (até 230) ficam abaixo do valor mínimo 400.
 * Parte = 18 / 24 = 75%; 18 pedidos x 4 dias de janela / ~180 dias = ~40% esperado; índice ~1,9.
 */
export const G5 = { big: 450, delivery: 60, minimumCents: "40000", triggerDays: [4, 11, 18, 25] };
async function buildG5(db: Database, n: number) {
  const f = await family(db, n, "g5", 5, 8000);
  const delivery = await f.category("Delivery");
  for (const back of BACKS)
    for (const [i, d] of G5.triggerDays.entries()) {
      await f.add("expense", day(back, d), G5.big, f.cats.mercado, "SUPERMERCADO BOM PRECO");
      if (i < 3) await f.add("expense", day(back, d + 1 + i), G5.delivery, delivery, "IFOOD *RESTAURANTE");
    }
  return f.user;
}

// ------------------------------------------------------------ G6 perfil na memória

/** Café e padaria todo dia útil (como F09), faxina 4 x 150 e terapia 4 x 200 por mês, e o aprendizado de perfil. */
export const G6 = { memory: "Tenho pouca energia no fim do dia; anotar todo dia não funciona pra mim. Faxina e terapia não se cortam.", faxina: 150, terapia: 200 };
async function buildG6(db: Database, n: number) {
  const f = await family(db, n, "g6", 5, 8000);
  const [cafe, casa, saude] = [await f.category("Café e padaria"), await f.category("Faxina"), await f.category("Terapia")];
  for (const back of BACKS) {
    let k = 0;
    for (let d = 1; d <= 28; d++) {
      const wd = new Date(`${day(back, d)}T12:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      await f.add("expense", day(back, d), 12 + (k++ % 8), cafe, "PADARIA PAO QUENTE");
    }
    for (const d of [3, 10, 17, 24]) {
      await f.add("expense", day(back, d), G6.faxina, casa, "DIARISTA FAXINA");
      await f.add("expense", day(back, d + 1), G6.terapia, saude, "CLINICA TERAPIA");
    }
  }
  await asUser(db, f.user.userId, (tx) =>
    saveMemoryTx(tx, f.user, {
      kind: "aprendizado",
      text: G6.memory,
      context: "Conversa de avaliação.",
      topics: ["perfil"],
      category: null,
      as_of: day(1, 28),
      effective_from: null,
      effective_until: null,
      replaces: null,
    }),
  );
  return f.user;
}

// ------------------------------------------------------------ perguntas

const ask = (id: string, p: Partial<Omit<Question, "id" | "q">>) => q(id, OPEN_QUESTION, p);
// Verbo de anotar/cortar não vale quando vem negado ("sem anotar", "não vale anotar", "não cortar").
const NOT_BEFORE = "(?<!sem (?:precisar |ter que )?)(?<!n[aã]o (?:\\S+ ){0,2})";
const LOG_EVERY_DAY = new RegExp(`${NOT_BEFORE}\\b(?:anot|registr)\\w*[^.\\n]{0,40}(?:todo dia|todos os dias|cada compra|diariamente)`, "i");
const CUT_ESSENTIAL = new RegExp(`${NOT_BEFORE}\\b(?:cort|reduz|elimin|cancel|suspend)\\w*[^.\\n]{0,40}(?:faxina|terapia)`, "i");
export const ASKS_BEFORE_SUGGESTING =
  /^(?:(?!A pr[oó]xima decis[aã]o|Pr[oó]ximos passos)[\s\S])*(quem (é|s[aã]o)|de quem|o que (é|s[aã]o) (esses|estes))/i;
const MERCADO_THEN_DELIVERY = /(?=[^.\n]*mercado)(?=[^.\n]*delivery)[^.\n]*(depois|ap[oó]s|em at[eé])/i;
const STRUCTURAL = /sobra estrutural|renda que se repete|(sem|s[oó]) (o |a |com o |com a )?(freela\w*|renda avulsa|entradas? avulsas?)|apenas o sal[aá]rio|s[oó] (o )?sal[aá]rio/i;
const SHORTFALL = /negativ\w*|d[eé]ficit|n[aã]o cobre|n[aã]o (se )?sustenta|faltaria|falta/i;
const OWN_MONEY = /(resgat\w*|rdb|transfer[eê]ncia pr[oó]pri\w*|dinheiro (de voc[eê]s|pr[oó]prio))[^.\n]{0,100}(suspeit\w*|pr[oó]pri\w*|confirm\w*|n[aã]o (é|parece|conta))|suspeit\w*[^.\n]{0,100}(resgat\w*|rdb)/i;
const RESCUE_AS_INCOME = /(resgat\w*|rdb)[^.\n]{0,60}(?<!n[aã]o [eé] )renda (que se repete|recorrente|fixa)/i;
const RECIPIENT_NAMES = new RegExp(G3.recipients.flatMap((r) => r.split(" ")).join("|"), "i");

export const LACUNAS_SCENARIOS: Scenario[] = [
  {
    id: "G1",
    label: "G1: salário cobre menos que a saída, freelas avulsos escondem o déficit",
    build: buildG1,
    questions: [ask("G1a", { needs: [{ tool: "renda_por_tipo" }], must: [STRUCTURAL, SHORTFALL] })],
  },
  {
    id: "G2",
    label: "G2: resgate e Pix do próprio membro lançados como entrada",
    build: buildG2,
    questions: [ask("G2a", { needs: [{ tool: "renda_por_tipo" }], must: [OWN_MONEY], mustNot: [RESCUE_AS_INCOME] })],
  },
  {
    id: "G3",
    label: "G3: 30 Pix sem categoria para 3 destinatários",
    build: buildG3,
    questions: [ask("G3a", { needs: [{ tool: "avisos_de_dados" }], must: [ASKS_BEFORE_SUGGESTING], mustNot: [RECIPIENT_NAMES] })],
  },
  {
    id: "G4",
    label: "G4: câmera de 8.700 em Outras",
    build: buildG4,
    questions: [
      ask("G4a", { needs: [{ tool: "avisos_de_dados" }], must: [/c[aâ]mera|compra pontual|compra [uú]nica|pontual/i], mustNot: [/Outras (subiu|aumentou|est[aá] acima do normal|ficou acima do normal)/i] }),
    ],
  },
  {
    id: "G5",
    label: "G5: mercado grande e delivery nos dias seguintes",
    build: buildG5,
    questions: [ask("G5a", { needs: [{ tool: "investigar_gastos" }], must: [MERCADO_THEN_DELIVERY] })],
  },
  {
    id: "G6",
    label: "G6: comprinhas diárias, pouca energia e o que não se corta",
    build: buildG6,
    questions: [ask("G6a", { must: [LOW_EFFORT], mustNot: [LOG_EVERY_DAY, CUT_ESSENTIAL] })],
  },
];

export const ALL_SCENARIOS: Scenario[] = [...BASE_SCENARIOS, ...LACUNAS_SCENARIOS, ...PRINCIPIOS_SCENARIOS];
