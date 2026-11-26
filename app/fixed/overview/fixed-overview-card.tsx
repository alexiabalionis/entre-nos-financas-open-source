"use client";
import { useState } from "react";
import { OverviewSection } from "./overview-section";
import { PeriodLoading } from "../../shell/period-loading";
import { useSession } from "../../session/session-context";
import { useAction } from "../../hooks/use-action.ts";
import { useFixedOverview } from "../../hooks/use-fixed-overview.ts";
import { monthCache, type Data } from "../../hooks/use-month-data.ts";
import { api } from "../../lib/api.ts";
import { today as todayInSaoPaulo } from "../../lib/dates.ts";
import { FixedItemActions } from "../fixed-item-actions";
import { EMPTY_TEXT } from "./overview-copy.ts";
import { dismissDone, dismissRequest } from "./overview-requests.ts";
import { OverviewFrequentList } from "./overview-frequent-list";
import { OverviewLegacyList } from "./overview-legacy-list";
import {
  editableItemIds,
  groupSeries,
  isEmptyOverview,
  seriesItemById,
} from "./overview-model.ts";
import { OverviewNotice } from "./overview-notice";
import { OverviewSeriesList } from "./overview-series-list";
import { OverviewSuggestions } from "./overview-suggestions";
import { OverviewSummary } from "./overview-summary";
import type { FormTarget, OverviewSuggestion } from "./overview-types.ts";
import { ReviewDialog } from "./review-dialog";
import { ReviewNotice } from "./review-notice";
import { SeriesFormDialog } from "./series-form-dialog";

type DialogState =
  | { kind: "edit"; itemId: string }
  | { kind: "edit-elsewhere"; itemId: string; month: string; data: Data }
  | { kind: "form"; target: FormTarget }
  | { kind: "review" }
  | null;

/**
 * Cartão "Contas fixas" de Nosso espaço: o que se repete no mês, as sugestões
 * e os itens antigos. Quem só acompanha vê tudo, sem os botões de gravar.
 */
export function FixedOverviewCard({
  open,
  month,
  data,
  reloadPeriod,
}: {
  open: boolean;
  month: string;
  data: Data | null;
  reloadPeriod: () => Promise<void>;
}) {
  const { reader, hidden } = useSession();
  const { overview, error, reload } = useFixedOverview(month, open);
  const action = useAction();
  const [dialog, setDialog] = useState<DialogState>(null);
  const today = todayInSaoPaulo();
  const close = () => setDialog(null);

  if (!overview) return <PeriodLoading error={error} onRetry={reload} />;

  const refresh = async () => {
    monthCache.markStale();
    await Promise.all([reload(), reloadPeriod()]);
  };
  const changed = (message: string) => {
    action.setError("");
    action.setNotice(message);
    void refresh();
  };
  const dismiss = (s: OverviewSuggestion) => {
    const request = dismissRequest(s);
    void action.work(async () => {
      await api(request.route, request.body);
      await refresh();
    }, dismissDone(s));
  };

  const writer = !reader && data !== null;
  const groups = groupSeries(overview.series);
  const items = data?.routine.items ?? [];
  const editItem =
    dialog?.kind === "edit" ? seriesItemById(items, dialog.itemId) : null;
  const elsewhereItem =
    dialog?.kind === "edit-elsewhere"
      ? seriesItemById(dialog.data.routine.items, dialog.itemId)
      : null;
  // Série sem nada no mês da tela: carrega o mês da próxima ocorrência e abre por ela.
  const edit = (itemId: string, other?: string) => {
    if (!other || other === month) return setDialog({ kind: "edit", itemId });
    void action.work(async () => {
      const query = new URLSearchParams({ month: other, currency: "BRL" });
      const loaded = await api<Data>("family/month?" + query);
      setDialog({ kind: "edit-elsewhere", itemId, month: other, data: loaded });
    }, "");
  };
  const openForm = (target: FormTarget) => setDialog({ kind: "form", target });

  return (
    <>
      <OverviewNotice notice={action.notice} error={action.error || error} />
      {overview.card_cycle_review.length > 0 && (
        <ReviewNotice
          count={overview.card_cycle_review.length}
          onReview={reader ? null : () => setDialog({ kind: "review" })}
        />
      )}
      <OverviewSummary overview={overview} month={month} hidden={hidden} />
      {isEmptyOverview(overview) && <p className="ds-caption">{EMPTY_TEXT}</p>}
      {groups.monthly.length > 0 && (
        <OverviewSection
          icon="calendar"
          title="Neste mês"
          subtitle="Contas que caem uma vez por período"
          count={groups.monthly.length}
        >
          <OverviewSeriesList
            series={groups.monthly}
            today={today}
            hidden={hidden}
            editable={editableItemIds(items)}
            onEdit={writer ? edit : null}
          />
        </OverviewSection>
      )}
      {groups.frequent.length > 0 && (
        <OverviewSection
          icon="refresh"
          title="Várias vezes no mês"
          subtitle="Agrupadas para não encher a lista. Toque para ver cada dia."
          count={groups.frequent.length}
        >
          <OverviewFrequentList
            series={groups.frequent}
            today={today}
            hidden={hidden}
            editable={editableItemIds(items)}
            onEdit={writer ? edit : null}
          />
        </OverviewSection>
      )}
      {groups.other.length > 0 && (
        <OverviewSection
          icon="calendar"
          title="Em outros meses"
          count={groups.other.length}
        >
          <OverviewSeriesList
            series={groups.other}
            today={today}
            hidden={hidden}
            editable={editableItemIds(items)}
            onEdit={writer ? edit : null}
          />
        </OverviewSection>
      )}
      {overview.suggestions.length > 0 && (
        <OverviewSection
          icon="sparkle"
          title="Sugestões"
          subtitle="Você aprovou estes valores várias vezes no mesmo dia do mês. Se disser que não é fixa, não sugerimos de novo."
          count={overview.suggestions.length}
        >
          <OverviewSuggestions
            suggestions={overview.suggestions}
            hidden={hidden}
            busy={action.busy}
            onCreate={
              writer
                ? (s) => openForm({ kind: "suggestion", suggestion: s })
                : null
            }
            onDismiss={writer ? dismiss : null}
          />
        </OverviewSection>
      )}
      {overview.legacy.length > 0 && (
        <OverviewSection
          icon="layers"
          title="Itens antigos marcados como fixos"
          subtitle="Continuam no mês do jeito que estão. Transforme em conta fixa para eles virem sozinhos nos próximos meses."
          count={overview.legacy.length}
        >
          <OverviewLegacyList
            legacy={overview.legacy}
            hidden={hidden}
            onConvert={
              writer ? (l) => openForm({ kind: "legacy", legacy: l }) : null
            }
          />
        </OverviewSection>
      )}
      {dialog?.kind === "form" && data && (
        <SeriesFormDialog
          target={dialog.target}
          today={today}
          month={month}
          hidden={hidden}
          categories={data.state.categories}
          onDone={changed}
          onClose={close}
        />
      )}
      {dialog?.kind === "review" && (
        <ReviewDialog
          items={overview.card_cycle_review}
          onMoved={changed}
          onClose={close}
        />
      )}
      {elsewhereItem && dialog?.kind === "edit-elsewhere" && (
        <FixedItemActions
          key={elsewhereItem.id}
          item={elsewhereItem}
          month={dialog.month}
          categories={dialog.data.state.categories}
          hidden={hidden}
          reader={reader}
          onClose={close}
          reload={refresh}
        />
      )}
      {editItem && data && (
        <FixedItemActions
          key={editItem.id}
          item={editItem}
          month={month}
          categories={data.state.categories}
          hidden={hidden}
          reader={reader}
          onClose={close}
          reload={refresh}
        />
      )}
    </>
  );
}
