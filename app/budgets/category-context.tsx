"use client";
// O que a casa sabe sobre a categoria e a conta não sabe: se dá para cortar
// ("protegida" fica fora dos cortes sugeridos) e uma nota livre que a Judite
// lê (ex.: "temos 10 animais; pet não baixa fácil").
import { useEffect, useId, useState } from "react";
import { api } from "../lib/api.ts";
import { Button } from "../button";

type Context = { categories: { name: string; protected: boolean; note: string | null }[] };

export function CategoryContext({ name, canEdit }: { name: string; canEdit: boolean }) {
  const id = useId();
  const [loaded, setLoaded] = useState(false);
  const [isProtected, setProtected] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<Context>("family/context", undefined, controller.signal)
      .then((c) => {
        const row = c.categories.find((x) => x.name === name);
        setProtected(row?.protected ?? false);
        setNote(row?.note ?? "");
        setSaved(row?.note ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => controller.abort();
  }, [name]);

  const toggle = async (next: boolean) => {
    setProtected(next);
    setError("");
    try {
      await api("family/context/protect", { category: name, protected: next });
      setStatus(next ? "Protegida: fica fora dos cortes sugeridos." : "Volta a entrar nos cortes sugeridos.");
    } catch (e) {
      setProtected(!next);
      setError(e instanceof Error ? e.message : "Não foi possível mudar.");
    }
  };
  const saveNote = async () => {
    setBusy(true);
    setError("");
    try {
      const text = note.trim();
      if (text) await api("family/context/note", { scope: "category", category: name, note: text });
      else await api("family/context/note/delete", { scope: "category", category: name });
      setSaved(text);
      setNote(text);
      setStatus(text ? "Nota guardada." : "Nota apagada.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar a nota.");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;
  if (!canEdit && !isProtected && !saved) return null;
  return (
    <section className="flex flex-col gap-3 rounded-box bg-base-200 p-4" aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`} className="text-sm font-semibold">
        O que vocês sabem sobre {name}
      </h3>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          role="switch"
          className="mt-0.5"
          checked={isProtected}
          disabled={!canEdit}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Não dá para cortar</span>
          <span className="text-xs opacity-70">Fica fora dos cortes que o app e a Judite sugerem.</span>
        </span>
      </label>
      {canEdit ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-n`} className="text-xs font-semibold opacity-70">
            Contexto para a Judite
          </label>
          <textarea
            id={`${id}-n`}
            rows={2}
            maxLength={500}
            placeholder="Ex.: temos 10 animais; alguns meses sobem com veterinário."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {note.trim() !== saved ? (
            <div>
              <Button variant="quiet" onClick={() => void saveNote()} disabled={busy}>
                {busy ? "Guardando…" : note.trim() ? "Guardar nota" : "Apagar nota"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : saved ? (
        <p className="text-sm">{saved}</p>
      ) : null}
      <p className="sr-only" role="status">
        {status}
      </p>
      {error ? (
        <p role="alert" className="ds-caption alert alert-soft alert-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
