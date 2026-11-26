import type { FormEvent } from "react";

/** Lê os campos de um <form> e cancela o envio nativo (igual ao values() antigo). */
export function formValues(e: FormEvent<HTMLFormElement>) {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget));
}
