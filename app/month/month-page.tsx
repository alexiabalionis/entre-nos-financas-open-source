"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildMonthModel } from "./model.ts";
import { HeroBlock } from "./blocks/hero-block.tsx";
import { OutflowBlock } from "../budgets/outflow-block";
import { MonthHeader } from "./blocks/month-header.tsx";
import { Greeting } from "./blocks/greeting.tsx";
import { categoryIconFor } from "./blocks/category-icon-for.tsx";
import { MONTH_BLOCKS, MONTH_BLOCK_ORDER } from "./blocks/registry.ts";
import { balanceCentsFor, monthCategories, projectionScreen } from "./screen-input.ts";
import { PaymentAlerts } from "./payment-alerts";
import { Panel } from "../ds/panel";
import { PlanGroup } from "./plan-group";
import { PLAN_GROUPS } from "./plan-model.ts";
import { ItemDialog } from "./item-dialog";
import { FixedItemActions } from "../fixed/fixed-item-actions";
import { isSeriesBill } from "../fixed/fixed-status.ts";
import { CheckDialog } from "./check-dialog";
import { EntryDialog } from "./entry-dialog";
import { PeriodDialog } from "../dialogs/period-dialog";
import { RecordMovementDialog } from "../dialogs/record-movement-dialog";
import { CardsPanel } from "../family-cards";
import { HomeBlock, HomeLayout } from "../family-personalization";
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
import type { HomeCardId } from "../../src/domain/preferences";

type Modal = "item" | "fixed" | "movement" | "check" | "entry" | "period" | null;

/**
 * Página / (Mês): planejamento do mês, alertas, cartões e blocos
 * personalizáveis. Dona dos dados do mês, dos diálogos de item/conferência/
 * entrada/mês e do modo de edição do início.
 */
export function MonthPage() {
  const session = useSession();
  const { user, hidden, reader } = session;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period = usePeriodData();
  const action = useAction();
  const { members, error: membersError } = useMembers(true);
  const [modal, setModal] = useState<Modal>(null),
    [selected, setSelected] = useState<MonthItem | null>(null),
    [itemPurpose, setItemPurpose] = useState("expense"),
    [newCostType, setNewCostType] = useState("auto"),
    [movementKind, setMovementKind] = useState("expense"),
    // Vindo do Meu perfil ("Personalizar início"): abre já editando.
    [homeEditing, setHomeEditing] = useState(() => params.get("editar") === "1");
  const { month, currency, setMonth } = period;

  // O pedido de edição é de uma vez só: sai da URL depois de lido.
  useEffect(() => {
    if (params.get("editar") !== "1") return;
    const query = new URLSearchParams(params.toString());
    query.delete("editar");
    router.replace(pathname + "?" + query.toString(), { scroll: false });
  }, [params, pathname, router]);

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
  // O item aberto segue a versão recarregada (depois de mudar o vencimento, o
  // diálogo mostra a data nova, não a de quando foi aberto).
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
  // Saudação: os dois membros do casal quando chegam (ou só a pessoa logada se
  // a busca falhar), sem trocar de nome depois de aparecer.
  const greetPeople = (members.length > 0 ? members : [user]).map((m) => ({
    name: m.name,
  }));
  const greetingReady = members.length > 0 || !!membersError;
  const isCurrentMonth = month === currentMonth();

  return (
    <>
      {session.headerSlot &&
        greetingReady &&
        createPortal(<Greeting people={greetPeople} />, session.headerSlot)}
      <ActionBanner error={action.error || period.error} notice={action.notice} />
      <section
        className="month-controls"
        aria-label="Mês e contas do planejamento"
      >
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
      <HeroBlock model={monthModel} currency={currency} />
      <HomeLayout
        preferences={session.preferences}
        editing={homeEditing}
        onEditingChange={setHomeEditing}
        onSaved={session.updatePreferences}
      >
        <HomeBlock cardId="receipts">
          {data.routine.receipts.map((r, index) => (
            <Panel key={index} title={r.label + " · para o próximo mês"}>
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
        </HomeBlock>
        <HomeBlock cardId="alerts">
          <PaymentAlerts
            cards={data.cards}
            reminders={reminders}
            items={items}
            currency={currency}
            hidden={hidden}
            onConfigureAlarms={() => goSpace({ painel: "notifications" })}
            onReviewCard={(account) =>
              goSpace({ painel: "banks", conta: account })
            }
            onOpenItem={openItem}
          />
        </HomeBlock>
        <HomeBlock cardId="cards">
          <CardsPanel
            month={month}
            onRefresh={period.reload}
            reader={reader}
            cards={data.cards}
            hidden={hidden}
            onReview={(account) => goSpace({ painel: "banks", conta: account })}
          />
        </HomeBlock>
        {PLAN_GROUPS.map((group) => (
          <HomeBlock cardId={group.id as HomeCardId} key={group.id}>
            <PlanGroup
              group={group}
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
              onAdd={() => {
                open(
                  "item",
                  null,
                  group.id === "income"
                    ? "income"
                    : group.id === "saving"
                      ? "saving"
                      : "expense",
                );
                setNewCostType(
                  group.id === "fixed" || group.id === "variable"
                    ? group.id
                    : "auto",
                );
              }}
            />
          </HomeBlock>
        ))}
        {/* "composition" virou "Saídas por categoria" (composição + tetos),
            que precisa dos dados do mês e do reload; os outros blocos do
            registry só leem o model. */}
        <HomeBlock cardId="composition" collapsible={false}>
          <OutflowBlock
            data={data}
            month={month}
            currency={currency}
            hidden={hidden}
            reader={reader}
            reload={period.reload}
          />
        </HomeBlock>
        {MONTH_BLOCK_ORDER.filter((id) => id !== "composition").map((id) => {
          const { Component } = MONTH_BLOCKS[id];
          return (
            <HomeBlock cardId={id} collapsible={false} key={id}>
              <Component model={monthModel} currency={currency} />
            </HomeBlock>
          );
        })}
      </HomeLayout>
      <p className="ds-caption mt-6 px-1 text-xs leading-relaxed opacity-60">
        Fixos e variáveis têm uma classificação sugerida pelo nome. Toque em uma
        conta para ajustar. Marcar como pago ou recebido atualiza o plano, sem
        duplicar os movimentos.
      </p>
      {!items.length && (
        <button
          className="btn btn-primary btn-sm"
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
        </button>
      )}
      {items.some((i) => i.source_line_id) && (
        <p className="ds-caption">
          Preenchido com seu planejamento. As marcações “pago” da planilha foram
          preservadas; valores sem confirmação não foram tratados como
          pagamentos.{" "}
          {items.some((i) => i.derived)
            ? "Este mês usa os valores reais como base do plano, conforme você pediu."
            : ""}
        </p>
      )}
      {!homeEditing && !modal && (
        <QuickActions
          key={month}
          planning={!isCurrentMonth}
          reader={reader}
          onIncome={() =>
            isCurrentMonth ? open("entry") : open("item", null, "income")
          }
          onExpense={() =>
            isCurrentMonth ? open("movement") : open("item", null, "expense")
          }
          onEdit={() => {
            setHomeEditing(true);
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
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
