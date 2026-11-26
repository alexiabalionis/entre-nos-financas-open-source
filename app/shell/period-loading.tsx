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
    <>
      <ActionBanner error={error} notice="" />
      <div className="family-period-loading" role="status">
        <span>Carregando o mês selecionado…</span>
        {error && <button onClick={() => void onRetry()}>Tentar novamente</button>}
      </div>
    </>
  );
}
