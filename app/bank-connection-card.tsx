"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "./ds/button";
import { Icon, type IconName } from "./ds/icon";
import { IconBadge } from "./ds/icon-badge";
import { Select } from "./ds/select";
import { StatusChip } from "./ds/status-chip";
import { Field } from "./field";
import type { readBanks } from "../src/server/banks.ts";
import { brDate } from "../src/domain/format.ts";

type Banks = Awaited<ReturnType<typeof readBanks>>;
type Connection = Banks["connections"][number];
type BankAccount = Banks["accounts"][number];
type LocalAccount = {
  id: string;
  name: string;
  currency: string;
  kind: string;
};

export type RenameTarget = { id: string; name: string; card: boolean };

type Props = {
  connection: Connection;
  bankAccounts: BankAccount[];
  localAccounts: LocalAccount[];
  editable: boolean;
  busy: boolean;
  storageReady: boolean;
  money: (value: string | null) => string;
  onRead: () => void;
  onTogglePause: () => void;
  onMap: (
    bankAccountId: string,
    values: Record<string, FormDataEntryValue>,
  ) => void;
  onRename: (target: RenameTarget) => void;
  onOpenGuide?: () => void;
  renew: ReactNode;
};

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR");

function Fact({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Icon name={icon} size={20} className="shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="m-0 text-xs text-muted">{label}</p>
        <p className="m-0 text-sm font-semibold text-ink">{value}</p>
      </div>
    </div>
  );
}

function ConnectionMenu({
  onRenew,
  onOpenGuide,
}: {
  onRenew: () => void;
  onOpenGuide?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        className="ui-icon-btn inline-flex size-8.5 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Mais opções da conexão"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={16} />
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <li role="none" className="list-none">
            <button
              type="button"
              role="menuitem"
              className="ui-btn w-full rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2 cursor-pointer"
              onClick={() => {
                setOpen(false);
                onRenew();
              }}
            >
              Renovar autorização
            </button>
          </li>
          <li role="none" className="list-none">
            <button
              type="button"
              role="menuitem"
              className="ui-btn w-full rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2 cursor-pointer"
              onClick={() => {
                setOpen(false);
                onOpenGuide?.();
              }}
            >
              Abrir passo a passo
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

function MapForm({
  account,
  locals,
  busy,
  onMap,
}: {
  account: BankAccount;
  locals: LocalAccount[];
  busy: boolean;
  onMap: Props["onMap"];
}) {
  const options = locals.filter(
    (l) =>
      l.currency === account.currency &&
      (account.account_type === "CREDIT"
        ? l.kind === "card"
        : ["checking", "benefit"].includes(l.kind)),
  );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onMap(account.id, Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <Field label="Conta correspondente no Entre Nós">
        <Select name="account_id" defaultValue="" required>
          <option value="">Escolher correspondência</option>
          <option value="__new__">Criar nova conta no app</option>
          {options.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nome, se for criar uma conta">
        <input name="name" maxLength={120} defaultValue={account.label} />
      </Field>
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          Vincular esta conta
        </Button>
      </div>
    </form>
  );
}

function RenameButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      variant="quiet"
      size="sm"
      icon="edit"
      disabled={disabled}
      onClick={onClick}
    >
      Renomear
    </Button>
  );
}

function AccountRow({ account, ...p }: Props & { account: BankAccount }) {
  const local = p.localAccounts.find((l) => l.id === account.local_account_id);
  const name = local?.name ?? account.label;
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface-2/60 p-3.5"
      key={account.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-ink">
            {name}
            {account.last_four ? " · final " + account.last_four : ""}
          </p>
          {local && name !== account.label && (
            <p className="m-0 text-xs text-muted">
              Nome no banco: {account.label}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {account.currency === "BRL" ? (
            <div>
              <p className="m-0 text-xs text-muted">Saldo consultado</p>
              <p className="m-0 font-numeric text-sm font-semibold tabular-nums text-ink">
                {p.money(account.balance_cents)}
              </p>
            </div>
          ) : (
            <p className="m-0 text-xs text-muted">
              Referência em {account.currency}. Movimentos fora de BRL não serão
              importados.
            </p>
          )}
          {local && p.editable && (
            <RenameButton
              disabled={p.busy}
              onClick={() => p.onRename({ id: local.id, name, card: false })}
            />
          )}
        </div>
      </div>
      {!local && p.editable && account.currency === "BRL" && (
        <MapForm
          account={account}
          locals={p.localAccounts}
          busy={p.busy}
          onMap={p.onMap}
        />
      )}
    </div>
  );
}

function CreditCard({ account, ...p }: Props & { account: BankAccount }) {
  const local = p.localAccounts.find((l) => l.id === account.local_account_id);
  const name = local?.name ?? account.label;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <IconBadge
          size="lg"
          solid
          tone="accent"
          icon={<Icon name="card" size={20} />}
        />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold leading-snug text-ink">
            {name}
          </h3>
          <p className="m-0 text-xs text-muted">
            Cartão de crédito
            {account.last_four ? " · final " + account.last_four : ""}
          </p>
        </div>
      </div>
      {account.currency === "BRL" ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Fact
              icon="card"
              label="Valor informado pelo cartão"
              value={
                <span className="font-numeric tabular-nums">
                  {p.money(account.balance_cents)}
                </span>
              }
            />
            {local && (
              <Fact icon="link" label="Vinculado a" value={local.name} />
            )}
          </div>
          {local && p.editable && (
            <RenameButton
              disabled={p.busy}
              onClick={() => p.onRename({ id: local.id, name, card: true })}
            />
          )}
        </div>
      ) : (
        <p className="m-0 text-xs text-muted">
          Referência em {account.currency}. Movimentos fora de BRL não serão
          importados.
        </p>
      )}
      {!local && p.editable && account.currency === "BRL" && (
        <MapForm
          account={account}
          locals={p.localAccounts}
          busy={p.busy}
          onMap={p.onMap}
        />
      )}
    </section>
  );
}

/** Conexão bancária (cartão do banco + contas) seguida dos cartões de crédito. */
export function BankConnectionCard(props: Props) {
  const { connection: c, bankAccounts, editable, busy, storageReady } = props;
  const [renewOpen, setRenewOpen] = useState(false);
  const credit = bankAccounts.filter((a) => a.account_type === "CREDIT");
  const others = bankAccounts.filter((a) => a.account_type !== "CREDIT");

  return (
    <div
      className="flex scroll-mt-6 flex-col gap-3"
      id={"bank-connection-" + c.id}
    >
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-3">
          <IconBadge
            size="lg"
            solid
            tone="accent"
            icon={<Icon name="bank" size={20} />}
          />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-semibold leading-snug text-ink">
              {c.label}
            </h3>
            <p className="m-0 text-xs text-muted">
              {c.owner_label} · Desde {brDate(c.start_date)}
            </p>
          </div>
          <StatusChip
            tone={c.enabled ? "ok" : "neutral"}
            label={c.enabled ? "Leitura ativa" : "Leitura pausada"}
          />
          {editable && (
            <ConnectionMenu
              onRenew={() => setRenewOpen(true)}
              onOpenGuide={props.onOpenGuide}
            />
          )}
        </div>

        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="quiet"
              size="sm"
              icon="refresh"
              disabled={busy || !c.enabled || !storageReady}
              onClick={props.onRead}
            >
              Ler atualização disponível
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={c.enabled ? "pause" : "play"}
              disabled={busy}
              onClick={props.onTogglePause}
            >
              {c.enabled ? "Pausar leitura" : "Retomar leitura"}
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Fact
            icon="calendar"
            label="Última leitura"
            value={
              c.last_read_at
                ? when(c.last_read_at)
                : "Aguardando primeira leitura"
            }
          />
          {c.provider_updated_at && (
            <Fact
              icon="bank"
              label="Atualização informada pelo banco"
              value={when(c.provider_updated_at)}
            />
          )}
          {c.consent_expires_at && (
            <Fact
              icon="shield"
              label="Autorização até"
              value={new Date(c.consent_expires_at).toLocaleDateString("pt-BR")}
            />
          )}
        </div>

        {c.error_code && (
          <p
            role="alert"
            className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
          >
            A leitura precisa de atenção. Confira a autorização no Meu Pluggy e
            tente novamente. Seus registros foram preservados.
          </p>
        )}

        {others.map((a) => (
          <AccountRow key={a.id} account={a} {...props} />
        ))}

        {editable && renewOpen && props.renew}
      </section>

      {credit.map((a) => (
        <CreditCard key={a.id} account={a} {...props} />
      ))}
    </div>
  );
}
