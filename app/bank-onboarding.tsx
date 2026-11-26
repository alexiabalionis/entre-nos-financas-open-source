"use client";
import { Button } from "./ds/button";
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
}: Props) {
  return (
    <div
      id="bank-onboarding"
      className="bank-onboarding min-w-0 scroll-mt-6 rounded-box bg-base-200 p-4 [overflow-wrap:anywhere]"
      role="region"
      aria-label="Conectar meus bancos"
    >
      <Panel title="Conectar meus bancos">
        <p className="ds-caption text-xs opacity-60">
          Cada pessoa faz este passo a passo no próprio perfil. Seus movimentos
          ficam apenas na sua família no Entre Nós; o outro casal não tem
          acesso. A Pluggy processa os dados que você autorizar.
        </p>
        <nav aria-label="Etapas da conexão bancária">
          <ol className="steps w-full overflow-x-auto">
            {[
              "Autorizar",
              "Proteger acesso",
              "Adicionar banco",
              "Vincular contas",
              "Conferir",
            ].map((label, index) => (
              <li
                key={label}
                className={"step" + (index + 1 <= step ? " step-primary" : "")}
                data-content={index + 1}
              >
                <button
                  className={
                    "btn btn-xs btn-ghost" +
                    (step === index + 1 ? " font-semibold" : "")
                  }
                  type="button"
                  aria-current={step === index + 1 ? "step" : undefined}
                  disabled={busy}
                  onClick={() => setGuideStep(index + 1)}
                >
                  {label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="bank-step-content flex flex-col gap-3" key={step}>
          <h4 tabIndex={-1} className="text-sm font-semibold">
            Etapa {step} de 5 ·{" "}
            {
              [
                "Autorize suas contas",
                "Proteja seu acesso",
                "Adicione um banco seu",
                "Escolha as contas correspondentes",
                "Leia e confira os movimentos",
              ][step - 1]
            }
          </h4>
          {step === 1 && (
            <>
              <p className="text-sm">
                Entre no Meu Pluggy com seu próprio acesso e conecte seus bancos
                e cartões. Seu parceiro ou parceira fará o mesmo no perfil dele
                ou dela.
              </p>
              <p className="text-sm">
                Confira os dados solicitados e o prazo de autorização na tela do
                banco. Nunca informe senha bancária no Entre Nós.
              </p>
              <a
                className="link link-primary text-sm"
                href="https://meu.pluggy.ai"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir Meu Pluggy ↗
              </a>
              <p className="ds-caption text-xs opacity-60">
                Usamos somente consultas: não fazemos pagamentos ou
                transferências. As condições e a frequência de atualização
                dependem do plano da Pluggy e do banco.
              </p>
              <Button
                type="button"
                variant="primary"
                disabled={busy}
                onClick={() => setGuideStep(2)}
              >
                Já autorizei meus bancos · continuar
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-sm">
                Entre no painel da Pluggy com o mesmo acesso do Meu Pluggy. Abra{" "}
                <strong>Applications → sua aplicação</strong> e copie o Client
                ID e o Client Secret. Use as credenciais do seu próprio acesso.
              </p>
              <a
                className="link link-primary text-sm"
                href="https://dashboard.pluggy.ai"
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir painel da Pluggy ↗
              </a>
              <p className="ds-caption text-xs opacity-60">
                Se você já salvou seu acesso aqui, pode continuar. Gerar um novo
                Client Secret pode invalidar o anterior; não é necessário gerar
                outro a cada banco.
              </p>
              <Collapsible
                className="bank-setup"
                defaultOpen
                summary={
                  data.hasCredentials
                    ? "Atualizar meu acesso à API"
                    : "Configurar meu acesso à API"
                }
              >
                <p className="ds-caption text-xs opacity-60">
                  Credenciais da API da Pluggy. Nunca informe senha bancária.
                  Elas serão cifradas e não poderão ser vistas pelo outro
                  titular.
                </p>
                <form
                  className="flex flex-col gap-2"
                  autoComplete="off"
                  onSubmit={(e) => {
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
                    }, "Seu acesso foi protegido. Agora adicione o itemId de cada banco.");
                  }}
                >
                  <Field label="Client ID">
                    <input
                      name="clientId"
                      autoComplete="off"
                      required
                      minLength={8}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Client Secret">
                    <input
                      name="clientSecret"
                      type="password"
                      autoComplete="off"
                      required
                      minLength={8}
                      maxLength={500}
                    />
                  </Field>
                  <label className="bank-consent flex items-start gap-2 text-sm">
                    <input name="consent" type="checkbox" required />
                    Autorizo consultar minhas contas e compartilhar os
                    movimentos com esta família no Entre Nós.
                  </label>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !data.storageReady}
                  >
                    Proteger meu acesso
                  </Button>
                </form>
              </Collapsible>
              {data.hasCredentials && (
                <button
                  className="btn btn-sm btn-soft"
                  type="button"
                  disabled={busy}
                  onClick={() => setGuideStep(3)}
                >
                  Meu acesso já está salvo · continuar
                </button>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <p className="text-sm">
                No painel da Pluggy, abra{" "}
                <strong>
                  Applications → sua aplicação → Demo → Connect Account
                </strong>
                . Escolha <strong>MeuPluggy</strong> e selecione um dos bancos
                já autorizados.
              </p>
              <p className="text-sm">
                Abra a conexão criada e copie o <strong>itemId</strong>, ou o
                link completo dessa tela. Repita esta etapa para cada banco.
              </p>
              <a
                className="link link-primary text-sm"
                href="https://meu.pluggy.ai/api-guide"
                target="_blank"
                rel="noopener noreferrer"
              >
                Ver guia oficial com as telas ↗
              </a>
              <p className="ds-caption text-xs opacity-60">
                Seu parceiro já conectou o mesmo banco? Confira o titular nas
                conexões abaixo. Não conecte novamente a mesma conta. Para
                renovar uma autorização, use “Renovar” na conexão existente.
              </p>
              {!data.hasCredentials && (
                <p role="status" className="alert alert-soft alert-info">
                  Primeiro proteja seu acesso na etapa 2.
                </p>
              )}
              {data.hasCredentials && (
                <Collapsible
                  className="bank-setup"
                  defaultOpen
                  summary="Identificar meu banco"
                >
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
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
                      }, "Conexão identificada, reutilizando o vínculo se já existia. Vincule as contas antes de ler os movimentos.");
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
                    <Field label="itemId ou link da conexão no painel Pluggy">
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
                    <label className="bank-consent flex items-start gap-2 text-sm">
                      <input name="consent" type="checkbox" required />
                      Sou titular desta conexão e autorizei a leitura pelo Meu
                      Pluggy.
                    </label>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={busy || !data.storageReady}
                    >
                      Adicionar banco
                    </Button>
                  </form>
                </Collapsible>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <p className="text-sm">
                Na lista abaixo, escolha a conta do Entre Nós correspondente a
                cada conta ou cartão do banco. Reutilize as contas que já têm
                histórico. Crie uma nova apenas quando ela ainda não existir.
              </p>
              <p className="ds-caption text-xs opacity-60">
                Vincular uma conta não altera o saldo inicial nem confirma
                movimentos. Uma conta já vinculada não pode ser vinculada outra
                vez.
              </p>
              {unmapped.length > 0 ? (
                <p role="status" className="alert alert-soft alert-info">
                  Faltam {unmapped.length} contas ou cartões seus para vincular.
                </p>
              ) : (
                <p role="status" className="alert alert-soft alert-info">
                  {ownConnections.length
                    ? ownAccounts.length
                      ? "Suas contas disponíveis em reais estão vinculadas."
                      : "Esta conexão ainda não retornou contas em reais. Confira a autorização no Meu Pluggy."
                    : "Adicione um banco na etapa 3 para continuar."}
                </p>
              )}
              <ul className="list-disc pl-5 text-sm">
                {ownConnections.map((c) => (
                  <li key={c.id}>
                    <a className="link" href={"#bank-connection-" + c.id}>
                      {c.label} · {c.owner_label}
                    </a>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="primary"
                disabled={busy || !ownAccounts.length || unmapped.length > 0}
                onClick={() => setGuideStep(5)}
              >
                Contas vinculadas · continuar
              </Button>
            </>
          )}
          {step === 5 && (
            <>
              <p className="text-sm">
                Em cada conexão abaixo, toque em{" "}
                <strong>Ler atualização disponível</strong>. Os movimentos
                aparecem em Movimentos e já contam nos totais do mês.
              </p>
              <p className="text-sm">
                Transferências entre suas contas, aplicações e pagamentos de
                fatura não contam como gasto. Repetições de algo já lançado
                contam uma vez só. Se algo não for de vocês, remova em
                Movimentos.
              </p>
              <ul className="list-disc pl-5 text-sm">
                {ownConnections.map((c) => (
                  <li key={c.id}>
                    <a className="link" href={"#bank-connection-" + c.id}>
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
        <Collapsible className="bank-help" summary="Preciso de ajuda">
          <p className="text-sm">
            <strong>Não achei o itemId:</strong> abra a conexão criada em Demo
            no painel da Pluggy e copie o link que contém itemId. Neste fluxo
            pessoal, precisamos do itemId de cada conexão; não descobrimos seus
            bancos automaticamente.
          </p>
          <p className="text-sm">
            <strong>Apareceu o banco direto:</strong> volte à escolha do
            conector e selecione MeuPluggy para usar a autorização já feita no
            Meu Pluggy.
          </p>
          <p className="text-sm">
            <strong>A autorização venceu:</strong> renove no Meu Pluggy ou no
            banco e use “Renovar” na conexão existente aqui. Assim preservamos o
            vínculo e o histórico.
          </p>
          <p className="text-sm">
            <strong>Quero parar:</strong> “Pausar leitura” interrompe nossas
            consultas. Para revogar o compartilhamento, use o Meu Pluggy ou o
            banco. Os registros anteriores permanecem no app.
          </p>
        </Collapsible>
      </Panel>
    </div>
  );
}
