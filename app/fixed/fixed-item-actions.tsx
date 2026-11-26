"use client";
import { useId, useState } from "react";
import { Button } from "../button";
import { Callout } from "../ds/callout";
import { FamilyDialog } from "../dialogs/family-dialog";
import { useAction } from "../hooks/use-action.ts";
import type { Data } from "../hooks/use-month-data.ts";
import { ItemDialog } from "../month/item-dialog";
import { ChangeDueDialog } from "./change-due-dialog";
import { FixedActionList } from "./fixed-action-list";
import { actionMenu, onlyThisDone, type FixedAction } from "./fixed-actions-model.ts";
import type { SeriesItem } from "./fixed-status.ts";
import { MoveMonthDialog } from "./move-month-dialog";
import { SeriesPreviewDialog } from "./series-preview-dialog";
import { SkipOccurrenceDialog } from "./skip-occurrence-dialog";
import { DeleteSeriesDialog } from "./delete-series-dialog";
import { AmountAllDialog } from "./amount-all-dialog";
import { SinceDialog } from "./since-dialog";
import { SeriesEditDialog } from "./series-edit-dialog";

type View = "menu" | "done" | "edit" | "only" | "next" | "all" | "since" | "end" | "move" | "due" | "skip" | "delete";

const VIEW_OF: Record<FixedAction, View> = {
  "edit-series": "edit",
  "only-this": "only",
  "this-and-next": "next",
  all: "all",
  since: "since",
  "move-month": "move",
  "change-due": "due",
  skip: "skip",
  end: "end",
  delete: "delete",
};

/**
 * O que acontece ao tocar numa conta fixa do Mês: o menu de ações e, por ação,
 * o subdiálogo certo. Cada subdiálogo só existe enquanto está aberto, então
 * começa limpo a cada vez. Depois de gravar, o aviso aparece aqui mesmo.
 */
export function FixedItemActions({
  item,
  month,
  categories,
  hidden,
  reader,
  onClose,
  reload,
}: {
  item: SeriesItem;
  month: string;
  categories: Data["state"]["categories"];
  hidden: boolean;
  reader: boolean;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const action = useAction();
  const reasonId = useId();
  const [view, setView] = useState<View>("menu");
  const [notice, setNotice] = useState("");
  const menu = actionMenu(item, hidden, reader);

  const back = () => {
    action.setError("");
    setView("menu");
  };
  const done = (message: string) => {
    setNotice(message);
    setView("done");
    void reload();
  };
  const sub = { item, action, onBack: back, onDone: done };

  return (
    <>
      {(view === "menu" || view === "done") && (
        <FamilyDialog
          open
          title={item.label}
          busy={false}
          error=""
          onClose={onClose}
        >
          <p className="ds-caption">{menu.summary}</p>
          {view === "done" ? (
            <>
              <Callout tone="ok" icon="✓" title="Feito">
                {notice}
              </Callout>
              <Button variant="primary" onClick={onClose}>
                Fechar
              </Button>
            </>
          ) : reader ? (
            <p className="ds-caption">
              Só quem pode editar muda esta conta. Aqui você só acompanha.
            </p>
          ) : (
            <>
              <FixedActionList
                entries={menu.entries}
                reasonId={reasonId}
                onChoose={(choice) => {
                  action.setError("");
                  setView(VIEW_OF[choice]);
                }}
              />
              {menu.blockedNote && (
                <p className="ds-caption" id={reasonId}>
                  {menu.blockedNote}
                </p>
              )}
            </>
          )}
        </FamilyDialog>
      )}
      {view === "only" && (
        <ItemDialog
          open
          selected={item}
          initialPurpose={item.purpose}
          initialCostType="auto"
          month={month}
          currency={item.currency}
          categories={categories}
          reader={reader}
          hidden={hidden}
          action={action}
          onClose={back}
          onSaved={() => done(onlyThisDone(item.month))}
        />
      )}
      {view === "next" && (
        <SeriesPreviewDialog mode="next" hidden={hidden} {...sub} />
      )}
      {view === "edit" && (
        <SeriesEditDialog categories={categories} hidden={hidden} {...sub} />
      )}
      {view === "all" && <AmountAllDialog {...sub} />}
      {view === "since" && <SinceDialog {...sub} />}
      {view === "end" && (
        <SeriesPreviewDialog mode="end" hidden={hidden} {...sub} />
      )}
      {view === "move" && <MoveMonthDialog {...sub} />}
      {view === "due" && <ChangeDueDialog {...sub} />}
      {view === "skip" && <SkipOccurrenceDialog {...sub} />}
      {view === "delete" && <DeleteSeriesDialog {...sub} />}
    </>
  );
}
