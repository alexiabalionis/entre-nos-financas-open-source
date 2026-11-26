import { normalize } from "./finance.ts";

export const reviewGroups = {
  history: "Coincidências com o histórico",
  statement: "Coincidências com os extratos",
  duplicate: "Possíveis duplicidades",
  transfer: "Transferências próprias",
  card: "Pagamentos de fatura",
  investment: "Aplicações e resgates",
  income: "Entradas identificadas",
  expense: "Despesas",
  unclear: "Precisam da sua decisão",
  pending: "Pendentes ou alterados no banco",
} as const;
export type ReviewGroup = keyof typeof reviewGroups;
export type Observation = {
  id: string;
  local_account_id: string;
  bank_account_id?: string;
  transaction_date: string;
  amount_cents: string;
  currency: string;
  description: string;
  provider_id?: string | null;
  provider_status: string;
  changed?: boolean;
  missing?: boolean;
  account_kind?: string;
  owner_id?: string;
  status?: string;
};
export type Evidence = {
  id: string;
  account_id: string;
  transaction_date: string;
  amount_cents: string;
  currency: string;
  description: string;
  filename?: string;
  event_id?: string | null;
  kind?: string;
  // Contas do banco que já sustentam este evento. Outra linha da MESMA conta
  // do banco é outro movimento (o banco não repete id na mesma conta), então o
  // evento não conta como histórico para ela. Reconexão cria outra conta do
  // banco e continua coincidindo.
  bank_account_ids?: string[] | null;
};
export type Analysis = {
  semantic?: string;
  category_suggestion?: string;
  planning?: string[];
  group: ReviewGroup;
  reason: string;
  decision: string;
  event_ids: string[];
  staged_ids: string[];
  related_ids: string[];
  evidence: string[];
  version: 2;
};
const distance = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
const transfer = (s: string) => /PIX|TRANSFER|TED|DOC /.test(s);
const card = (s: string) =>
  /FATURA|PAGAMENTO RECEBIDO|PAGAMENTO DE CARTAO|PAGAMENTO CARTAO/.test(s);
const investment = (s: string) =>
  /RDB|APLICACAO|RESGATE|INVESTIMENTO|CDB/.test(s);
/**
 * Reconhece um débito/crédito que QUITA uma fatura de cartão (não é compra).
 * Fonte única da verdade — os pontos que separam pagamento-de-fatura das compras
 * (state.ts, cards.ts, pending.ts) devem chamar isto, nunca regex própria, para
 * não divergir. Passe description e operation_type JÁ normalizados (normalize()
 * tira acento, então "Débito automático Fatura" vira "DEBITO AUTOMATICO FATURA").
 * Cobre: "PAGAMENTO_FATURA" (operation_type), "PAGAMENTO ... FATURA/RECEBIDO"
 * e o "DEBITO AUTOMATICO FATURA <cartão>" do Itaú (o que faltava).
 */
export const billPayment = (description: string, operationType = "") =>
  /PAGAMENTO_FATURA/.test(operationType) ||
  /PAGAMENTO.*(FATURA|RECEBIDO)/.test(description) ||
  /DEBITO AUTOMATICO.*FATURA/.test(description);
/**
 * Fragmento SQL (sobre o alias `t` de bank_transactions) que reconhece uma
 * SAÍDA AUTOMÁTICA de serviço — a que conta como gasto do mês sem pedir
 * aprovação. Fonte única da verdade: state.ts (soma no gasto) e a coluna
 * autospend/scheduled do bankPending devem usar ESTA constante, nunca uma
 * regex própria, para não divergir.
 * Cobre:
 *  - PIX/TED/DOC/TRANSFER de saída (operation_type), o padrão original; e
 *  - "DEBITO AUTOMATICO" de serviço na descrição (Vivo, Enel, etc.).
 * NÃO cobre pagamento de fatura: o débito automático de fatura cai no grupo
 * `card` (billPayment), que os chamadores já excluem via NOT IN ('card'). Aqui
 * exigimos ainda que a descrição não contenha FATURA, defesa em profundidade
 * caso a análise não tenha rodado.
 */
export const AUTO_OUTFLOW_SQL =
  "(t.operation_type ~* '^(PIX|TED|DOC|TRANSFER)' OR (t.description ~* 'DEBITO AUTOMATICO' AND t.description !~* 'FATURA'))";
const similar = (a: string, b: string) => {
  const words = normalize(a)
    .split(/\W+/)
    .filter(
      (w) =>
        w.length > 4 &&
        ![
          "TRANSFERENCIA",
          "RECEBIDA",
          "ENVIADA",
          "PAGAMENTO",
          "COMPRA",
        ].includes(w),
    );
  return words.some((w) => normalize(b).split(/\W+/).includes(w));
};
export function analyzeObservations(
  rows: Observation[],
  legs: Evidence[],
  staged: Evidence[],
  incomeRules: {
    account_id: string;
    match_text: string;
    label: string;
    budget_offset: number;
  }[] = [],
): Map<string, Analysis> {
  const result = new Map<string, Analysis>();
  const peers = (r: Observation) =>
    rows.filter(
      (o) =>
        o.id !== r.id &&
        o.local_account_id !== r.local_account_id &&
        o.currency === r.currency &&
        BigInt(o.amount_cents) === -BigInt(r.amount_cents) &&
        distance(o.transaction_date, r.transaction_date) <= 3 &&
        !o.changed &&
        !o.missing &&
        o.provider_status === "POSTED",
    );
  const same = (r: Observation, e: Evidence) =>
    e.account_id === r.local_account_id &&
    e.currency === r.currency &&
    e.amount_cents === r.amount_cents &&
    !(r.bank_account_id && e.bank_account_ids?.includes(r.bank_account_id));
  for (const r of rows) {
    const text = normalize(r.description),
      exact = legs.filter(
        (e) => same(r, e) && e.transaction_date === r.transaction_date,
      ),
      old = staged.filter(
        (e) =>
          !e.event_id &&
          same(r, e) &&
          e.transaction_date === r.transaction_date,
      );
    const near = legs.filter(
      (e) =>
        same(r, e) &&
        distance(e.transaction_date, r.transaction_date) <= 3 &&
        similar(r.description, e.description),
    );
    const repeats = rows.filter(
      (o) =>
        o.id !== r.id &&
        o.local_account_id === r.local_account_id &&
        o.amount_cents === r.amount_cents &&
        o.currency === r.currency &&
        ((r.provider_id && o.provider_id === r.provider_id) ||
          (o.transaction_date === r.transaction_date &&
            normalize(o.description) === text)),
    );
    // Repetição entre leituras do banco: a primeira (menor id) conta, as demais
    // juntam-se a ela. Assim o movimento entra uma vez só, nunca zero vezes.
    const later = repeats.some((o) => o.id < r.id);
    const a: Analysis = {
      group: "unclear",
      reason: "A descrição não permite determinar a finalidade com segurança.",
      decision: "Informe se é despesa, entrada ou transferência e a categoria.",
      event_ids: exact.map((e) => e.id),
      staged_ids: old.map((e) => e.id),
      related_ids: [],
      evidence: old.map((e) => e.filename || "Extrato original"),
      version: 2,
    };
    if (exact.length) {
      a.group = "history";
      a.reason = `${exact.length} lançamento(s) com a mesma conta, data, moeda e valor.`;
      a.decision =
        "Confira a descrição e vincule ao histórico, se for o mesmo movimento. Não é uma duplicidade comprovada.";
    } else if (near.length) {
      a.group = "duplicate";
      a.event_ids = near.map((e) => e.id);
      a.reason =
        "Valor e conta iguais ao histórico, descrição semelhante e data próxima.";
      a.decision =
        "Confira a diferença de data antes de vincular ou registrar outro movimento.";
    }
    if (later) {
      a.group = "duplicate";
      a.related_ids = repeats.map((o) => o.id);
      a.reason =
        "Há outro movimento bancário com identificador ou dados iguais; conta uma vez só.";
      a.decision = "Se forem duas operações diferentes, remova a junção.";
    }
    if (investment(text) && !exact.length && !later) {
      a.group = "investment";
      a.reason = "A descrição indica aplicação ou resgate.";
      a.decision =
        "Identifique a conta de investimento e separe rendimentos do principal. Resgate não é salário.";
    }
    const pair = peers(r).filter(
      (o) =>
        !investment(normalize(o.description)) &&
        (card(text) ||
          card(normalize(o.description)) ||
          (transfer(text) &&
            transfer(normalize(o.description)) &&
            !!r.owner_id &&
            r.owner_id === o.owner_id)),
    );
    if (
      pair.length &&
      !exact.length &&
      !later &&
      !investment(text)
    ) {
      a.group =
        card(text) || pair.some((o) => card(normalize(o.description)))
          ? "card"
          : "transfer";
      a.related_ids = pair.map((o) => o.id);
      const mutual =
        pair.length === 1 &&
        peers(pair[0]).filter(
          (o) =>
            card(normalize(o.description)) ||
            card(normalize(pair[0].description)) ||
            (transfer(normalize(o.description)) &&
              transfer(normalize(pair[0].description)) &&
              o.owner_id === pair[0].owner_id),
        ).length === 1;
      a.reason = mutual
        ? "Encontrada uma contrapartida de sinal oposto em outra conta, com valor igual e data próxima."
        : "Existem várias contrapartidas possíveis; o valor sozinho não identifica a operação.";
      a.decision =
        a.group === "card"
          ? "Confirme a conta de origem e o cartão. Pagamento de fatura não é uma nova despesa."
          : "Confirme origem e destino. Transferência própria não é receita nem despesa.";
      a.evidence = pair.map((o) => `${o.transaction_date} · ${o.description}`);
    } else if (card(text) && !exact.length && !later) {
      a.group = "card";
      a.reason =
        "A descrição indica pagamento de cartão, mas falta confirmar a contrapartida.";
      a.decision =
        "Escolha a conta/cartão correspondente; evite contar a fatura como uma nova despesa.";
    }
    // Sem classificação melhor, conta pelo sinal: saída é gasto, crédito é
    // entrada. Nada fica parado esperando conferência; remover desfaz.
    if (a.group === "unclear") {
      if (
        BigInt(r.amount_cents) > 0n &&
        incomeRules.some(
          (rule) =>
            rule.account_id === r.local_account_id &&
            text.includes(normalize(rule.match_text)),
        )
      ) {
        a.group = "income";
        a.reason =
          "Entrada compatível com uma regra de recebimento desta família.";
        a.decision = "Conta como entrada no mês de destino da regra.";
      } else if (BigInt(r.amount_cents) > 0n) {
        // Crédito sem transferência própria, fatura ou investimento (tratados
        // antes): entrada, inclusive estorno.
        a.group = "income";
        a.reason = "Crédito sem contrapartida em outra conta de vocês.";
        a.decision = "Conta como entrada. Se não for, remova.";
      } else if (BigInt(r.amount_cents) < 0n) {
        a.group = "expense";
        a.reason =
          "Saída sem indício de transferência própria, fatura ou investimento.";
        a.decision = "Conta como gasto. Se não for, remova.";
      }
    }
    // Status "pendente" do banco não segura nada: só o movimento que já foi
    // salvo e depois mudou (ou sumiu) fica marcado. Os não salvos seguem a
    // versão nova do banco ao serem lidos (storeObservations).
    if (r.changed || r.missing) {
      a.group = "pending";
      a.reason = r.missing
        ? "O banco deixou de retornar este movimento; ele saiu dos totais."
        : "O banco alterou um movimento já salvo.";
      a.decision = "Nada a fazer; o lançamento salvo foi preservado.";
    }
    a.semantic = investment(text)
      ? "Aplicação ou resgate"
      : card(text)
        ? "Pagamento de fatura"
        : exact.some((e) => e.kind === "transfer") || a.group === "transfer"
          ? "Transferência própria"
          : a.group === "income"
            ? "Recebimento previsto pela família"
            : /WISE|WIZE/.test(text) && BigInt(r.amount_cents) > 0n
              ? "Recebimento via Wise"
              : undefined;
    result.set(r.id, a);
  }
  return result;
}

export function incomeDate(payMonth: string, day = 25): string {
  const [year, month] = payMonth.split("-").map(Number);
  if (
    !/^\d{4}-\d{2}$/.test(payMonth) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 28
  )
    throw new Error("Regra de recebimento inválida.");
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() - 2);
  return date.toISOString().slice(0, 10);
}
export function followingMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

export function fifthBusinessDay(month: string): string {
  let date = month + "-01",
    count = 0;
  while (count < 5) {
    const d = new Date(date + "T00:00:00Z");
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) count++;
    if (count === 5) return date;
    d.setUTCDate(d.getUTCDate() + 1);
    date = d.toISOString().slice(0, 10);
  }
  return date;
}
