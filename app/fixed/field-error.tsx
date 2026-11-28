export function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p className="text-sm text-danger" id={id} role="alert">
      {text}
    </p>
  ) : null;
}
