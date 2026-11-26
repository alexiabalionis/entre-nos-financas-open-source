"use client";
// Cabeçalho único da aba Mês: saudação (nomes + avatares de quem usa o
// espaço) e o Stepper de período, abaixo. Extraído para não duplicar o bloco
// entre app/month-screen.tsx (vitrine) e app/family.tsx (app) — um só lugar
// monta a saudação e o Stepper, os dois chamadores só passam os dados.
import type { ReactNode } from "react";
import { Stepper } from "../../ds/stepper.tsx";
import { AvatarCluster } from "../../ds/avatar-cluster.tsx";
import { Greeting } from "./greeting.tsx";

export type MonthHeaderPerson = {
  name: string;
};

type MonthHeaderProps = {
  /** Pessoas da saudação ("Oi, A e B"), na ordem em que aparecem. Ausente:
   *  o cabeçalho mostra só o Stepper (a saudação mora em outro lugar). */
  people?: MonthHeaderPerson[];
  /** Texto central do Stepper (mês). */
  label: ReactNode;
  /** Legenda abaixo do mês (statusWord do servidor, ou o fallback do modelo). */
  caption?: ReactNode;
  prevLabel?: string;
  nextLabel?: string;
  /** aria-label do botão do mês, quando ele abre o seletor de período. */
  labelAriaLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  /** Presente: o nome do mês abre o seletor de período. Ausente: só texto. */
  onLabelClick?: () => void;
};

// Cor por pessoa: ciclo de tokens --family-cat-N (dado, não cor fixa do
// componente) — mesma ordem usada pela vitrine /preview-mes para a primeira e
// a segunda pessoa (cat-6, cat-4), seguindo para as demais cores da paleta.
const AVATAR_CATEGORY_TOKENS = [6, 4, 2, 9, 7, 10, 1, 3, 5, 8, 11, 12];

export function personColor(index: number): string {
  return `var(--family-cat-${AVATAR_CATEGORY_TOKENS[index % AVATAR_CATEGORY_TOKENS.length]})`;
}

export function MonthHeader({
  people,
  label,
  caption,
  prevLabel,
  nextLabel,
  labelAriaLabel,
  onPrev,
  onNext,
  onLabelClick,
}: MonthHeaderProps) {
  return (
    <div data-tour="month">
      {people && (
        <div className="ds-greet">
          <Greeting people={people} />
          <AvatarCluster
            people={people.map((p, i) => ({
              initial: p.name.charAt(0),
              color: personColor(i),
            }))}
          />
        </div>
      )}
      <Stepper
        label={label}
        caption={caption}
        prevLabel={prevLabel}
        nextLabel={nextLabel}
        labelAriaLabel={labelAriaLabel}
        onPrev={onPrev}
        onNext={onNext}
        onLabelClick={onLabelClick}
      />
    </div>
  );
}
