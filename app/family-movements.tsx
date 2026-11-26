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
import { Button } from "./button";
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

const filters: [MovementFilter, string][] = [
  ["all", "Todos"],
  ["income", "Entradas"],
  ["expense", "Gastos"],
  ["transfer", "Entre contas"],
  ["card", "Cartão"],
  ["fixed", "Fixas"],
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
  state,
  currency,
  hidden,
  reader,
  onRecord,
  refresh,
}: {
  state: State;
  currency: Currency;
  hidden: boolean;
  reader: boolean;
  onRecord: () => void;
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [refineOpen, setRefineOpen] = useState(false);
  // TEMPORÁRIO (comparação de layouts): ?filtros=a|b|c. Lido depois de montar
  // para não divergir do HTML do servidor.
  const [filterLayout, setFilterLayout] = useState<"a" | "b" | "c">("c");
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("filtros");
    if (v === "a" || v === "b" || v === "c") setFilterLayout(v);
  }, []);
  const [filter, setFilter] = useState<MovementFilter>("all");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [limit, setLimit] = useState(40);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  // Estado visual por botão (chave livre): loading enquanto roda, success/error
  // ao fim. As ações são locais (PGlite) e respondem num piscar, então o
  // success/error é SEGURADO por um tempo mínimo para ser visível (evita o
  // "blink"); o chamador volta ao idle depois desse hold.
  type BtnState = "idle" | "loading" | "success" | "error";
  const [actionState, setActionState] = useState<Record<string, BtnState>>({});
  const FEEDBACK_HOLD_MS = 1400;
  // Categorização via modal: a transação sendo categorizada (ou null). O ícone
  // de categoria de um gasto do banco abre este modal; nada de campos inline.
  // eventId presente => recategorizar um movimento JÁ CONFIRMADO (chama
  // events/categorize com o event_id). Ausente => fluxo do banco pendente
  // (banks/learn-category pela chave de texto). "Lembrar deste texto" é
  // obrigatório no banco e opcional no evento confirmado.
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
  // Linha cujo "Tornar conta fixa" foi aberto pelo diálogo de categoria.
  const [fixingId, setFixingId] = useState<string | null>(null);
  // Map "bankpending:<id>" -> meta para as ações inline (versão, grupo e a
  // sugestão de aprendizado: chave + categoria para o card confirmar).
  const pendingMeta = useMemo(() => {
    const m = new Map<
      string,
      {
        version: number;
        group: string | null;
        suggestedKey: string;
        suggestedCategory: string;
        categoryStrong: boolean;
        tagId: string | null;
        tagName: string | null;
      }
    >();
    for (const r of state.bankPending)
      m.set("bankpending:" + r.id, {
        version: r.version,
        group: r.group,
        suggestedKey: r.suggested_key,
        suggestedCategory: r.suggested_category,
        categoryStrong: r.category_strong,
        tagId: r.tag_id,
        tagName: r.tag_name,
      });
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
      // Feedback local antes do refresh (que pode remontar/recolher o card).
      onSuccess?.();
      if (actionKey) {
        setActionState((s) => ({ ...s, [actionKey]: "success" }));
        // Segura o success por um tempo mínimo e então volta ao idle: as ações
        // locais respondem num piscar; sem o hold o ✓ sumiria antes de ser visto.
        setTimeout(
          () => setActionState((s) => ({ ...s, [actionKey]: "idle" })),
          FEEDBACK_HOLD_MS,
        );
      }
      await refresh();
      // ok === "" => a ação já definiu a própria mensagem (ex.: lote com contagem).
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
  const rows = useMemo<Movement[]>(
    () => movementRows(state),
    [state],
  );
  // Escolhas do "Mudar tipo": contas, categorias e, por linha, as compras que
  // um estorno pode apontar. Linhas do banco pendentes viram a outra ponta de
  // um par quando há exatamente uma que casa (otherSide).
  const kindAccounts = useMemo(
    () => state.accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    [state.accounts],
  );
  const pendingSides = useMemo(
    () =>
      state.bankPending.flatMap((p) =>
        p.local_account_id
          ? [{ id: p.id, accountId: p.local_account_id, date: p.transaction_date, cents: BigInt(p.amount_cents) }]
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
      .map((p) => ({ id: p.id.slice("event:".length), name: `${movementTitle(p)} · ${brDate(p.date)}` })),
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
  const filtered = useMemo(
    () => visibleMovements(rows, { query, filter, account, category, tag }),
    [rows, query, filter, account, category, tag],
  );
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
  // ----- Peças do bloco de filtros (a distribuição depende de filterLayout).
  // Tipo: o recorte principal. `fill` = linha própria, abas divididas por igual.
  // "A conferir" só existe para linhas de extrato importado.
  const typeOptions = filters.filter(
    ([value]) => value !== "review" || totals.review > 0 || filter === "review",
  );
  const pickType = (value: MovementFilter) => {
    setFilter(value);
    setLimit(40);
  };
  // As abas precisam de ~32rem; abaixo disso (container query no bloco de
  // filtros, não na tela) o tipo vira um Select — nada cortado, sem rolagem
  // lateral escondida.
  const typeFilter = (fill: boolean) => (
    <>
      <div className="max-w-full @max-[32rem]:hidden">
        <Segmented
          size="sm"
          fill={fill}
          label="Tipo de movimento"
          value={filter}
          options={typeOptions.map(([value, label]) => ({ value, label }))}
          onChange={pickType}
        />
      </div>
      <Select
        size="sm"
        className="@min-[32rem]:hidden"
        aria-label="Tipo de movimento"
        value={filter}
        onChange={(e) => pickType(e.target.value as MovementFilter)}
      >
        {typeOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {value === "all" ? "Todos os tipos" : label}
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
  // Registrar é AÇÃO, não filtro: sempre o último item da linha, isolado.
  const recordButton = (
    <Button
      type="button"
      variant="primary"
      className="btn-circle shrink-0"
      disabled={reader}
      onClick={onRecord}
      aria-label="Registrar movimento"
    >
      <Icon name="plus" size={20} />
    </Button>
  );
  // Refinamentos (conta, categoria, etiqueta): grade que põe quantos couberem
  // por linha (mín. 10rem cada) e quebra sozinha — 2 ou 3 campos, sem apertar.
  const refinements = (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(10rem,100%),1fr))]">
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
  const refineCount = [account, category, tag].filter(Boolean).length;
  const refineShown = refineOpen || refineCount > 0;

  return (
    <div className="ds-list">
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
          rows={(
            [
              ["Saiu da conta", state.summary.expense_left_cents],
              ["Agendado", state.summary.expense_scheduled_cents],
              [
                "No cartão, sai ao pagar a fatura",
                state.summary.expense_card_cents,
              ],
            ] as const
          )
            .filter(([, cents]) => BigInt(cents) !== 0n)
            .map(([label, cents]) => ({ label, value: money(cents) }))}
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
          mês quando você informar. Informe em Perfil, Bancos.
        </Callout>
      )}
      {actionError && (
        <p role="alert" className="ds-caption alert alert-soft alert-error">
          {actionError}
        </p>
      )}
      {actionNotice && (
        <p role="status" className="ds-caption alert alert-soft alert-success">
          {actionNotice}
        </p>
      )}
      {totals.review > 0 && (
        <Callout
          icon="?"
          tone="warn"
          title={`${totals.review} a conferir`}
          meta="Linhas de extratos importados, ainda fora dos totais."
        >
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setFilter("review");
              setLimit(40);
            }}
          >
            Ver
          </Button>
        </Callout>
      )}
      <section aria-label="Buscar e filtrar movimentos">
        <Panel>
          <div className="@container flex flex-col gap-2">
          {filterLayout === "a" ? (
            /* A · Busca em cima: busca sempre aberta + registrar; tipo com
               linha própria; refinamentos numa grade que quebra sozinha. */
            <>
              <div className="flex items-center gap-2">
                <label className="input min-w-0 flex-1">
                  <Icon name="search" size={18} className="opacity-50" />
                  <span className="sr-only">Buscar movimentos</span>
                  <input
                    type="search"
                    className="grow"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(40);
                    }}
                    placeholder="Buscar descrição, conta ou categoria"
                  />
                </label>
                {recordButton}
              </div>
              <div className="min-w-0">{typeFilter(true)}</div>
              {refinements}
            </>
          ) : filterLayout === "b" ? (
            /* B · Tipo em destaque: tipo · lupa · registrar; refinamentos
               numa grade abaixo. */
            <>
              <div className="flex items-center gap-2">
                <div className="ds-search-sibling min-w-0">
                  {typeFilter(false)}
                </div>
                {search}
                {recordButton}
              </div>
              {refinements}
            </>
          ) : (
            /* C · Refinar sob demanda: tipo com linha própria (recorte
               principal); linha de ferramentas com "Refinar", lupa (com a
               linha livre para abrir) e registrar; conta/categoria/etiqueta
               recolhidas até pedir, com contador quando ativas. */
            <>
              <div className="min-w-0">{typeFilter(true)}</div>
              {/* Ferramentas + refinamentos num bloco só: recolhido, o painel
                  não deixa o gap do cartão sobrando embaixo. */}
              <div>
              <div className="flex items-center gap-2">
                {/* Controle terciário: sem fundo (só um tom no hover), 32px,
                    13px/500 — não compete com a lupa nem com o registrar. */}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0 -ml-2 gap-0 px-2 text-[0.8125rem] font-medium text-base-content/70 hover:bg-[var(--color-primary-tint)] hover:text-[var(--color-primary-ink)] aria-expanded:text-[var(--color-primary-ink)]"
                  aria-expanded={refineShown}
                  aria-controls="movements-refine"
                  onClick={() => setRefineOpen(!refineShown)}
                >
                  Refinar
                  {refineCount > 0 && (
                    <span className="ml-1.5 inline-grid min-w-4 place-items-center rounded-full bg-[var(--color-primary-tint)] px-1 text-[0.6875rem] leading-4 font-semibold text-[var(--color-primary-ink)] tabular-nums">
                      {refineCount}
                    </span>
                  )}
                  <Icon
                    name="down"
                    size={14}
                    className={cx(
                      "ml-1 opacity-70 transition-transform duration-(--ds-dur)",
                      refineShown && "rotate-180",
                    )}
                  />
                </button>
                {search}
                {recordButton}
              </div>
              <Collapse id="movements-refine" open={refineShown}>
                <div className="pt-2">{refinements}</div>
              </Collapse>
              </div>
            </>
          )}
          </div>
        </Panel>
      </section>
      <Panel
        title="Histórico do mês"
        meta={`${filtered.length} ${filtered.length === 1 ? "movimento" : "movimentos"}`}
      >
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <FamilyIcon name="movements" />
            <h3 className="text-sm font-medium">Nenhum movimento por aqui</h3>
            <p className="ds-caption">
              {filter === "fixed" && rows.length > 0
                ? "Nenhum movimento de conta fixa por aqui. Gastos ligados a uma conta fixa aparecem neste filtro."
                : rows.length
                  ? "Tente outra busca ou retire os filtros."
                  : "Os registros deste mês vão aparecer aqui."}
            </p>
            {rows.length > 0 && (
              <Button
                onClick={() => {
                  setQuery("");
                  setAccount("");
                  setCategory("");
                  setTag("");
                  setFilter("all");
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        )}
        {[...groups].map(([date, entries]) => (
          <section
            key={date}
            aria-label={"Movimentos de " + brDate(date)}
          >
            <h3 className="mb-1 text-xs font-semibold uppercase opacity-60">
              {new Intl.DateTimeFormat("pt-BR", {
                day: "numeric",
                month: "long",
                timeZone: "UTC",
              }).format(new Date(date + "T12:00:00Z"))}
            </h3>
            <div className="ds-list list gap-0 divide-y divide-base-200">
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
                // Ícone de categoria é o gatilho do modal de categorização: vale
                // para gasto do banco (PIX autospend ou pendente), com ou sem
                // categoria. Reader não categoriza.
                const rowMeta =
                  row.source === "bank" ? pendingMeta.get(row.id) : undefined;
                // Qualquer movimento do banco (categorizado ou não, bloqueado,
                // cartão) OU qualquer evento JÁ CONFIRMADO (débito, crédito,
                // estorno, compra de cartão...) pode ter a categoria editada.
                // Transferências entre contas não têm categoria própria.
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
                      category: row.category ?? state.categories[0]?.name ?? "",
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
                // Aviso na própria linha (o aviso global fica fora de vista).
                const savedLabel =
                  actionState["kind:" + row.id] === "success"
                    ? "Tipo corrigido"
                    : actionState["restore:" + row.id] === "success"
                      ? "Voltou a contar"
                      : actionState["reject:" + row.id] === "success" && row.removed
                        ? "Removido"
                        : null;
                return (
                  <div className="relative" key={row.id}>
                    <Collapsible
                      // A lista do dia já tem borda e fundo: a linha não repete.
                      className={
                        "rounded-none border-0 bg-transparent [&_summary]:pr-14" +
                        (row.removed ? " opacity-60" : "")
                      }
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
                            role={canReopenCategory ? "Button" : undefined}
                            tabIndex={canReopenCategory ? 0 : undefined}
                            title={
                              canReopenCategory ? "Corrigir categoria" : undefined
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
                              className={
                                "line-clamp-2 text-sm font-medium" +
                                (row.removed ? " line-through" : "")
                              }
                            >
                              {movementTitle(row)}
                            </strong>
                            {row.name && row.name !== row.description && (
                              <small className="block text-xs opacity-60 pt-1">
                                {row.description}
                              </small>
                            )}
                            <small className="block text-xs opacity-60 pt-2">
                              {row.scheduled ? (
                                <StatusChip
                                  tone="warn"
                                  label=" Agendado · ainda não debitado "
                                />
                              ) : row.cardLabel ? (
                                <StatusChip icon="" label={row.cardLabel} />
                              ) : (
                                row.account
                              )}
                              {row.fixed && (
                                <StatusChip
                                  className="ml-1.5"
                                  ghost
                                  tone="accent"
                                  icon="↻"
                                  label="Conta fixa"
                                />
                              )}
                              {row.tag && (
                                <StatusChip
                                  className="ml-1.5"
                                  ghost
                                  icon=""
                                  label={row.tag}
                                />
                              )}
                              {row.removed && (
                                <StatusChip
                                  className="ml-1.5"
                                  ghost
                                  tone="warn"
                                  icon=""
                                  label="Fora dos totais"
                                />
                              )}
                              {savedLabel && (
                                <StatusChip
                                  className="ml-1.5"
                                  tone="ok"
                                  icon="✓"
                                  label={savedLabel}
                                />
                              )}
                            </small>
                            {row.review && (
                              <em className="block text-xs text-warning not-italic">
                                {row.duplicate
                                  ? "Possível repetição · a conferir"
                                  : "A conferir"}
                              </em>
                            )}
                          </span>
                          <strong
                            className={
                              "text-sm font-medium whitespace-nowrap tabular-nums" +
                              (row.review || neutral || row.removed
                                ? " opacity-60"
                                : amount > 0n
                                  ? " text-success"
                                  : "")
                            }
                          >
                            {money(row.amount)}
                          </strong>
                        </>
                      }
                    >
                      <dl className="grid gap-1 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-xs opacity-60">Tipo</dt>
                          <dd className="text-xs">
                            {row.review
                              ? "Finalidade a confirmar"
                              : (labels[row.kind ?? ""] ?? "Movimento")}
                            {row.auto && !row.review && (
                              <span className="opacity-60"> · decidido pelo app</span>
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-xs opacity-60">Data</dt>
                          <dd className="text-xs">{brDate(row.date)}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-xs opacity-60">Situação</dt>
                          <dd className="text-right text-xs">
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
                          O banco não traz mais este movimento. Ele volta sozinho se reaparecer.
                        </p>
                      )}
                      {/* {!reader && bankMeta && (
                        <p className="ds-caption mt-2">
                          {row.scheduled
                            ? "Agendada no banco; Entra nos gastos deste mês. Se cancelou o agendamento, use Remover no menu ⋯."
                            : neutral || row.cardLabel
                              ? "Lido do banco."
                              : row.kind === "income"
                                ? "Entrada já incluída nos totais deste mês. Toque no ícone para mudar a categoria. Se não for uma entrada da família, use Remover no menu ⋯."
                                : "Gasto já incluído nos totais deste mês. Toque no ícone para mudar a categoria. Se não for um gasto, use Remover no menu ⋯."}
                        </p>
                      )} */}
                    </Collapsible>
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
          <Button onClick={() => setLimit((value) => value + 40)}>
            Ver mais {Math.min(40, filtered.length - limit)} movimentos
          </Button>
        )}
      </Panel>
      <p className="ds-caption mt-6 px-1 text-xs leading-relaxed opacity-60">
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
                          const before =
                            pendingMeta.get(c.id)?.tagId ?? null;
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
              {/* Rodapé: ação principal à direita; "Tornar conta fixa" é um
                  caminho alternativo (fecha este e abre outro diálogo), por
                  isso fica no mesmo rodapé, com peso menor. No celular, a
                  principal vai para cima e as duas ocupam a largura. */}
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
