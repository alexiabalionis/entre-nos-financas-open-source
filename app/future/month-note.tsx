import { useCallback, useEffect, useId, useState } from "react";
import { api } from "../lib/api.ts";
import { Button } from "../ds/index.ts";

type Context = { monthNotes: { name: string; month: string; note: string }[] };

export function useMonthNotes(month: string) {
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    api<Context>(`family/context?month=${month}`, undefined, controller.signal)
      .then((c) =>
        setNotes(
          new Map(
            c.monthNotes
              .filter((n) => n.month === month)
              .map((n) => [n.name, n.note]),
          ),
        ),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [month]);
  const save = useCallback(
    async (name: string, note: string) => {
      const text = note.trim();
      if (text)
        await api("family/context/note", {
          scope: "category_month",
          category: name,
          month,
          note: text,
        });
      else
        await api("family/context/note/delete", {
          scope: "category_month",
          category: name,
          month,
        });
      setNotes((m) => {
        const next = new Map(m);
        if (text) next.set(name, text);
        else next.delete(name);
        return next;
      });
    },
    [month],
  );
  return { notes, save };
}

export function MonthNote({
  name,
  note,
  canWrite,
  onSave,
}: {
  name: string;
  note: string | undefined;
  canWrite: boolean;
  onSave: (name: string, note: string) => Promise<void>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!editing)
    return note ? (
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <p className="m-0 flex-1 basis-56 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink">
          <span className="font-semibold">Por quê: </span>
          {note}
        </p>
        {canWrite ? (
          <Button
            variant="text"
            size="sm"
            onClick={() => (setDraft(note), setEditing(true))}
          >
            Editar
          </Button>
        ) : null}
      </div>
    ) : canWrite ? (
      <Button
        variant="text"
        size="sm"
        className="w-auto! self-start justify-start! px-0!"
        onClick={() => (setDraft(""), setEditing(true))}
      >
        Anotar o porquê
      </Button>
    ) : null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(name, draft);
      setEditing(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível guardar a nota.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-2">
      <label className="text-xs font-semibold text-muted" htmlFor={id}>
        Por que {name} ficou assim este mês?
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={500}
        autoFocus
        className="w-full min-h-18 resize-y text-sm text-ink"
        placeholder="Ex.: um dos gatos ficou doente; consulta e exames."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="m-0 text-xs text-muted">
        Fica guardado neste mês. A Judite também lê.
      </p>
      {error ? (
        <p
          role="alert"
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {busy
            ? "Guardando…"
            : draft.trim() || !note
              ? "Guardar"
              : "Apagar nota"}
        </Button>
        <Button
          variant="text"
          size="sm"
          onClick={() => setEditing(false)}
          disabled={busy}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}
