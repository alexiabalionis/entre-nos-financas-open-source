export function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p className="text-error text-sm" id={id} role="alert">
      {text}
    </p>
  ) : null;
}
