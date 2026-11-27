"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { readCards, readCardProjection } from "../src/server/cards.ts";
import { cardOverview } from "../src/domain/card-overview";
import { formatted, brDate } from "../src/domain/format.ts";
import { Button } from "./button";
import { Collapsible } from "./collapsible";
import { Field } from "./field";
import { Panel } from "./ds/panel";
import { RowList } from "./ds/row-list";
import type { ReactNode } from "react";
type Cards = Awaited<ReturnType<typeof readCards>>;
type CardProjection = Awaited<ReturnType<typeof readCardProjection>>;
export function CardsPanel({
  cards,
  month,
  hidden,
  onReview,
  onRefresh,
  reader = false,
}: {
  cards: Cards;
  month: string;
  hidden: boolean;
  onReview: (account: string) => void;
  onRefresh: () => Promise<void>;
  reader?: boolean;
}) {
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const overview = cardOverview(cards);
  const revealedHash = useRef("");
  // Resumo da fatura que VENCE neste mês (AC3.3). Reusa a mesma projeção da aba
  // Futuro; aqui mostramos só a fatura do mês corrente por cartão.
  const [projection, setProjection] = useState<CardProjection | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setProjection(null);
    void fetch("/api/cards/projection?month=" + month, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setProjection(d as CardProjection);
      })
      .catch(() => {
        // Complementar; silencia para não quebrar o painel de cartões.
      });
    return () => controller.abort();
  }, [month]);
  useEffect(() => {
    let frame = 0;
    const reveal = () => {
      if (!location.hash.startsWith("#card-")) revealedHash.current = "";
      if (revealedHash.current === location.hash) return;
      const card = cards.find(
        (c) => location.hash === "#card-" + c.local_account_id,
      );
      if (card) {
        revealedHash.current = location.hash;
        setExpandedCard(card.id);
        frame = requestAnimationFrame(() =>
          document
            .getElementById("card-" + card.local_account_id)
            ?.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
      cancelAnimationFrame(frame);
    };
  }, [cards]);
  const money = (v: string | null) =>
    hidden ? "••••" : v === null ? "Não informado" : formatted(v, "BRL");
  if (!cards.length) return null;
  const totalLabel =
    overview.unknown === cards.length
      ? "A conferir"
      : money(overview.total_cents);
  return (
    <div role="region" aria-label="Compras e faturas do cartão" className="credit-overview flex flex-col gap-3">
      <Panel
        title="Cartões do mês"
        meta={totalLabel}
        className="mb-0"
      >
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={
          hidden
            ? "Valores ocultos"
            : "Distribuição das faturas por cartão; valores na lista abaixo"
        }
      >
        {!hidden &&
          overview.rows
            .filter((r) => r.share > 0)
            .map((r) => (
              <span
                key={r.id}
                className={"h-full flex-none card-color-" + (overview.rows.indexOf(r) % 5)}
                style={{ width: r.share + "%" }}
              />
            ))}
      </div>
      <p className="ds-caption text-xs">
        {overview.hasEstimates ? "Inclui estimativas. " : ""}
        {overview.unknown
          ? `${overview.unknown} cartão(ões) com valor a conferir. `
          : ""}
        Faturas e compras não são somadas duas vezes.
      </p>
      {cards.map((c) => (
        <details
          key={c.id}
          id={"card-" + c.local_account_id}
          className="credit-account border-t border-border first:border-t-0"
          open={expandedCard === c.id}
        >
          <summary
            className="credit-bank-summary flex cursor-pointer list-none items-center gap-3 py-3 after:opacity-60 after:content-['⌄'] [&::-webkit-details-marker]:hidden"
            onClick={(event) => {
              event.preventDefault();
              setExpandedCard((old) => (old === c.id ? null : c.id));
            }}
          >
            <span
              className={"size-3 shrink-0 rounded-full card-color-" + (cards.indexOf(c) % 5)}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-medium">
                {c.name}
                {c.last_four ? " · " + c.last_four : ""}
              </strong>
              <small className="block text-xs opacity-60">
                {overview.rows.find((r) => r.id === c.id)!.source}
                {overview.rows.find((r) => r.id === c.id)!.due_date
                  ? " · " +
                    brDate(overview.rows.find((r) => r.id === c.id)!.due_date!)
                  : ""}
              </small>
            </span>
            <strong className="text-sm font-medium whitespace-nowrap tabular-nums">
              {overview.rows.find((r) => r.id === c.id)!.amount_cents === null
                ? "—"
                : money(overview.rows.find((r) => r.id === c.id)!.amount_cents)}
            </strong>
          </summary>
          <div className="credit-bank-detail flex flex-col gap-3 pb-3">
            {(() => {
              const bill = projection?.cards
                .find((p) => p.account_id === c.local_account_id)
                ?.months.find((m) => m.due_month === month);
              if (!bill) return null;
              return (
                <Bill
                  title="Fatura que vence neste mês"
                  amount={money(bill.total_cents)}
                  sub={
                    <>
                      {bill.source === "bank"
                        ? "Informado pelo banco"
                        : bill.source === "cycle"
                          ? "Estimado pelo ciclo"
                          : "Parcial: banco e estimativa"}
                      {bill.provisional ? " · provisório" : ""}
                      {bill.purchase_count
                        ? ` · ${bill.purchase_count} compra(s)`
                        : ""}
                    </>
                  }
                />
              );
            })()}
            {!c.connected && (
              <p className="ds-caption text-xs opacity-60">
                Acompanhamento manual. A integração não disponibiliza este
                cartão. Informe os valores consultados no banco; eles ficam
                separados das compras registradas.
              </p>
            )}
            <RowList
              rows={[
                {
                  title: "Limite total",
                  trail: money(
                    c.connected ? c.credit_limit_cents : c.manual_limit_cents,
                  ),
                },
                { title: "Disponível no cartão", trail: money(c.available_credit_cents) },
                { title: "Limite comprometido", trail: money(c.committed_credit_cents) },
              ]}
            />
            <p className="ds-caption text-xs opacity-60">
              Limite de crédito não é saldo da família nem entrada de dinheiro.
              O limite comprometido pode incluir parcelas futuras e não
              representa a fatura do mês.
            </p>
            {!c.connected && (
              <>
                {c.manual_bill && (
                  <Bill
                    title="Fatura informada por vocês"
                    amount={money(c.manual_bill.amount_cents)}
                    sub={
                      <>
                        Vencimento: {brDate(c.manual_bill.due_date)} ·{" "}
                        {c.manual_bill.paid ? "Marcada como paga" : "Em aberto"}
                      </>
                    }
                  >
                    <small className="block text-xs opacity-60">
                      Conta a pagar, sem adicionar despesa ao histórico ou ao
                      gráfico. O valor da fatura não determina o limite
                      disponível.
                    </small>
                  </Bill>
                )}
                <ManualCardForm
                  key={c.id + month}
                  card={c}
                  month={month}
                  reader={reader}
                  onRefresh={onRefresh}
                />
              </>
            )}
            {c.credit_limits_review && (
              <p className="ds-caption text-xs opacity-60">
                Os limites retornados precisam de conferência no banco; não
                estimamos o limite comprometido.
              </p>
            )}
            {c.projection && (
              <Bill
                title={"Estimativa para " + brDate(c.projection.due_date)}
                amount={money(c.projection.total_cents)}
                sub={
                  <>
                    Compras de {brDate(c.projection.start_date)} a{" "}
                    {brDate(c.projection.close_date)} · ciclo informado por
                    vocês.
                  </>
                }
              >
                <small className="block text-xs opacity-60">
                  {c.projection.purchase_count} compra(s),{" "}
                  {c.projection.bank_pending_count} ainda pendente(s) no banco.
                  Não é a fatura oficial nem inclui compras que não chegaram à
                  integração. Pagamentos e duplicidades ficam fora desta soma.
                </small>
                {c.projection.closing_day_count > 0 && (
                  <small className="block text-xs opacity-60">
                    Compras no dia do fechamento precisam de conferência: o
                    banco pode lançá-las no ciclo seguinte.
                  </small>
                )}
              </Bill>
            )}
            {c.connected && (
              <CycleForm
                accountId={c.local_account_id}
                cycle={c.cycle}
                cycleSchedule={c.cycle_schedule}
                creditDue={c.credit_due_date}
                creditClose={c.credit_close_date}
                reader={reader}
                onRefresh={onRefresh}
              />
            )}
            {c.bills.map((b) => (
              <Bill
                key={b.id}
                title={"Fatura com vencimento em " + brDate(b.due_date)}
                amount={b.needs_review ? "Conferir valor" : money(b.total_cents)}
                sub={
                  b.close_date
                    ? "Fechamento informado: " + brDate(b.close_date)
                    : "Fechamento não informado"
                }
              >
                {b.needs_review && (
                  <small className="block text-xs opacity-60">
                    O provedor retornou um valor que precisa de conferência no
                    banco. Ele foi preservado como evidência, sem arredondar nem
                    somar aos totais.
                  </small>
                )}
                <small className="block text-xs opacity-60">
                  Valor informado pelo banco; pagamento precisa de conciliação.{" "}
                  {b.assigned_count} compra(s) vinculada(s) a esta fatura.
                </small>
              </Bill>
            ))}
            {c.connected && !c.bills.length && (
              <p className="ds-caption text-xs opacity-60">
                {c.credit_due_date
                  ? (c.projection && c.credit_due_date !== c.projection.due_date
                      ? "Último vencimento retornado pelo banco (outro ciclo): "
                      : "Vencimento informado pelo cartão: ") +
                    brDate(c.credit_due_date) +
                    ". "
                  : ""}
                Valor atual consultado: {money(c.balance_cents)}. Esse valor é
                uma posição do cartão, não uma fatura fechada do mês
                selecionado.
              </p>
            )}
            {c.bills_read_ok === false && (
              <p className="ds-caption text-xs opacity-60">
                A consulta detalhada de faturas não ficou disponível nesta
                leitura. Os dados anteriores foram preservados.
              </p>
            )}
            <RowList
              rows={[
                { title: "Compras registradas", trail: money(c.registered_cents) },
                { title: "Compras para conferir", trail: money(c.preview_cents) },
                { title: "Aguardando o banco", trail: money(c.bank_pending_cents) },
              ]}
            />
            {(c.history_match_cents !== "0" || c.duplicate_cents !== "0") && (
              <p className="ds-caption text-xs opacity-60">
                Coincidências com o histórico: {money(c.history_match_cents)}.
                Possíveis duplicidades: {money(c.duplicate_cents)}. Esses
                valores ficam fora da prévia para evitar somar a mesma compra
                novamente; confira os vínculos.
              </p>
            )}
            {c.unassigned_cents !== "0" && (
              <p className="ds-caption text-xs opacity-60">
                Compras recentes sem mês de fatura confirmado:{" "}
                <strong>{money(c.unassigned_cents)}</strong>. Elas aparecem
                abaixo pela data da compra e não foram atribuídas à fatura deste
                mês por suposição.
              </p>
            )}
            {!!c.payments.length && (
              <p className="ds-caption text-xs opacity-60">
                {c.payments.length} pagamento(s) do cartão identificado(s) no
                período. Pagamento de fatura quita a dívida e não é uma nova
                despesa.
              </p>
            )}
            <Collapsible
              summary={
                <>
                  Ver compras e pagamentos (
                  {c.purchases.length + c.payments.length})
                </>
              }
            >
              <RowList
                rows={[...c.purchases, ...c.payments].map((r) => ({
                  title: r.description,
                  sub:
                    brDate(r.transaction_date) +
                    " · " +
                    (r.changed || r.missing
                      ? "Evidência alterada: revisar"
                      : r.event_id
                        ? "Já registrado"
                        : r.provider_status === "POSTED"
                          ? "Conferir antes de registrar"
                          : "Pendente no banco") +
                    (r.card_meta.installment_number &&
                    r.card_meta.total_installments
                      ? ` · Parcela ${r.card_meta.installment_number}/${r.card_meta.total_installments}`
                      : ""),
                  trail: money(r.amount_cents),
                }))}
              />
            </Collapsible>
            <p className="ds-caption text-xs opacity-60">
              Compras sem vínculo com uma fatura são mostradas pela data da
              operação. Com ciclo informado, indicamos uma estimativa separada
              da fatura oficial. A parcela é contada pelo valor do mês, sem
              multiplicar pelo número de parcelas.
            </p>
            {c.connected && (
              <Button
                type="button"
                onClick={() => onReview(c.local_account_id)}
              >
                Conferir movimentos deste cartão
              </Button>
            )}
          </div>
        </details>
      ))}
      </Panel>
    </div>
  );
}

/** Bloco de fatura: título/sub à esquerda, valor à direita, notas abaixo. */
function Bill({
  title,
  sub,
  amount,
  children,
}: {
  title: string;
  sub: ReactNode;
  amount: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-2/60 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <strong className="block text-sm font-medium text-ink">{title}</strong>
          <small className="block text-xs text-muted">{sub}</small>
        </div>
        <strong className="font-numeric text-sm font-semibold whitespace-nowrap tabular-nums text-ink">{amount}</strong>
      </div>
      {children}
    </div>
  );
}

// Vencimento − N dias, em UTC puro (mesma convenção T12:00:00Z do app).
function minusDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function CycleForm({
  accountId,
  cycle,
  cycleSchedule,
  creditDue,
  creditClose,
  reader,
  onRefresh,
}: {
  accountId: string;
  cycle: Cards[number]["cycle"];
  cycleSchedule: Cards[number]["cycle_schedule"];
  creditDue: string | null;
  creditClose: string | null;
  reader: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  // Com ciclo salvo, o fechamento e o vencimento da fatura aberta vêm do ciclo
  // vigente (cycle_schedule). Sem ciclo salvo, pré-preenche com o que o banco
  // retornou: vencimento do cartão; fechamento do banco quando há, senão
  // estima vencimento − 10 dias (a pessoa confirma; nada grava sozinho).
  const scheduled = cycleSchedule?.scheduled ?? null;
  const dueDefault =
    cycleSchedule?.open_due_date ??
    cycle?.effective_due_date ??
    creditDue ??
    "";
  const closeEstimated = !cycle && !creditClose && creditDue !== null;
  const closeDefault =
    cycleSchedule?.open_close_date ??
    cycle?.effective_close_date ??
    creditClose ??
    (creditDue ? minusDays(creditDue, 10) : "");
  // Mensagem de sucesso conforme a ação devolvida pelo servidor.
  function successMessage(result: {
    action?: string;
    valid_from?: string | null;
    first_close_date?: string | null;
    first_due_date?: string | null;
  }): string {
    if (result.action === "schedule" || result.action === "replace_future")
      return `Mudança agendada a partir de ${brDate(result.valid_from ?? "")}. A primeira fatura no novo ciclo fecha em ${brDate(result.first_close_date ?? "")} e vence em ${brDate(result.first_due_date ?? "")}.`;
    if (result.action === "cancel_future")
      return "Mudança cancelada. O ciclo atual continua valendo.";
    if (result.action === "unchanged")
      return "Nada mudou: esse já é o ciclo do cartão.";
    return "Ciclo salvo.";
  }
  async function submit(closeDate: string, dueDate: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/cards/cycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          close_date: closeDate,
          due_date: dueDate,
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(result.error || "Não foi possível salvar o ciclo.");
      // Sucesso do POST é definitivo assim que o servidor responde ok. A
      // atualização da tela (onRefresh) é um passo separado: se falhar, o
      // ciclo já foi salvo, só a tela não recarregou.
      setMessage(successMessage(result));
      try {
        await onRefresh();
      } catch {
        setMessage(
          "Salvo, mas não foi possível atualizar a tela. Recarregue a página.",
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await submit(String(data.get("close_date")), String(data.get("due_date")));
  }
  // Cancelar a mudança agendada = reenviar o fechamento e o vencimento da
  // fatura aberta do ciclo vigente; o servidor devolve cancel_future.
  async function cancelScheduled() {
    if (!cycleSchedule) return;
    await submit(cycleSchedule.open_close_date, cycleSchedule.open_due_date);
  }
  // Leitor sem ciclo informado não tem nada a expandir: um <details> vazio
  // confundiria. Mostra uma frase estática curta.
  if (reader && !cycle)
    return (
      <p className="ds-caption text-xs opacity-60">Fechamento e vencimento ainda não informados.</p>
    );
  return (
    <Collapsible
      defaultOpen={!cycle && creditDue !== null && !reader}
      summary={
        cycle
          ? `Ciclo informado: fecha dia ${cycle.closing_day} · vence dia ${cycle.due_day}`
          : creditDue !== null
            ? "Confirmar fechamento e vencimento sugeridos pelo banco"
            : "Informar fechamento e vencimento"
      }
    >
      {scheduled && (
        <div className="ds-caption text-xs opacity-60 flex flex-col gap-2" role="status">
          <p>
            Mudança agendada: a partir de {brDate(scheduled.valid_from)} o
            cartão passa a fechar dia {scheduled.closing_day} e vencer dia{" "}
            {scheduled.due_day}.
            {scheduled.first_close_date && scheduled.first_due_date
              ? ` A primeira fatura no novo ciclo fecha em ${brDate(scheduled.first_close_date)} e vence em ${brDate(scheduled.first_due_date)}.`
              : ""}
          </p>
          {!reader && (
            <Button type="button" onClick={cancelScheduled} disabled={busy}>
              Cancelar mudança
            </Button>
          )}
        </div>
      )}
      {!reader && (
        <form
          key={`${scheduled?.valid_from ?? ""}|${closeDefault}|${dueDefault}`}
          onSubmit={save}
          className="card-cycle-form"
        >
          {!cycle && creditDue !== null && (
            <p className="ds-caption text-xs opacity-60">
              Preenchemos com as datas que o banco retornou nesta leitura.
              Confira e salve para a projeção começar.
            </p>
          )}
          <Field label="Próximo fechamento">
            <input
              type="date"
              name="close_date"
              required
              defaultValue={closeDefault}
            />
          </Field>
          {closeEstimated && (
            <p className="ds-caption text-xs opacity-60">
              O banco não informou a data de fechamento desta vez. Sugerimos 10
              dias antes do vencimento. Ajuste se o seu cartão fechar em outro
              dia.
            </p>
          )}
          <Field label="Vencimento dessa fatura">
            <input
              type="date"
              name="due_date"
              required
              defaultValue={dueDefault}
            />
          </Field>
          <p className="ds-caption text-xs opacity-60">
            Usamos esses dias para os próximos meses. Datas específicas do
            banco, quando disponíveis, continuam separadas. Não ajustamos
            feriados automaticamente.
          </p>
          <p className="ds-caption text-xs opacity-60">
            Uma mudança passa a valer depois do fechamento da fatura atual.
            Informe o fechamento e o vencimento da primeira fatura no ciclo
            novo.
          </p>
          <Button type="submit" busy={busy} busyLabel="Salvando…">
            Salvar ciclo do cartão
          </Button>
        </form>
      )}
      {message && (
        <p
          role="status"
          className="rounded-xl border border-info/25 bg-info-bg px-3.5 py-2.5 text-sm text-ink"
        >
          {message}
        </p>
      )}
    </Collapsible>
  );
}

function ManualCardForm({
  card,
  month,
  reader,
  onRefresh,
}: {
  card: Cards[number];
  month: string;
  reader: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const value = (v: string | null | undefined) =>
    v == null
      ? ""
      : (BigInt(v) / 100n).toString() +
        "," +
        (BigInt(v) % 100n).toString().padStart(2, "0");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/cards/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: card.local_account_id,
          month,
          limit: data.get("limit"),
          amount: data.get("amount"),
          due_date: data.get("due_date"),
          paid: data.get("paid") === "on",
        }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || "Não foi possível salvar.");
      await onRefresh();
      setMessage(
        "Salvo. Nenhuma compra ou pagamento foi lançado no histórico.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  if (reader) return null;
  return (
    <Collapsible
      summary={
        card.manual_bill ? "Editar limite e fatura" : "Informar limite e fatura"
      }
    >
      <form className="card-cycle-form" onSubmit={save}>
        <p className="ds-caption text-xs opacity-60">
          Fatura com vencimento em {month.slice(5)}/{month.slice(0, 4)}. Ao
          salvar novamente, atualizamos a mesma fatura deste mês.
        </p>
        <Field label="Limite total (R$)">
          <input
            name="limit"
            inputMode="decimal"
            placeholder="Ex.: 5.000,00"
            defaultValue={value(card.manual_limit_cents)}
          />
        </Field>
        <Field label="Valor da fatura (R$)">
          <input
            name="amount"
            inputMode="decimal"
            placeholder="Ex.: 850,00"
            defaultValue={value(card.manual_bill?.amount_cents)}
          />
        </Field>
        <Field label="Vencimento da fatura">
          <input
            name="due_date"
            type="date"
            min={month + "-01"}
            max={new Date(
              Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
            )
              .toISOString()
              .slice(0, 10)}
            defaultValue={card.manual_bill?.due_date ?? ""}
          />
        </Field>
        <label className="manual-card-paid">
          <input
            name="paid"
            type="checkbox"
            defaultChecked={card.manual_bill?.paid ?? false}
          />
          Esta fatura já foi paga
        </label>
        <p className="ds-caption text-xs opacity-60">
          Marcar como paga apenas encerra o lembrete. Não movimenta contas nem
          cria uma segunda despesa. Informe as compras separadamente quando
          quiser detalhar categorias.
        </p>
        <Button type="submit" busy={busy} busyLabel="Salvando…">
          Salvar limite e fatura
        </Button>
      </form>
      {message && (
        <p
          role="status"
          className="rounded-xl border border-info/25 bg-info-bg px-3.5 py-2.5 text-sm text-ink"
        >
          {message}
        </p>
      )}
    </Collapsible>
  );
}
