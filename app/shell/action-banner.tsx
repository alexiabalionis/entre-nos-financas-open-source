/** Erro e aviso de sucesso de uma ação. */
export function ActionBanner({
  error,
  notice,
}: {
  error: string;
  notice: string;
}) {
  if (!error && !notice) return null;
  return (
    <div className="mb-4 flex flex-col gap-2">
      {error && (
        <p
          className="family-error m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          className="family-notice m-0 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-sm font-medium text-ok"
          role="status"
        >
          {notice}
        </p>
      )}
    </div>
  );
}
