"use client";
import { Button } from "../button";
import { Callout } from "../ds/callout";

/**
 * L1: transação do banco ainda não vira conta fixa. Em "A conferir" leva à
 * aprovação; se já conta nos totais e só espera o banco, apenas explica.
 */
export function FixedPendingNotice({
  description,
  confirming,
  onApprove,
  onClose,
}: {
  description: string;
  confirming: boolean;
  onApprove: () => void;
  onClose: () => void;
}) {
  if (confirming)
    return (
      <>
        <Callout
          tone="warn"
          icon="!"
          title="O banco ainda está confirmando esta transação"
        >
          {description} já aparece nos seus totais, mas o banco ainda não
          confirmou. Depois de aprovada, ela poderá virar conta fixa.
        </Callout>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="primary" onClick={onClose}>
            Entendi
          </Button>
        </div>
      </>
    );
  return (
    <>
      <Callout
        tone="warn"
        icon="!"
        title="Este movimento precisa ser aprovado antes"
      >
        {description} veio do banco e ainda espera o seu OK. Assim a conta
        fixa já nasce com o valor e a categoria que você conferiu.
      </Callout>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>
          Agora não
        </Button>
        <Button variant="primary" onClick={onApprove}>
          Ir para aprovação
        </Button>
      </div>
    </>
  );
}
