"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { readState } from "../src/server/state.ts";
import { formatted, brDate } from "../src/domain/format.ts";
import type { Currency } from "../src/domain/finance.ts";
import {
  movementGroup,
  movementRows,
  movementTitle,
  movementTotals,
  visibleMovements,
  type Movement,
  type MovementFilter,
} from "../src/domain/movements.ts";
import { categoryColor } from "../src/domain/category-color.ts";
import { CategoryIcon } from "./family-categories";
import { FamilyIcon } from "./family-extras";
import { Button } from "./ds/button";
import { MovementRowActions } from "./movements/row-actions";
import type { KindChoices } from "./movements/change-kind-dialog";
import {
  needsCategory,
  needsCounter,
  otherSide,
  type AdjustDraft,
} from "../src/domain/movement-kind.ts";
import { rowAction } from "./fixed/fixed-row-model.ts";
import { Collapsible } from "./collapsible";
import { Field } from "./field";
import { FamilyDialog } from "./dialogs/family-dialog";
import { StatusChip } from "./ds/status-chip";
import { Panel } from "./ds/panel";
import { Callout } from "./ds/callout";
import { Segmented } from "./ds/segmented";
import { Select } from "./ds/select";
import { ExpandingSearch } from "./ds/expanding-search";
import { Collapse } from "./ds/collapse";
import { cx } from "./ds/shared";
import { IconBadge } from "./ds/icon-badge";
import { Icon } from "./ds/icon";
import { Stat, Stats } from "./ds/stat";
import { TagPicker } from "./movements/tag-picker";
import { TriageBar } from "./movements/triage-bar";
import { TriageRowControls, type TriageRowMeta } from "./movements/triage-row";

const VALID_FILTERS = new Set<MovementFilter>([
  "all",
  "income",
  "expense",
  "transfer",
  "card",
  "fixed",
  "review",
]);

const filters: [MovementFilter, string][] = [
  ["all", "Todos"],
  ["expense", "Gastos"],
  ["income", "Entradas"],
  ["review", "A conferir"],
];

const labels: Record<string, string> = {
  income: "Entrada",
  expense: "Gasto",
  transfer: "Entre nossas contas",
  fx: "Câmbio",
  card_purchase: "Compra no crédito",
  card_payment: "Pagamento de fatura",
  fee: "Tarifa",
  investment_buy: "Investimento",
  investment_sell: "Resgate",
  yield: "Rendimento",
  refund: "Reembolso",
};

type State = Awaited<ReturnType<typeof readState>>;

async function postApiJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch("/api/" + path, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error || "Não foi possível concluir. Tente novamente.",
    );
  return data as T;
}

async function postApi(path: string, body: unknown): Promise<void> {
  await postApiJson<unknown>(path, body);
}

export function MovementsPanel({
  month,
  state,
  currency,
  hidden,
  reader,
  onRecord,
  refresh,
}: {
  month?: string;
  state: State;
  currency: Currency;
  hidden: boolean;
  reader: boolean;
  onRecord: () => void;
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  const [filter, setFilter] = useState<MovementFilter>("all");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");

  // Sincroniza ?filtro= e ?conta= (vindo de Mês / Nosso espaço → Contas).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("filtro") as MovementFilter | null;
    if (f && VALID_FILTERS.has(f)) {
      setFilter(f);
      if (f === "card" || f === "fixed" || f === "transfer") {
        setRefineOpen(true);
      }
    }
    const c = params.get("conta");
    if (c) {
      const matched = state.accounts.find((a) => a.id === c || a.name === c);
      if (matched) {
        setAccount(matched.name);
        setRefineOpen(true);
      }
    }
  }, [state.accounts]);

  type BtnState = "idle" | "loading" | "success" | "error";
  const [actionState, setActionState] = useState<Record<string, BtnState>>({});
  const FEEDBACK_HOLD_MS = 1400;

  type Categorizing = {
    id: string;
    bankId: string;
    version: number;
    description: string;
    key: string;
    category: string;
    eventId?: string;
    tagId?: string | null;
    tagName?: string | null;
  };
  const [categorizing, setCategorizing] = useState<Categorizing | null>(null);
  const [fixingId, setFixingId] = useState<string | null>(null);

  const pendingMeta = useMemo(() => {
    const m = new Map<
      string,
      TriageRowMeta & { tagId: string | null; tagName: string | null }
    >();
    for (const r of state.bankPending) {
      const confirmKind: "income" | "expense" | null =
        r.group === "income"
          ? "income"
          : r.group === "expense" || r.autospend
            ? "expense"
            : null;
      m.set("bankpending:" + r.id, {
        bankId: r.id,
        version: r.version,
        group: r.group,
        suggestedKey: r.suggested_key,
        suggestedCategory: r.suggested_category,
        categoryStrong: r.category_strong,
        tagId: r.tag_id,
        tagName: r.tag_name,
        blocked: r.blocked,
        duplicate: r.duplicate,
        accountKind: r.account_kind,
        confirmKind,
      });
    }
    return m;
  }, [state.bankPending]);

  async function runAction(
    action: () => Promise<void>,
    ok: string,
    onSuccess?: () => void,
    actionKey?: string,
  ) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    setActionNotice("");
    if (actionKey) setActionState((s) => ({ ...s, [actionKey]: "loading" }));
    try {
      await action();
      onSuccess?.();
      if (actionKey) {
        setActionState((s) => ({ ...s, [actionKey]: "success" }));
        setTimeout(
          () => setActionState((s) => ({ ...s, [actionKey]: "idle" })),
          FEEDBACK_HOLD_MS,
        );
      }
      await refresh();
      if (ok) setActionNotice(ok);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Tente novamente.");
      if (actionKey) {
        setActionState((s) => ({ ...s, [actionKey]: "error" }));
        setTimeout(
          () => setActionState((s) => ({ ...s, [actionKey]: "idle" })),
          FEEDBACK_HOLD_MS,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo<Movement[]>(() => movementRows(state), [state]);

  const kindAccounts = useMemo(
    () => state.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    [state.accounts],
  );
  const pendingSides = useMemo(
    () =>
      state.bankPending.flatMap((p) =>
        p.local_account_id
          ? [
              {
                id: p.id,
                accountId: p.local_account_id,
                date: p.transaction_date,
                cents: BigInt(p.amount_cents),
              },
            ]
          : [],
      ),
    [state.bankPending],
  );

  const kindChoicesFor = (row: Movement): KindChoices => ({
    accounts: kindAccounts,
    categories: state.categories,
    purchases: rows
      .filter(
        (p) =>
          p.kind === "card_purchase" &&
          p.id.startsWith("event:") &&
          p.id !== row.id &&
          p.accountId === row.accountId &&
          !p.removed &&
          -BigInt(p.amount) >= BigInt(row.amount),
      )
      .map((p) => ({
        id: p.id.slice("event:".length),
        name: `${movementTitle(p)} · ${brDate(p.date)}`,
      })),
  });

  const changeKindBody = (row: Movement, d: AdjustDraft) => ({
    event_id: row.id.slice("event:".length),
    kind: d.kind,
    counter_account_id: needsCounter(d.kind) ? d.counterAccountId : null,
    counter_bank_transaction_id:
      needsCounter(d.kind) && d.counterAccountId
        ? otherSide(pendingSides, d.counterAccountId, row.date, BigInt(row.amount))
        : null,
    related_event_id: d.kind === "refund" ? d.relatedEventId : null,
    category_name: needsCategory(d.kind)
      ? (state.categories.find((c) => c.id === d.categoryId)?.name ?? null)
      : null,
  });

  const totals = useMemo(() => movementTotals(rows), [rows]);

  // Fila unificada "A conferir": linhas de extrato importado (row.review) +
  // pendências bancárias ainda não confirmadas como evento (bankpending:*).
  const isTriageRow = useMemo(
    () => (row: Movement) =>
      row.review || (row.id.startsWith("bankpending:") && !row.removed),
    [],
  );

  const triageRows = useMemo(
    () => rows.filter(isTriageRow),
    [rows, isTriageRow],
  );
  const triageCount = triageRows.length;

  const batchEligible = useMemo(
    () =>
      state.bankPending.filter(
        (r) =>
          !r.blocked &&
          !r.duplicate &&
          r.account_kind !== "card" &&
          (r.group === "income" || r.group === "expense"),
      ),
    [state.bankPending],
  );
  const blockedPendingCount = useMemo(
    () => state.bankPending.filter((r) => r.blocked).length,
    [state.bankPending],
  );

  const filtered = useMemo(() => {
    if (filter === "review") {
      return visibleMovements(triageRows, {
        query,
        filter: "all",
        account,
        category,
        tag,
      });
    }
    return visibleMovements(rows, { query, filter, account, category, tag });
  }, [rows, triageRows, query, filter, account, category, tag]);

  const tagOptions = useMemo(
    () =>
      category
        ? [
            ...new Set(
              rows.flatMap((r) =>
                r.category === category && r.tag ? [r.tag] : [],
              ),
            ),
          ].sort((a, b) => a.localeCompare(b, "pt-BR"))
        : [],
    [rows, category],
  );
  const categories = useMemo(
    () =>
      [...new Set(rows.flatMap((r) => (r.category ? [r.category] : [])))].sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [rows],
  );
  const accounts = useMemo(
    () => [...new Set(rows.map((r) => r.account))].sort(),
    [rows],
  );
  const money = (amount: string) =>
    hidden ? "••••" : formatted(amount, currency);
  const groups = new Map<string, Movement[]>();
  for (const row of filtered.slice(0, limit))
    groups.set(row.date, [...(groups.get(row.date) ?? []), row]);

  const isSpecificType =
    filter === "card" || filter === "fixed" || filter === "transfer";
  const primaryFilter: MovementFilter = isSpecificType ? "all" : filter;

  const typeOptions = filters.filter(
    ([value]) => value !== "review" || triageCount > 0 || filter === "review",
  );
  const pickType = (value: MovementFilter) => {
    setFilter(value);
    setLimit(40);
  };

  const typeFilter = (
    <>
      <div className="max-w-full @max-[36rem]:hidden">
        <Segmented
          size="sm"
          fill
          label="Tipo de movimento"
          value={primaryFilter}
          options={typeOptions.map(([value, label]) => ({
            value,
            label,
            badge: value === "review" ? triageCount : undefined,
          }))}
          onChange={pickType}
        />
      </div>
      <Select
        size="sm"
        className="@min-[36rem]:hidden"
        aria-label="Tipo de movimento"
        value={primaryFilter}
        onChange={(e) => pickType(e.target.value as MovementFilter)}
      >
        {typeOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {value === "all"
              ? "Todos os tipos"
              : value === "review" && triageCount > 0
                ? `${label} (${triageCount})`
                : label}
          </option>
        ))}
      </Select>
    </>
  );

  const search = (
    <ExpandingSearch
      label="Buscar movimentos"
      placeholder="Buscar descrição, conta ou categoria"
      value={query}
      onChange={(value) => {
        setQuery(value);
        setLimit(40);
      }}
    />
  );

  const recordButton = (
    <Button
      type="button"
      variant="primary"
      size="sm"
      icon="plus"
      className="shrink-0"
      disabled={reader}
      onClick={onRecord}
    >
      Registrar
    </Button>
  );

  const refinements = (
    <div
      className={cx(
        "grid grid-cols-1 gap-2 sm:grid-cols-2",
        tagOptions.length > 0 ? "lg:grid-cols-4" : "lg:grid-cols-3",
      )}
    >
      <Select
        size="sm"
        aria-label="Tipo específico"
        value={isSpecificType ? filter : ""}
        onChange={(e) => {
          setFilter((e.target.value || "all") as MovementFilter);
          setLimit(40);
        }}
      >
        <option value="">Qualquer tipo</option>
        <option value="card">Compras no cartão</option>
        <option value="fixed">Contas fixas</option>
        <option value="transfer">Entre contas</option>
      </Select>
      <Select
        size="sm"
        aria-label="Filtrar por conta"
        value={account}
        onChange={(e) => {
          setAccount(e.target.value);
          setLimit(40);
        }}
      >
        <option value="">Todas as contas</option>
        {accounts.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </Select>
      <Select
        size="sm"
        aria-label="Filtrar por categoria"
        value={category}
        onChange={(e) => {
          setCategory(e.target.value);
          setTag("");
          setLimit(40);
        }}
      >
        <option value="">Todas as categorias</option>
        {categories.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </Select>
      {tagOptions.length > 0 && (
        <Select
          size="sm"
          aria-label="Filtrar por etiqueta"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setLimit(40);
          }}
        >
          <option value="">Todas as etiquetas</option>
          {tagOptions.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      )}
    </div>
  );

  const refineCount = [
    account,
    category,
    tag,
    isSpecificType ? filter : "",
  ].filter(Boolean).length;
  const targetMonth = month ?? state.month;

  return (
    <div className="flex flex-col gap-5">
      <Stats label="Resumo dos movimentos confirmados">
        <Stat
          icon="in"
          tone="ok"
          title="Entradas"
          value={money(totals.income)}
          rows={[
            ...(BigInt(totals.income) !== 0n &&
            BigInt(state.summary.income_expected_cents) !== 0n
              ? [{ label: "Já entrou", value: money(totals.income) }]
              : []),
            ...state.summary.income_expected.map((r) => ({
              label:
                "Previsto · " +
                r.label +
                (r.due_date ? ` · ${brDate(r.due_date).slice(0, 5)}` : ""),
              value: money(r.cents),
            })),
          ]}
        />
        <Stat
          icon="out"
          tone="danger"
          title="Saídas"
          value={money(state.summary.expense_cents)}
        />
      </Stats>

      {state.cardBudgetUnconfigured.length > 0 && (
        <Callout
          icon="💳"
          tone="warn"
          title="Compras de cartão no mês da compra"
        >
          Alguns cartões ainda não têm fechamento e vencimento informados. As
          compras deles aparecem no mês em que foram feitas, e podem mudar de
          mês quando você informar em Nosso espaço → Contas e cartões.
        </Callout>
      )}

      {actionError && (
        <p
          role="alert"
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
        >
          {actionError}
        </p>
      )}
      {actionNotice && (
        <p
          role="status"
          className="m-0 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-sm font-medium text-ok"
        >
          {actionNotice}
        </p>
      )}

      {triageCount > 0 && filter !== "review" && (
        <Callout
          icon="?"
          tone="accent"
          title={`${triageCount} ${
            triageCount === 1
              ? "movimento aguardando conferência"
              : "movimentos aguardando conferência"
          }`}
          meta="Revise categorias sugeridas ou confirme o que o banco leu."
        >
          <div className="mt-2">
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                setFilter("review");
                setLimit(40);
              }}
            >
              Abrir fila A conferir
            </Button>
          </div>
        </Callout>
      )}

      <section aria-label="Buscar e filtrar movimentos">
        <Panel className="mb-0">
          <div className="@container flex flex-col gap-3">
            <div className="min-w-0">{typeFilter}</div>
            <div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="ui-btn inline-flex h-8.5 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[0.8125rem] font-medium text-muted transition-colors hover:bg-accent-soft hover:text-accent-ink aria-expanded:bg-accent-soft aria-expanded:text-accent-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-expanded={refineOpen}
                  aria-controls="movements-refine"
                  onClick={() => setRefineOpen((v) => !v)}
                >
                  <span>Refinar</span>
                  {refineCount > 0 && (
                    <span className="ml-0.5 inline-grid min-w-4 place-items-center rounded-full bg-accent-soft px-1.5 py-0.5 font-numeric text-[0.6875rem] leading-none font-semibold text-accent-ink tabular-nums">
                      {refineCount}
                    </span>
                  )}
                  <Icon
                    name="down"
                    size={14}
                    className={cx(
                      "opacity-75 transition-transform duration-(--ds-dur)",
                      refineOpen && "rotate-180",
                    )}
                  />
                </button>
                {search}
                {recordButton}
              </div>
              <Collapse id="movements-refine" open={refineOpen}>
                <div className="pt-2.5">{refinements}</div>
              </Collapse>
            </div>
          </div>
        </Panel>
      </section>

      {filter === "review" && (
        <TriageBar
          eligibleCount={batchEligible.length}
          blockedCount={blockedPendingCount}
          reader={reader}
          busy={busy}
          batchState={actionState["batch"]}
          onConfirmAll={() => {
            if (!targetMonth) return;
            void runAction(
              async () => {
                const res = await postApiJson<{
                  recorded: number;
                  skipped: number;
                  eligible: number;
                }>("banks/review-batch", {
                  month: targetMonth,
                  currency,
                });
                setActionNotice(
                  res.recorded > 0
                    ? `${res.recorded} ${
                        res.recorded === 1
                          ? "movimento confirmado."
                          : "movimentos confirmados."
                      }${
                        res.skipped > 0
                          ? ` ${res.skipped} precisaram ficar para conferência manual.`
                          : ""
                      }`
                    : "Nenhum movimento elegível para confirmação automática.",
                );
              },
              "",
              undefined,
              "batch",
            );
          }}
        />
      )}

      <Panel
        title={filter === "review" ? "Fila A conferir" : "Histórico do mês"}
        meta={`${filtered.length} ${
          filtered.length === 1 ? "movimento" : "movimentos"
        }`}
        className="mb-0"
      >
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            {filter === "review" ? (
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-ok-bg text-ok">
                <Icon name="check" size={18} />
              </span>
            ) : (
              <FamilyIcon name="movements" />
            )}
            <h3 className="m-0 text-sm font-semibold text-ink">
              {filter === "review"
                ? "Tudo conferido neste mês"
                : "Nenhum movimento por aqui"}
            </h3>
            <p className="ds-caption max-w-md">
              {filter === "review"
                ? "Não há movimentos bancários pendentes ou linhas de extrato aguardando decisão."
                : filter === "fixed" && rows.length > 0
                  ? "Nenhum movimento de conta fixa por aqui. Gastos ligados a uma conta fixa aparecem neste filtro."
                  : rows.length
                    ? "Tente outra busca ou retire os filtros."
                    : "Os registros deste mês vão aparecer aqui."}
            </p>
            {(rows.length > 0 && filter !== "all") || refineCount > 0 || query ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setAccount("");
                  setCategory("");
                  setTag("");
                  setFilter("all");
                }}
              >
                {filter === "review" ? "Ver todos os movimentos" : "Limpar filtros"}
              </Button>
            ) : null}
          </div>
        )}

        {[...groups].map(([date, entries]) => (
          <section key={date} aria-label={"Movimentos de " + brDate(date)}>
            <h3 className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              {new Intl.DateTimeFormat("pt-BR", {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00:00Z"))}
            </h3>
            <div className="flex flex-col divide-y divide-border">
              {entries.map((row) => {
                const type = movementGroup(row);
                const neutral = [
                  "transfer",
                  "fx",
                  "card_payment",
                  "investment_buy",
                  "investment_sell",
                ].includes(row.kind ?? "");
                const amount = BigInt(row.amount);
                const rowMeta =
                  row.source === "bank" ? pendingMeta.get(row.id) : undefined;
                const isConfirmedEvent =
                  row.id.startsWith("event:") && type !== "transfer";
                const canReopenCategory =
                  !reader && ((!!rowMeta && !neutral) || isConfirmedEvent);
                const openCategorize = () => {
                  if (rowMeta)
                    setCategorizing({
                      id: row.id,
                      bankId: row.id.slice("bankpending:".length),
                      version: rowMeta.version,
                      description: row.description,
                      key: rowMeta.suggestedKey,
                      category: rowMeta.suggestedCategory,
                      tagId: rowMeta.tagId,
                      tagName: rowMeta.tagName,
                    });
                  else if (isConfirmedEvent)
                    setCategorizing({
                      id: row.id,
                      bankId: "",
                      version: 0,
                      description: row.description,
                      key: "",
                      category:
                        row.category ?? state.categories[0]?.name ?? "",
                      eventId: row.id.slice("event:".length),
                      tagId:
                        state.events.find(
                          (ev) => "event:" + ev.id === row.id,
                        )?.tag_id ?? null,
                      tagName: row.tag ?? null,
                    });
                };
                const bankMeta =
                  row.source === "bank" ? pendingMeta.get(row.id) : undefined;
                const hasCategory =
                  type !== "transfer" && !row.review && !!row.category;
                const symbolTone = row.review
                  ? "warn"
                  : neutral
                    ? "neutral"
                    : amount > 0n
                      ? "ok"
                      : "danger";
                const savedLabel =
                  actionState["kind:" + row.id] === "success"
                    ? "Tipo corrigido"
                    : actionState["restore:" + row.id] === "success"
                      ? "Voltou a contar"
                      : actionState["reject:" + row.id] === "success" &&
                          row.removed
                        ? "Removido"
                        : null;

                return (
                  <div className="relative" key={row.id}>
                    <Collapsible
                      className={cx(
                        "rounded-none border-0 bg-transparent [&_summary]:px-0 [&_summary]:py-3 [&_summary]:pr-11",
                        row.removed && "opacity-60",
                      )}
                      arrow={false}
                      summary={
                        <>
                          <IconBadge
                            tone={hasCategory ? undefined : symbolTone}
                            {...(hasCategory
                              ? {
                                  "data-cat": "",
                                  style: {
                                    "--tone": categoryColor(row.category!),
                                    "--badge-color": categoryColor(
                                      row.category!,
                                    ),
                                  } as CSSProperties,
                                }
                              : {})}
                            className={
                              canReopenCategory ? "cursor-pointer" : undefined
                            }
                            icon={
                              type === "transfer" ? (
                                <FamilyIcon name="movements" />
                              ) : row.review ? (
                                <span aria-hidden="true">?</span>
                              ) : row.category ? (
                                <CategoryIcon name={row.category} />
                              ) : (
                                <span aria-hidden="true">
                                  {neutral ? "↔" : amount > 0n ? "↙" : "↗"}
                                </span>
                              )
                            }
                            role={canReopenCategory ? "button" : undefined}
                            tabIndex={canReopenCategory ? 0 : undefined}
                            title={
                              canReopenCategory
                                ? "Corrigir categoria"
                                : undefined
                            }
                            data-editable={canReopenCategory || undefined}
                            onClick={
                              canReopenCategory
                                ? (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openCategorize();
                                  }
                                : undefined
                            }
                            onKeyDown={
                              canReopenCategory
                                ? (e) => {
                                    if (e.key !== "Enter" && e.key !== " ")
                                      return;
                                    e.preventDefault();
                                    openCategorize();
                                  }
                                : undefined
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <strong
                              className={cx(
                                "line-clamp-2 text-sm font-medium text-ink",
                                row.removed && "line-through",
                              )}
                            >
                              {movementTitle(row)}
                            </strong>
                            {row.name && row.name !== row.description && (
                              <small className="block pt-0.5 text-xs text-muted">
                                {row.description}
                              </small>
                            )}
                            <small className="flex flex-wrap items-center gap-1.5 pt-1.5 text-xs text-muted">
                              {row.scheduled ? (
                                <StatusChip
                                  tone="warn"
                                  label="Agendado · ainda não debitado"
                                />
                              ) : row.cardLabel ? (
                                <StatusChip icon="" label={row.cardLabel} />
                              ) : (
                                <span>{row.account}</span>
                              )}
                              {row.fixed && (
                                <StatusChip
                                  ghost
                                  tone="accent"
                                  icon="↻"
                                  label="Conta fixa"
                                />
                              )}
                              {row.tag && (
                                <StatusChip ghost icon="" label={row.tag} />
                              )}
                              {row.removed && (
                                <StatusChip
                                  ghost
                                  tone="warn"
                                  icon=""
                                  label="Fora dos totais"
                                />
                              )}
                              {savedLabel && (
                                <StatusChip
                                  tone="ok"
                                  icon="✓"
                                  label={savedLabel}
                                />
                              )}
                            </small>
                            {row.review && (
                              <em className="mt-1 block text-xs font-medium text-warn not-italic">
                                {row.duplicate
                                  ? "Possível repetição · a conferir"
                                  : "A conferir"}
                              </em>
                            )}
                          </span>
                          <strong
                            className={cx(
                              "font-numeric text-sm font-semibold whitespace-nowrap tabular-nums",
                              row.review || neutral || row.removed
                                ? "text-muted"
                                : amount > 0n
                                  ? "text-ok"
                                  : "text-ink",
                            )}
                          >
                            {money(row.amount)}
                          </strong>
                        </>
                      }
                    >
                      <dl className="grid gap-1.5 rounded-xl bg-surface-2/60 p-3 text-xs">
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted">Tipo</dt>
                          <dd className="m-0 font-medium text-ink">
                            {row.review
                              ? "Finalidade a confirmar"
                              : (labels[row.kind ?? ""] ?? "Movimento")}
                            {row.auto && !row.review && (
                              <span className="text-muted"> · decidido pelo app</span>
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted">Data</dt>
                          <dd className="m-0 font-medium text-ink">
                            {brDate(row.date)}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-muted">Situação</dt>
                          <dd className="m-0 text-right font-medium text-ink">
                            {row.removed === "bank"
                              ? "O banco não traz mais · fora dos totais"
                              : row.removed
                                ? "Removido · fora dos totais"
                                : row.scheduled
                                  ? "Agendado · já conta como gasto do mês"
                                  : row.cardLabel
                                    ? "Compra no cartão · Entra na fatura"
                                    : row.review
                                      ? "Em revisão · fora dos totais"
                                      : neutral
                                        ? "Entre contas · não conta nos totais"
                                        : "Confirmado"}
                          </dd>
                        </div>
                      </dl>
                      {row.removed === "bank" && (
                        <p className="ds-caption mt-2">
                          O banco não traz mais este movimento. Ele volta sozinho
                          se reaparecer.
                        </p>
                      )}
                    </Collapsible>

                    {filter === "review" && bankMeta && !row.removed && (
                      <TriageRowControls
                        meta={bankMeta}
                        reader={reader}
                        busy={busy}
                        confirmState={actionState["confirm:" + row.id]}
                        onEditCategory={openCategorize}
                        onConfirm={() => {
                          if (!bankMeta.confirmKind) return;
                          void runAction(
                            () =>
                              postApi("banks/review", {
                                id: bankMeta.bankId,
                                version: bankMeta.version,
                                decision: "record",
                                kind: bankMeta.confirmKind,
                                category_name: bankMeta.suggestedCategory,
                                learn_match_text:
                                  bankMeta.suggestedKey.length >= 3
                                    ? bankMeta.suggestedKey
                                    : undefined,
                              }),
                            `Confirmado em ${bankMeta.suggestedCategory}.`,
                            undefined,
                            "confirm:" + row.id,
                          );
                        }}
                      />
                    )}

                    <MovementRowActions
                      fixedOpen={fixingId === row.id}
                      onFixedClose={() => setFixingId(null)}
                      row={row}
                      categories={state.categories}
                      reader={reader}
                      canReject={!!bankMeta || row.id.startsWith("event:")}
                      busy={busy}
                      error={actionError}
                      rejectState={actionState["reject:" + row.id]}
                      onReject={(note, close) =>
                        void runAction(
                          () =>
                            bankMeta
                              ? postApi("banks/review", {
                                  id: row.id.slice("bankpending:".length),
                                  version: bankMeta.version,
                                  decision: "ignore",
                                  note,
                                })
                              : postApi("events/cancel", {
                                  event_id: row.id.slice("event:".length),
                                  reason: note,
                                }),
                          "Movimento removido dos totais.",
                          close,
                          "reject:" + row.id,
                        )
                      }
                      kindChoices={kindChoicesFor(row)}
                      kindState={actionState["kind:" + row.id]}
                      onChangeKind={(draft, close) =>
                        void runAction(
                          () => postApi("events/kind", changeKindBody(row, draft)),
                          "Tipo corrigido.",
                          close,
                          "kind:" + row.id,
                        )
                      }
                      onRestore={() =>
                        void runAction(
                          () =>
                            postApi("events/restore", {
                              event_id: row.id.slice("event:".length),
                            }),
                          "Movimento voltou a contar.",
                          undefined,
                          "restore:" + row.id,
                        )
                      }
                      renameState={actionState["rename:" + row.id]}
                      onRename={(name, close) =>
                        void runAction(
                          () =>
                            postApi("events/rename", {
                              event_id: row.id.slice("event:".length),
                              name,
                            }),
                          name ? "Nome atualizado." : "Nome original restaurado.",
                          close,
                          "rename:" + row.id,
                        )
                      }
                      onGoToReview={() => {
                        setFilter("review");
                        setLimit(40);
                      }}
                      refresh={refresh}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {filtered.length > limit && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLimit((value) => value + 40)}
          >
            Ver mais {Math.min(40, filtered.length - limit)} movimentos
          </Button>
        )}
      </Panel>

      <p className="ds-caption px-1 text-xs leading-relaxed">
        Toque em um movimento para ver os detalhes. Os dois lados de
        transferências podem aparecer nas contas de origem e destino; quando
        vinculados, representam uma única operação.
      </p>

      <FamilyDialog
        open={!!categorizing}
        title="Categorizar transação"
        description={categorizing?.description}
        busy={busy}
        error={actionError}
        onClose={() => setCategorizing(null)}
      >
        {categorizing && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const c = categorizing;
              const learn = c.key.trim();
              void runAction(
                () =>
                  c.eventId
                    ? postApi("events/categorize", {
                        event_id: c.eventId,
                        category_name: c.category,
                        learn_match_text: learn.length >= 3 ? learn : null,
                        tag_id: c.tagId ?? null,
                      })
                    : (async () => {
                        await postApi("banks/learn-category", {
                          match_text: c.key,
                          category_name: c.category,
                        });
                        const before = pendingMeta.get(c.id)?.tagId ?? null;
                        if ((c.tagId ?? null) !== before)
                          await postApi("banks/tag", {
                            bank_transaction_id: c.bankId,
                            tag_id: c.tagId ?? null,
                          });
                      })(),
                c.eventId
                  ? learn.length >= 3
                    ? `Categorizado em ${c.category}${c.tagId && c.tagName ? ` · ${c.tagName}` : ""}. Vou lembrar de "${learn}".`
                    : `Categorizado em ${c.category}${c.tagId && c.tagName ? ` · ${c.tagName}` : ""}.`
                  : `Categorizado em ${c.category}${c.tagId && c.tagName ? ` · ${c.tagName}` : ""}. Vou lembrar de "${c.key}".`,
                () => setCategorizing(null),
                "categorize",
              );
            }}
          >
            <Field label="Categoria">
              <Select
                value={categorizing.category}
                onChange={(e) =>
                  setCategorizing((c) =>
                    c
                      ? {
                          ...c,
                          category: e.target.value,
                          tagId: null,
                          tagName: null,
                        }
                      : c,
                  )
                }
              >
                {[
                  ...new Set([
                    categorizing.category,
                    ...state.categories.map((c) => c.name),
                  ]),
                ].map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            {(() => {
              const cat = state.categories.find(
                (c) => c.name === categorizing.category,
              );
              if (!cat) return null;
              return (
                <TagPicker
                  category={cat}
                  chosen={
                    categorizing.tagId && categorizing.tagName
                      ? { id: categorizing.tagId, name: categorizing.tagName }
                      : null
                  }
                  busy={busy}
                  onChange={(tag) =>
                    setCategorizing((c) =>
                      c
                        ? {
                            ...c,
                            tagId: tag?.id ?? null,
                            tagName: tag?.name ?? null,
                          }
                        : c,
                    )
                  }
                  createTag={(categoryId, name) =>
                    postApiJson<{ id: string; name: string }>(
                      "categories/tags",
                      { category_id: categoryId, name },
                    )
                  }
                />
              );
            })()}
            <Field
              label={
                categorizing.eventId
                  ? "Lembrar deste texto nessa categoria (opcional)"
                  : "Lembrar deste texto nessa categoria"
              }
              hint={
                categorizing.eventId
                  ? "Preenchido, toda transação com este texto vai para essa categoria. Em branco, muda só este movimento."
                  : "Toda transação com este texto na descrição vai para essa categoria."
              }
            >
              <input
                className="input w-full"
                value={categorizing.key}
                minLength={categorizing.eventId ? undefined : 3}
                maxLength={120}
                required={!categorizing.eventId}
                placeholder={
                  categorizing.eventId
                    ? "Deixe em branco para só este"
                    : undefined
                }
                onChange={(e) =>
                  setCategorizing((c) =>
                    c ? { ...c, key: e.target.value } : c,
                  )
                }
              />
            </Field>
            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {(() => {
                const target = rows.find((r) => r.id === categorizing.id);
                return !reader && target && rowAction(target) ? (
                  <Button
                    variant="quiet"
                    icon="↻"
                    className="w-full sm:w-auto"
                    disabled={busy}
                    onClick={() => {
                      setCategorizing(null);
                      setFixingId(target.id);
                    }}
                  >
                    Tornar conta fixa
                  </Button>
                ) : null;
              })()}
              <Button
                type="submit"
                variant="primary"
                className="w-full sm:ml-auto sm:w-auto"
                state={actionState["categorize"]}
                busyLabel="Salvando…"
                successLabel="Salvo ✓"
              >
                Salvar categoria
              </Button>
            </div>
          </form>
        )}
      </FamilyDialog>
    </div>
  );
}
