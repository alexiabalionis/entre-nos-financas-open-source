"use client";
import { useState, type FormEvent } from "react";
import { Button } from "../button";
import { Callout } from "../ds/callout";
import { Row } from "../ds/row";
import { StatusChip } from "../ds/status-chip";
import { api } from "../lib/api.ts";
import { monthTitle } from "../lib/dates.ts";
import { brDate } from "../../src/domain/format.ts";
import type { Action } from "../hooks/use-action.ts";
import { FixedConflictNotice } from "./fixed-conflict-notice";
import { FixedFormFields } from "./fixed-form-fields";
import { LinkExistingSeries } from "./link-existing-series";
import {
  fixedPayload,
  nextText,
  validateFixed,
  type CreateFixedResult,
  type FixedConflict,
  type FixedOrigin,
} from "./fixed-form-model.ts";
import {
  createdNotice,
  isAlreadyInSeries,
  valuesFromForm,
  type FixedNotice,
} from "./fixed-row-model.ts";

type BodyProps = {
  origin: FixedOrigin;
  categories: { id: string; name: string; fixed?: boolean }[];
  action: Action;
  onCreated: (notice: FixedNotice) => void;
  onClose: () => void;
  refresh: () => Promise<void>;
};

/** Formulário, aviso de duplicidade e "já é conta fixa" do diálogo. */
export function FixedFormBody({
  origin,
  categories,
  action,
  onCreated,
  onClose,
  refresh,
}: BodyProps) {
  const [values, setValues] = useState(origin.values);
  const [submitted, setSubmitted] = useState(false);
  const [conflict, setConflict] = useState<FixedConflict[] | null>(null);
  const [already, setAlready] = useState(false);
  // Id do evento criado ao registrar a leitura do banco (record), para não
  // registrar de novo ao repetir após um aviso de duplicidade.
  const [recordedId, setRecordedId] = useState("");
  const errors = submitted ? validateFixed(values, origin) : {};

  const readForm = (form: HTMLFormElement) =>
    valuesFromForm(Object.fromEntries(new FormData(form)));

  // Se o movimento já foi registrado e a pessoa desiste, a lista precisa
  // recarregar: a linha deixou de ser leitura do banco e virou lançamento.
  const close = () => {
    onClose();
    if (recordedId) void refresh();
  };

  const eventFor = async (categoryId = values.categoryId): Promise<string> => {
    if (!origin.bank) return origin.eventId;
    if (recordedId) return recordedId;
    const done = await api<{ event_id: string | null }>("banks/review", {
      id: origin.bank.id,
      version: origin.bank.version,
      decision: "record",
      kind: origin.bank.kind,
      ...(categoryId ? { category_id: categoryId } : {}),
    });
    if (!done.event_id) throw new Error("Não foi possível registrar o movimento.");
    setRecordedId(done.event_id);
    return done.event_id;
  };

  const send = (confirm: boolean, current = values) => {
    setSubmitted(true);
    if (!fixedPayload(current, origin, confirm)) return;
    void action.work(async () => {
      const eventId = await eventFor(current.categoryId);
      const payload = fixedPayload(current, { ...origin, eventId }, confirm);
      if (!payload) return;
      try {
        const result = await api<CreateFixedResult>(
          "recurrences/from-event",
          payload,
        );
        if ("conflict" in result) return setConflict(result.conflict);
        onCreated(createdNotice(result, nextText(current, origin)));
        onClose();
        await refresh();
      } catch (e) {
        if (!isAlreadyInSeries(e)) throw e;
        setAlready(true);
      }
    }, "");
  };

  // Liga o lançamento à conta fixa que já existe, em vez de criar outra.
  const link = (recurrenceId: string, label: string) => {
    void action.work(async () => {
      const eventId = await eventFor();
      const { month } = await api<{ month: string }>("recurrences/link-event", {
        event_id: eventId,
        recurrence_id: recurrenceId,
      });
      onCreated({
        tone: "ok",
        title: `Ligado a ${label}`,
        body: `${origin.title} agora é o pagamento de ${label} em ${monthTitle(month.slice(0, 7))}.`,
      });
      onClose();
      await refresh();
    }, "");
  };

  if (already)
    return (
      <>
        <Callout
          tone="accent"
          icon="↻"
          title="Esta já é uma conta fixa"
        >
          Este movimento já está ligado a uma conta fixa, então não precisa
          criar outra.
        </Callout>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="primary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </>
    );

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(false, readForm(e.currentTarget));
  };

  return (
    <form
      onSubmit={onSubmit}
      onChange={(e) => {
        setValues(readForm(e.currentTarget));
        setConflict(null);
      }}
      noValidate
    >
      <Row
        title={origin.title}
        sub={`${origin.account} · ${brDate(origin.date)}`}
        trail={<StatusChip tone="ok" label="Aprovada" />}
      />
      <LinkExistingSeries
        month={origin.date.slice(0, 7)}
        busy={action.busy}
        onLink={link}
      />
      {conflict && (
        <FixedConflictNotice
          conflict={conflict}
          busy={action.busy}
          onLink={link}
          onForce={() => send(true)}
          onCancel={close}
        />
      )}
      <FixedFormFields
        initial={origin.values}
        current={values}
        errors={errors}
        categories={categories}
        account={origin.account}
        next={nextText(values, origin)}
        startsAtOrigin={values.startDate === origin.date}
        originDate={origin.date}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="quiet" onClick={close} disabled={action.busy}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" busy={action.busy}>
          Criar conta fixa
        </Button>
      </div>
    </form>
  );
}
