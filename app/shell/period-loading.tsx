import { Button } from "../ds/button.tsx";
import { ActionBanner } from "./action-banner";

/** "Carregando o mês selecionado…" com o erro e o botão de nova tentativa. */
export function PeriodLoading({
  error,
  onRetry,
}: {
  error: string;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ActionBanner error={error} notice="" />
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-4 text-sm text-muted"
        role="status"
      >
        <span>Carregando o mês selecionado…</span>
        {error && (
          <Button variant="quiet" size="sm" onClick={() => void onRetry()}>
            Tentar novamente
          </Button>
        )}
      </div>
    </div>
  );
}
