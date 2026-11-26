/** Erro e aviso de sucesso de uma ação, na mesma marcação de antes. */
export function ActionBanner({
  error,
  notice,
}: {
  error: string;
  notice: string;
}) {
  return (
    <>
      {error && (
        <p className="family-error alert alert-soft alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="family-notice alert alert-soft alert-success" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
