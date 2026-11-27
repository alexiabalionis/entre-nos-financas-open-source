"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAsyncAction } from "./use-async-action";
import { Button } from "./ds/button";
import { Callout } from "./ds/callout";
import { RenameAccountDialog } from "./rename-account-dialog";
import { BankConnectionCard, type RenameTarget } from "./bank-connection-card";
import { BankIncomeRule } from "./bank-income-rule";
import { BankOnboarding } from "./bank-onboarding";
import { RenewBank } from "./bank-renew";
import { api, type Banks, type LocalAccount } from "./bank-api";
import { useMonthParam } from "./hooks/use-month-param";
import { withMonth } from "./shell/routes";
import { bankSetupStage } from "../src/domain/bank-onboarding.ts";
import { formatted } from "../src/domain/format.ts";

export function BankPanel({
  accounts,
  reader,
  hidden,
  refresh,
}: {
  accounts: LocalAccount[];
  reader: boolean;
  hidden: boolean;
  refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const { month } = useMonthParam();
  const [data, setData] = useState<Banks | null>(null),
    [guideStep, setGuideStep] = useState<number | null>(null),
    [onboardingOpen, setOnboardingOpen] = useState(false),
    [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction({
    fallbackError: "Tente novamente.",
  });
  const load = async () => setData(await api<Banks>("banks"));
  useEffect(() => {
    let ended = false;
    const update = () =>
      void api<Banks>("banks")
        .then((r) => {
          if (!ended) setData(r);
        })
        .catch((e) => {
          if (!ended) setError(e.message);
        });
    update();
    window.addEventListener("family-banks-updated", update);
    return () => {
      ended = true;
      window.removeEventListener("family-banks-updated", update);
    };
  }, [setError]);

  function work(
    action: () => Promise<unknown>,
    message: string,
    financial = false,
  ) {
    return run(
      async () => {
        await action();
      },
      async () => {
        await load();
        if (financial) await refresh();
        setNotice(message);
      },
    );
  }

  async function saveRename(name: string) {
    if (!renaming) return;
    await api("accounts/rename", { account_id: renaming.id, name });
    await load().catch(() => undefined);
    await refresh().catch(() => undefined);
    setNotice(renaming.card ? "Cartão renomeado." : "Conta renomeada.");
  }

  const step = guideStep ?? (data ? bankSetupStage(data) : 1);
  const ownConnections =
    data?.connections.filter((c) => c.own && c.enabled) ?? [];
  const ownAccounts =
    data?.accounts.filter(
      (a) =>
        a.currency === "BRL" &&
        ownConnections.some((c) => c.id === a.connection_id),
    ) ?? [];
  const unmapped = ownAccounts.filter((a) => !a.local_account_id);
  const setupDone =
    !!data &&
    bankSetupStage(data) === 5 &&
    data.hasCredentials &&
    ownConnections.length > 0 &&
    unmapped.length === 0;

  const money = (value: string | null) =>
    hidden
      ? "••••"
      : value === null
        ? "Não informado"
        : formatted(value, "BRL");

  function openOnboarding(targetStep = 3) {
    setGuideStep(targetStep);
    setOnboardingOpen(true);
    requestAnimationFrame(() =>
      document
        .getElementById("bank-onboarding")
        ?.scrollIntoView({ behavior: "smooth" }),
    );
  }

  return (
    <div
      className="family-banks flex flex-col gap-4"
      id="family-banks"
      role="region"
      aria-label="Contas e cartões"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 min-w-0 flex-1 text-sm leading-relaxed text-muted">
          Contas bancárias, carteiras e cartões vinculados ao seu planejamento.
          Só lemos os dados: nada é pago, transferido ou movimentado no banco.
        </p>
        {data && !reader && (
          <Button
            variant="secondary"
            size="sm"
            icon="plus"
            onClick={() => openOnboarding(data.hasCredentials ? 3 : 1)}
          >
            {setupDone ? "Conectar outro banco" : "Adicionar conta"}
          </Button>
        )}
      </div>

      {data && data.total > 0 && (
        <Callout
          icon="⇄"
          tone="accent"
          title={`${data.total} ${
            data.total === 1
              ? "movimento bancário aguardando conferência"
              : "movimentos bancários aguardando conferência"
          }`}
          meta="A fila de conferência fica centralizada em Movimentos."
        >
          <div className="mt-2">
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                router.push(
                  withMonth("/movimentos", month, { filtro: "review" }),
                  { scroll: false },
                )
              }
            >
              Conferir em Movimentos
            </Button>
          </div>
        </Callout>
      )}

      {error && (
        <p
          role="alert"
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="m-0 rounded-xl border border-info/25 bg-info-bg px-4 py-3 text-sm font-medium text-ink"
        >
          {notice}
        </p>
      )}

      {!data && (
        <div>
          <Button
            disabled={busy}
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Carregar conexões
          </Button>
        </div>
      )}

      {data && !data.storageReady && (
        <p className="ds-caption">
          A conexão bancária ainda não foi habilitada nesta instalação. Peça ao
          administrador para ativar a proteção das credenciais. Nenhuma senha de
          banco é pedida aqui.
        </p>
      )}

      {data && (
        <>
          {!data.connections.length && (
            <p className="ds-caption">
              Nenhum banco conectado ainda. Os documentos e lançamentos
              anteriores continuam preservados.
            </p>
          )}
          {data.connections.map((c) => {
            const editable = c.own && !reader;
            return (
              <BankConnectionCard
                key={c.id}
                connection={c}
                bankAccounts={data.accounts.filter(
                  (a) => a.connection_id === c.id,
                )}
                localAccounts={accounts}
                editable={editable}
                busy={busy}
                storageReady={data.storageReady}
                money={money}
                onOpenGuide={() => openOnboarding(3)}
                onRead={() =>
                  void work(async () => {
                    const r = await api<{ skipped: boolean }>("banks/read", {
                      id: c.id,
                      force: true,
                    });
                    if (r.skipped)
                      throw new Error(
                        "Aguarde um minuto entre leituras ou conclua a leitura já em andamento.",
                      );
                  }, "Leitura concluída. Novos movimentos aparecerão em Movimentos.")
                }
                onTogglePause={() =>
                  void work(
                    () => api("banks/pause", { id: c.id, enabled: !c.enabled }),
                    c.enabled
                      ? "Consultas pausadas. O histórico foi preservado."
                      : "Consultas reativadas.",
                  )
                }
                onMap={(id, v) =>
                  void work(
                    () =>
                      api("banks/map", {
                        id,
                        account_id:
                          v.account_id === "__new__" ? null : v.account_id,
                        ...(v.account_id === "__new__" ? { name: v.name } : {}),
                      }),
                    "Conta vinculada. Leia os movimentos disponíveis.",
                    true,
                  )
                }
                onRename={setRenaming}
                renew={
                  <RenewBank
                    connection={c.id}
                    busy={busy}
                    ready={data.storageReady}
                    completed={async () => {
                      await work(
                        async () => {},
                        "Autorização renovada, mantendo as mesmas contas. Leia os movimentos e confira possíveis duplicidades.",
                      );
                    }}
                  />
                }
              />
            );
          })}

          {data.incomeRules.map((rule) => (
            <BankIncomeRule
              key={rule.id}
              rule={rule}
              money={money}
              reader={reader}
              busy={busy}
              work={work}
            />
          ))}

          {!reader && (!setupDone || onboardingOpen) && (
            <BankOnboarding
              data={data}
              step={step}
              setGuideStep={setGuideStep}
              busy={busy}
              work={work}
              ownConnections={ownConnections}
              ownAccounts={ownAccounts}
              unmapped={unmapped}
              onClose={setupDone ? () => setOnboardingOpen(false) : undefined}
            />
          )}

          {!reader && setupDone && !onboardingOpen && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
              <div className="min-w-0">
                <p className="m-0 text-sm font-medium text-ink">
                  Conexão bancária configurada
                </p>
                <p className="m-0 text-xs text-muted">
                  Precisa conectar mais um banco ou ajustar chaves de acesso?
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openOnboarding(3)}
              >
                Conectar outro banco
              </Button>
            </div>
          )}
        </>
      )}

      <RenameAccountDialog
        open={renaming !== null}
        title={renaming?.card ? "Renomear cartão" : "Renomear conta"}
        initialName={renaming?.name ?? ""}
        onClose={() => setRenaming(null)}
        onSave={saveRename}
      />
    </div>
  );
}
