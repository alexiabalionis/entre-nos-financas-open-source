"use client";
import { Button } from "./ds/button";
import { Icon } from "./ds/icon";
import { Panel } from "./ds/panel";
import { Collapsible } from "./collapsible";
import { Field } from "./field";
import { api, fields, type Banks, type Work } from "./bank-api";
import { pluggyItemId } from "../src/domain/bank-onboarding.ts";

type Props = {
  data: Banks;
  step: number;
  setGuideStep: (step: number) => void;
  busy: boolean;
  work: Work;
  ownConnections: Banks["connections"];
  ownAccounts: Banks["accounts"];
  unmapped: Banks["accounts"];
  onClose?: () => void;
};

/** Passo a passo de 5 etapas para conectar os bancos da pessoa. */
export function BankOnboarding({
  data,
  step,
  setGuideStep,
  busy,
  work,
  ownConnections,
  ownAccounts,
  unmapped,
  onClose,
}: Props) {
  const stepLabels = [
    "Autorizar",
    "Chaves de acesso",
    "Adicionar banco",
    "Vincular contas",
    "Conferir",
  ];

  return (
    <div
      id="bank-onboarding"
      className="min-w-0 scroll-mt-6 [overflow-wrap:anywhere]"
      role="region"
      aria-label="Conectar meus bancos"
    >
      <Panel title="Conectar meus bancos" className="mb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="ds-caption min-w-0 flex-1">
            Cada pessoa faz este passo a passo no próprio perfil. Seus
            movimentos ficam apenas na sua família no Entre Nós.
          </p>
          {onClose ? (
            <Button variant="quiet" size="sm" onClick={onClose}>
              Fechar guia
            </Button>
          ) : null}
        </div>

        <nav aria-label="Etapas da conexão bancária">
          <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {stepLabels.map((label, index) => {
              const n = index + 1;
              const current = step === n;
              const done = n < step;
              return (
                <li key={label}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    disabled={busy}
                    onClick={() => setGuideStep(n)}
                    className={`ui-btn inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 ${
                      current
                        ? "border-accent bg-accent-soft font-semibold text-accent-ink"
                        : done
                          ? "border-ok/30 bg-ok-bg text-ok"
                          : "border-border bg-surface text-muted hover:text-ink"
                    }`}
                  >
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-current/15 font-numeric text-[0.6875rem] font-semibold">
                      {done ? <Icon name="check" size={10} /> : n}
                    </span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/50 p-4" key={step}>
          <h4 tabIndex={-1} className="m-0 text-sm font-semibold text-ink">
            Etapa {step} de 5 ·{" "}
            {
              [
                "Autorize suas contas",
                "Conecte seu acesso Pluggy",
                "Adicione um banco seu",
                "Escolha as contas correspondentes",
                "Leia os movimentos iniciais",
              ][step - 1]
            }
          </h4>

          {step === 1 && (
            <>
              <p className="m-0 text-sm leading-relaxed text-ink">
                Entre no Meu Pluggy com seu próprio acesso e conecte seus bancos
                e cartões. Seu parceiro ou parceira fará o mesmo no perfil dele
                ou dela.
              </p>
              <p className="m-0 text-sm leading-relaxed text-muted">
                Confira os dados solicitados e o prazo de autorização na tela do
                banco. Nunca informe senha bancária no Entre Nós.
              </p>
              <div>
                <a
                  className="text-sm font-medium text-accent-ink hover:underline"
                  href="https://meu.pluggy.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir Meu Pluggy ↗
                </a>
              </div>
              <p className="ds-caption">
                Usamos somente consultas: não fazemos pagamentos ou
                transferências.
              </p>
              <div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy}
                  onClick={() => setGuideStep(2)}
                >
                  Já autorizei meus bancos · continuar
                </Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="m-0 text-sm leading-relaxed text-ink">
                No painel da Pluggy, copie as chaves da sua aplicação pessoal
                para que o Entre Nós possa consultar seus extratos com segurança.
              </p>
              <div>
                <a
                  className="text-sm font-medium text-accent-ink hover:underline"
                  href="https://dashboard.pluggy.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Abrir painel da Pluggy ↗
                </a>
              </div>
              {data.hasCredentials && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/25 bg-ok-bg/70 px-3.5 py-2.5">
                  <span className="text-sm font-medium text-ok">
                    ✓ Chaves de acesso já configuradas neste perfil.
                  </span>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => setGuideStep(3)}
                  >
                    Continuar para adicionar banco
                  </Button>
                </div>
              )}
              <Collapsible
                defaultOpen={!data.hasCredentials}
                summary={
                  data.hasCredentials
                    ? "Atualizar chaves de acesso (avançado)"
                    : "Informar chaves de acesso"
                }
              >
                <p className="ds-caption mb-3">
                  Abra <strong>Applications → sua aplicação</strong> na Pluggy e
                  copie o Client ID e o Client Secret. Elas serão cifradas e não
                  ficam visíveis para o outro titular.
                </p>
                <form
                  className="flex flex-col gap-3"
                  autoComplete="off"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = fields(e),
                      form = e.currentTarget;
                    void work(async () => {
                      await api("banks/credentials", {
                        clientId: v.clientId,
                        clientSecret: v.clientSecret,
                        consent: v.consent === "on",
                      });
                      form.reset();
                      setGuideStep(3);
                    }, "Seu acesso foi protegido. Agora adicione cada banco.");
                  }}
                >
                  <Field label="Chave pública (Client ID)">
                    <input
                      name="clientId"
                      autoComplete="off"
                      required
                      minLength={8}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Chave secreta (Client Secret)">
                    <input
                      name="clientSecret"
                      type="password"
                      autoComplete="off"
                      required
                      minLength={8}
                      maxLength={500}
                    />
                  </Field>
                  <label className="bank-consent flex items-start gap-2 text-sm text-ink">
                    <input name="consent" type="checkbox" required />
                    Autorizo consultar minhas contas e compartilhar os
                    movimentos com esta família no Entre Nós.
                  </label>
                  <div>
                    <Button
                      type="submit"
                      variant={data.hasCredentials ? "secondary" : "primary"}
                      disabled={busy || !data.storageReady}
                    >
                      Proteger meu acesso
                    </Button>
                  </div>
                </form>
              </Collapsible>
            </>
          )}

          {step === 3 && (
            <>
              <p className="m-0 text-sm leading-relaxed text-ink">
                No painel da Pluggy (
                <strong>Demo → Connect Account → MeuPluggy</strong>), selecione
                o banco autorizado e copie o link ou o código da conexão criada.
              </p>
              <div>
                <a
                  className="text-sm font-medium text-accent-ink hover:underline"
                  href="https://meu.pluggy.ai/api-guide"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ver guia oficial com as telas ↗
                </a>
              </div>
              <p className="ds-caption">
                Seu parceiro já conectou o mesmo banco? Não conecte novamente a
                mesma conta. Para renovar uma autorização vencida, use “Renovar”
                na conexão existente.
              </p>
              {!data.hasCredentials && (
                <p
                  role="status"
                  className="m-0 rounded-xl border border-info/25 bg-info-bg px-3.5 py-2.5 text-sm text-ink"
                >
                  Primeiro informe suas chaves de acesso na etapa 2.
                </p>
              )}
              {data.hasCredentials && (
                <Collapsible defaultOpen summary="Identificar meu banco">
                  <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const v = fields(e),
                        form = e.currentTarget;
                      void work(async () => {
                        await api("banks/connect", {
                          item_id: pluggyItemId(String(v.item_id)),
                          label: v.label,
                          start_date: v.start_date,
                          consent: v.consent === "on",
                        });
                        form.reset();
                        setGuideStep(4);
                      }, "Conexão identificada. Vincule as contas antes de ler os movimentos.");
                    }}
                  >
                    <Field label="Nome para identificar">
                      <input
                        name="label"
                        required
                        maxLength={120}
                        placeholder="Ex.: meu Nubank…"
                      />
                    </Field>
                    <Field
                      label="Código ou link da conexão"
                      hint="Cole o link da tela da conexão na Pluggy ou apenas o itemId."
                    >
                      <input
                        name="item_id"
                        required
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={2048}
                      />
                    </Field>
                    <Field label="Começar a conferir por">
                      <input
                        name="start_date"
                        type="date"
                        required
                        defaultValue={
                          new Date()
                            .toLocaleDateString("sv-SE", {
                              timeZone: "America/Sao_Paulo",
                            })
                            .slice(0, 7) + "-01"
                        }
                      />
                    </Field>
                    <label className="bank-consent flex items-start gap-2 text-sm text-ink">
                      <input name="consent" type="checkbox" required />
                      Sou titular desta conexão e autorizei a leitura pelo Meu
                      Pluggy.
                    </label>
                    <div>
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={busy || !data.storageReady}
                      >
                        Adicionar banco
                      </Button>
                    </div>
                  </form>
                </Collapsible>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <p className="m-0 text-sm leading-relaxed text-ink">
                Escolha a conta do Entre Nós correspondente a cada conta ou
                cartão do banco. Reutilize as contas que já têm histórico.
              </p>
              <p className="ds-caption">
                Vincular uma conta não altera o saldo inicial nem confirma
                movimentos.
              </p>
              <p
                role="status"
                className="m-0 rounded-xl border border-info/25 bg-info-bg px-3.5 py-2.5 text-sm text-ink"
              >
                {unmapped.length > 0
                  ? `Faltam ${unmapped.length} contas ou cartões seus para vincular.`
                  : ownConnections.length
                    ? ownAccounts.length
                      ? "Suas contas disponíveis em reais estão vinculadas."
                      : "Esta conexão ainda não retornou contas em reais. Confira a autorização no Meu Pluggy."
                    : "Adicione um banco na etapa 3 para continuar."}
              </p>
              <ul className="m-0 list-disc pl-5 text-sm text-ink">
                {ownConnections.map((c) => (
                  <li key={c.id}>
                    <a
                      className="text-accent-ink hover:underline"
                      href={"#bank-connection-" + c.id}
                    >
                      {c.label} · {c.owner_label}
                    </a>
                  </li>
                ))}
              </ul>
              <div>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy || !ownAccounts.length || unmapped.length > 0}
                  onClick={() => setGuideStep(5)}
                >
                  Contas vinculadas · continuar
                </Button>
              </div>
            </>
          )}

          {step === 5 && (
            <>
              <p className="m-0 text-sm leading-relaxed text-ink">
                Em cada conexão acima, toque em{" "}
                <strong>Ler atualização disponível</strong>. Os movimentos
                aparecem em <strong>Movimentos</strong> e os pendentes ficam na
                aba <strong>A conferir</strong>.
              </p>
              <ul className="m-0 list-disc pl-5 text-sm text-ink">
                {ownConnections.map((c) => (
                  <li key={c.id}>
                    <a
                      className="text-accent-ink hover:underline"
                      href={"#bank-connection-" + c.id}
                    >
                      {c.label} ·{" "}
                      {c.last_read_at
                        ? "Já teve leitura"
                        : "Aguardando primeira leitura"}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <Collapsible summary="Preciso de ajuda">
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p className="m-0">
              <strong className="text-ink">Não achei o código (itemId):</strong>{" "}
              abra a conexão criada em Demo no painel da Pluggy e copie o link
              que contém itemId.
            </p>
            <p className="m-0">
              <strong className="text-ink">Apareceu o banco direto:</strong>{" "}
              volte à escolha do conector e selecione MeuPluggy para usar a
              autorização já feita no Meu Pluggy.
            </p>
            <p className="m-0">
              <strong className="text-ink">A autorização venceu:</strong> renove
              no Meu Pluggy ou no banco e use “Renovar” no menu ⋯ da conexão
              existente.
            </p>
            <p className="m-0">
              <strong className="text-ink">Quero parar:</strong> “Pausar
              leitura” interrompe nossas consultas mantendo seus registros.
            </p>
          </div>
        </Collapsible>
      </Panel>
    </div>
  );
}
