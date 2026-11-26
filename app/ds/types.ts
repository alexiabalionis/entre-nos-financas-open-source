// Tipos compartilhados da camada 1. Arquivo .ts sem JSX, para os modelos puros
// (e seus testes com node --experimental-strip-types) poderem importá-los.
// Os componentes .tsx reexportam daqui.
import type { Tone } from "./shared.ts";

/** Item da trilha de meses (MonthRail). */
export type RailItem = {
  key: string;
  label: string; // ex.: "jan/27" (vem pronto do chamador)
  caption?: string; // linha secundária curta
  marks?: number; // quantos marcadores (pontos) mostrar
  tone?: Tone; // destaque do item
};

/** Camada de uma barra empilhada (StackedBars). */
export type BarLayer = {
  key: string;
  label: string; // legenda
  color: string; // cor de dado (ex.: "var(--family-cat-4)")
  estimate?: boolean; // desenha com hachura = valor estimado
};

/** Um trilho do LaneTracks. */
export type Lane = {
  key: string;
  label: string; // nome à esquerda
  color: string; // cor de dado da barra
  end: number | null; // índice da coluna em que termina; null = além do horizonte
  endLabel: string; // texto à direita
};

/** Linha da CalcList. */
export type CalcLine = {
  key: string;
  label: string;
  note?: string; // texto pequeno sob o rótulo
  value: number; // reais; o sinal define a cor (negativo = is-neg)
  op?: "+" | "−" | "="; // símbolo à esquerda (opcional)
  estimate?: boolean; // marca "estimativa"
  highlight?: boolean; // ex.: item simulado
  nested?: boolean; // detalhe da linha de cima: recuado, sem operador e fora da soma
};

/** Linha da DiffList (antes -> depois). */
export type DiffRow = {
  key: string;
  label: string;
  before: string; // já formatado
  after: string;
  sense: number; // > 0 melhorou, < 0 piorou, 0 neutro
  delta?: string; // "2 meses antes", "+R$ 150"
};
