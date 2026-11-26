"use client";
import { useState, type FormEvent, type ReactNode } from "react";
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
  /** Contas e cartões do banco que pertencem a esta conexão. */
  bankAccounts: BankAccount[];
  localAccounts: LocalAccount[];
  /** Pode alterar (a conexão é minha e não sou leitor). */
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
  /** Formulário de renovação; só é montado quando a pessoa pede no menu ⋯. */
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
      <Icon name={icon} size={22} className="shrink-0 text-base-content/60" />
      <div className="min-w-0">
        <p className="m-0 text-xs text-base-content/60">{label}</p>
        <p className="m-0 text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

function ConnectionMenu({ onRenew }: { onRenew: () => void }) {
  const close = (e: { currentTarget: HTMLElement }) =>
    e.currentTarget.closest("details")?.removeAttribute("open");
  return (
    <details className="dropdown dropdown-end">
      <summary
        className="btn btn-ghost btn-circle btn-sm"
        aria-label="Mais opções da conexão"
      >
        <Icon name="more" />
      </summary>
      <ul className="menu dropdown-content z-10 w-60 rounded-box bg-base-100 p-2 shadow-sm">
        <li>
          <button
            type="button"
            onClick={(e) => {
              close(e);
              onRenew();
            }}
          >
            Renovar autorização
          </button>
        </li>
        <li>
          <a href="#bank-onboarding" onClick={close}>
            Voltar ao passo a passo
          </a>
        </li>
      </ul>
    </details>
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
      <Button type="submit" variant="primary" size="sm" disabled={busy}>
        Vincular esta conta
      </Button>
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

/** Conta bancária dentro do cartão da conexão. */
function AccountRow({ account, ...p }: Props & { account: BankAccount }) {
  const local = p.localAccounts.find((l) => l.id === account.local_account_id);
  const name = local?.name ?? account.label;
  return (
    <div
      className="flex flex-col gap-3 rounded-box bg-base-200 p-3"
      key={account.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold">
            {name}
            {account.last_four ? " · final " + account.last_four : ""}
          </p>
          {local && name !== account.label && (
            <p className="m-0 text-xs text-base-content/60">
              Nome no banco: {account.label}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {account.currency === "BRL" ? (
            <div>
              <p className="m-0 text-xs text-base-content/60">
                Saldo consultado
              </p>
              <p className="m-0 text-sm font-semibold">
                {p.money(account.balance_cents)}
              </p>
            </div>
          ) : (
            <p className="m-0 text-xs text-base-content/60">
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

/** Cartão de crédito: ganha um cartão próprio, como no protótipo. */
function CreditCard({ account, ...p }: Props & { account: BankAccount }) {
  const local = p.localAccounts.find((l) => l.id === account.local_account_id);
  const name = local?.name ?? account.label;
  return (
    <section className="card card-border bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div className="flex items-center gap-3">
          <IconBadge
            size="lg"
            solid
            tone="accent"
            icon={<Icon name="card" size={22} />}
          />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-semibold leading-snug">{name}</h3>
            <p className="m-0 text-sm text-base-content/60">
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
                value={p.money(account.balance_cents)}
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
          <p className="m-0 text-xs text-base-content/60">
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
      </div>
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
      <section className="card card-border bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <div className="flex items-center gap-3">
            <IconBadge
              size="lg"
              solid
              tone="accent"
              icon={<Icon name="bank" size={22} />}
            />
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-base font-semibold leading-snug">
                {c.label}
              </h3>
              <p className="m-0 text-sm text-base-content/60">
                {c.owner_label} · Desde {brDate(c.start_date)}
              </p>
            </div>
            <StatusChip
              tone={c.enabled ? "ok" : "neutral"}
              label={c.enabled ? "Leitura ativa" : "Leitura pausada"}
            />
            {editable && <ConnectionMenu onRenew={() => setRenewOpen(true)} />}
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
                variant="quiet"
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
                value={new Date(c.consent_expires_at).toLocaleDateString(
                  "pt-BR",
                )}
              />
            )}
          </div>
          {c.error_code && (
            <p className="family-error alert alert-soft alert-error m-0">
              A leitura precisa de atenção. Confira a autorização no Meu Pluggy
              e tente novamente. Seus registros foram preservados.
            </p>
          )}
          {others.map((a) => (
            <AccountRow key={a.id} account={a} {...props} />
          ))}
          {editable && renewOpen && props.renew}
        </div>
      </section>
      {credit.map((a) => (
        <CreditCard key={a.id} account={a} {...props} />
      ))}
    </div>
  );
}
