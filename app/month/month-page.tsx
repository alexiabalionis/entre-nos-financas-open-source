"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildMonthModel } from "./model.ts";
import { HeroBlock } from "./blocks/hero-block.tsx";
import { OutflowBlock } from "../budgets/outflow-block";
import { MonthHeader } from "./blocks/month-header.tsx";
import { Greeting } from "./blocks/greeting.tsx";
import { categoryIconFor } from "./blocks/category-icon-for.tsx";
import { PathBlock } from "./blocks/path-block.tsx";
import { balanceCentsFor, monthCategories, projectionScreen } from "./screen-input.ts";
import { AttentionStrip } from "./attention-strip.tsx";
import { PlanSection } from "./plan-section.tsx";
import { type PlanGroupId } from "./plan-model.ts";
import { Button } from "../ds/button.tsx";
import { Panel } from "../ds/panel";
import { ItemDialog } from "./item-dialog";
import { FixedItemActions } from "../fixed/fixed-item-actions";
import { isSeriesBill } from "../fixed/fixed-status.ts";
import { CheckDialog } from "./check-dialog";
import { EntryDialog } from "./entry-dialog";
import { PeriodDialog } from "../dialogs/period-dialog";
import { RecordMovementDialog } from "../dialogs/record-movement-dialog";
import { CardsPanel } from "../family-cards";
import { QuickActions } from "../family-quick-actions";
import { ActionBanner } from "../shell/action-banner";
import { PeriodLoading } from "../shell/period-loading";
import { withMonth } from "../shell/routes.ts";
import { useSession } from "../session/session-context";
import { useAction } from "../hooks/use-action.ts";
import { useMembers } from "../hooks/use-members.ts";
import { usePeriodData } from "../hooks/use-period-data.ts";
import type { MonthItem } from "../hooks/use-month-data.ts";
import { api } from "../lib/api.ts";
import { currentMonth, monthTitle, moveMonth, today } from "../lib/dates.ts";
import { money } from "../lib/money.ts";
import { paymentReminders } from "../../src/domain/reminders.ts";
import { brDate } from "../../src/domain/format.ts";

type Modal = "item" | "fixed" | "movement" | "check" | "entry" | "period" | null;

/**
 * Página / (Mês): hierarquia opinativa em 3 zonas:
 *   1. Herói da marca + alertas críticos
 *   2. Atenção agora (vencimentos, pendências e próximos compromissos)
 *   3. Grade editorial 2 colunas (Plano do mês + Cartões | Saídas + Caminho do saldo)
 */
export function MonthPage() {
  const session = useSession();
  const { user, hidden, reader } = session;
  const router = useRouter();
  const period = usePeriodData();
  const action = useAction();
  const { members, error: membersError } = useMembers(true);
  const [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState<MonthItem | null>(null),
    [itemPurpose, setItemPurpose] = useState("expense"),
    [newCostType, setNewCostType] = useState("auto"),
    [movementKind, setMovementKind] = useState("expense"),
    [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const { month, currency, setMonth } = period;

  function open(kind: Exclude<Modal, null>, item: MonthItem | null = null, initialKind = "expense") {
    if (kind === "movement") setMovementKind(initialKind);
    if (kind === "item") {
      setItemPurpose(item?.purpose ?? initialKind);
      setNewCostType("auto");
    }
    setSelected(item);
    setModal(kind);
    action.setError("");
  }
  const close = () => setModal(null);
  const openItem = (item: MonthItem) =>
    open(isSeriesBill(item) ? "fixed" : "item", item);
  const openAddGroup = (groupId: PlanGroupId) => {
    open(
      "item",
      null,
      groupId === "income"
        ? "income"
        : groupId === "saving"
          ? "saving"
          : "expense",
    );
    setNewCostType(
      groupId === "fixed" || groupId === "variable" ? groupId : "auto",
    );
  };
  const goSpace = (extra: Record<string, string>) => {
    router.push(withMonth("/espaco", month, extra), { scroll: false });
    window.scrollTo({ top: 0 });
  };

  const data = period.data;
  if (!data)
    return (
      <>
        <ActionBanner error={action.error} notice={action.notice} />
        <PeriodLoading error={period.error} onRetry={period.reload} />
      </>
    );

  const items = data.routine.items.filter((i) => i.currency === currency);
  const selectedNow = selected ? (items.find((i) => i.id === selected.id) ?? selected) : null;
  const current = today();
  const reminders = paymentReminders(items, current);
  const label = monthTitle(month);
  const screen = projectionScreen(period.projection, month, false, current);
  const monthModel = buildMonthModel({
    items,
    categories: monthCategories(data.state.categories),
    month,
    currency,
    balanceCents: balanceCentsFor(data.state.accounts, currency),
    projection: screen.view,
    mode: screen.mode,
    iconFor: categoryIconFor,
    hidden,
  });
  const greetPeople = (members.length > 0 ? members : [user]).map((m) => ({
    name: m.name,
  }));
  const greetingReady = members.length > 0 || !!membersError;
  const isCurrentMonth = month === currentMonth();

  return (
    <>
      <ActionBanner error={action.error || period.error} notice={action.notice} />

      {/* Cabeçalho do mês + ações rápidas no desktop */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {greetingReady ? (
            <Greeting people={greetPeople} />
          ) : (
            <div className="h-7 w-40 rounded-lg bg-surface-2" aria-hidden="true" />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <section aria-label="Mês e contas do planejamento" className="w-full sm:w-auto">
            <MonthHeader
              label={label}
              caption={screen.statusWord ?? monthModel.defaultStepperCaption}
              prevLabel="Mês anterior"
              nextLabel="Próximo mês"
              labelAriaLabel={`Escolher mês: ${label}`}
              onPrev={() => setMonth(moveMonth(month, -1))}
              onNext={() => setMonth(moveMonth(month, 1))}
              onLabelClick={() => open("period")}
            />
          </section>

          <div
            className="hidden lg:inline-flex items-center gap-2"
            data-tour={isDesktop ? "quick-actions" : undefined}
          >
            <Button
              variant="secondary"
              size="sm"
              icon="in"
              disabled={reader}
              onClick={() =>
                isCurrentMonth ? open("entry") : open("item", null, "income")
              }
            >
              {isCurrentMonth ? "Entrada" : "Planejar entrada"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              disabled={reader}
              onClick={() =>
                isCurrentMonth ? open("movement") : open("item", null, "expense")
              }
            >
              {isCurrentMonth ? "Registrar gasto" : "Planejar gasto"}
            </Button>
          </div>
        </div>
      </div>

      {/* ZONA 1: Branded Hero + alertas + recebimentos */}
      <div className="mb-6 flex flex-col gap-3">
        <HeroBlock model={monthModel} currency={currency} />

        {data.routine.receipts.map((r, index) => (
          <Panel key={index} title={r.label + " · para o próximo mês"} className="mb-0">
            <p className="ds-caption">
              {r.received_date
                ? "Crédito identificado em " +
                  brDate(r.received_date) +
                  " · " +
                  money(r.amount_cents, "BRL", hidden)
                : "Recebimento previsto em " + brDate(r.expected_date)}
              . Destinado ao planejamento de {r.budget_month.slice(5, 7)}/
              {r.budget_month.slice(0, 4)}.
            </p>
            <p className="ds-caption">{r.note}</p>
          </Panel>
        ))}

        {!items.length && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-4">
            <p className="m-0 text-sm text-muted">
              Este mês ainda não tem itens planejados.
            </p>
            <Button
              variant="primary"
              size="sm"
              disabled={action.busy || reader}
              onClick={() =>
                void action.work(async () => {
                  await api("routine/copy", {
                    from: moveMonth(month, -1),
                    to: month,
                  });
                  await period.reload();
                }, "Planejamento copiado. Os pagamentos começam em aberto.")
              }
            >
              Usar planejamento do mês anterior
            </Button>
          </div>
        )}
      </div>

      {/* ZONA 2: Atenção agora */}
      <div className="mb-6">
        <AttentionStrip
          cards={data.cards}
          reminders={reminders}
          items={items}
          model={monthModel}
          currency={currency}
          hidden={hidden}
          onConfigureAlarms={() => goSpace({ painel: "notifications" })}
          onReviewCard={(account) => {
            router.push(
              withMonth("/movimentos", month, { filtro: "review", conta: account }),
              { scroll: false },
            );
            window.scrollTo({ top: 0 });
          }}
          onOpenItem={openItem}
        />
      </div>

      {/* ZONA 3: Grade editorial 2 colunas no desktop */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <PlanSection
            items={items}
            categories={data.state.categories}
            events={data.state.events}
            currency={currency}
            hidden={hidden}
            today={current}
            busy={action.busy}
            reader={reader}
            onCheck={(item) => open("check", item)}
            onOpenItem={openItem}
            onAddGroup={openAddGroup}
          />
          <CardsPanel
            month={month}
            onRefresh={period.reload}
            reader={reader}
            cards={data.cards}
            hidden={hidden}
            onReview={(account) => {
              router.push(
                withMonth("/movimentos", month, { filtro: "review", conta: account }),
                { scroll: false },
              );
              window.scrollTo({ top: 0 });
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <OutflowBlock
            data={data}
            month={month}
            currency={currency}
            hidden={hidden}
            reader={reader}
            reload={period.reload}
          />
          <PathBlock model={monthModel} currency={currency} />
        </div>
      </div>

      <p className="ds-caption mt-6 px-1 text-xs leading-relaxed">
        Fixos e variáveis têm uma classificação sugerida pelo nome. Toque em uma
        conta para ajustar. Marcar como pago ou recebido atualiza o plano, sem
        duplicar os movimentos.
      </p>

      {items.some((i) => i.source_line_id) && (
        <p className="ds-caption mt-2 px-1 text-xs">
          Preenchido com seu planejamento. As marcações “pago” da planilha foram
          preservadas; valores sem confirmação não foram tratados como
          pagamentos.{" "}
          {items.some((i) => i.derived)
            ? "Este mês usa os valores reais como base do plano, conforme você pediu."
            : ""}
        </p>
      )}

      {!modal && (
        <QuickActions
          key={month}
          planning={!isCurrentMonth}
          reader={reader}
          tourTarget={!isDesktop}
          onIncome={() =>
            isCurrentMonth ? open("entry") : open("item", null, "income")
          }
          onExpense={() =>
            isCurrentMonth ? open("movement") : open("item", null, "expense")
          }
        />
      )}

      <PeriodDialog
        open={modal === "period"}
        month={month}
        setMonth={setMonth}
        onClose={close}
      />
      <EntryDialog
        open={modal === "entry"}
        action={action}
        onClose={close}
        onRecord={() => open("movement", null, "income")}
        onPlan={() => open("item", null, "income")}
      />
      <ItemDialog
        open={modal === "item"}
        selected={selected}
        initialPurpose={itemPurpose}
        initialCostType={newCostType}
        month={month}
        currency={currency}
        categories={data.state.categories}
        reader={reader}
        hidden={hidden}
        action={action}
        onClose={close}
        onSaved={period.reload}
      />
      {modal === "fixed" && selectedNow && isSeriesBill(selectedNow) && (
        <FixedItemActions
          key={selectedNow.id}
          item={selectedNow}
          month={month}
          categories={data.state.categories}
          hidden={hidden}
          reader={reader}
          onClose={close}
          reload={period.reload}
        />
      )}
      <CheckDialog
        open={modal === "check"}
        selected={selected}
        action={action}
        onClose={close}
        onSaved={period.reload}
      />
      <RecordMovementDialog
        open={modal === "movement"}
        initialKind={movementKind}
        month={month}
        action={action}
        onClose={close}
        onSaved={period.reload}
      />
    </>
  );
}
