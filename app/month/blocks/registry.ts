// Registro tipado dos blocos PERSONALIZÁVEIS da tela Mês (o herói fica fora
// — ver hero-block.tsx). Prepara a Etapa 4: estes 4 ids vão virar HomeBlocks
// reordenáveis. `satisfies` (em vez de `: Record<...>`) garante que adicionar
// um MonthBlockId sem entrada aqui quebra o tsc, preservando o tipo literal
// de cada Component.
import type { ReactNode } from "react";
import type { MonthBlockProps } from "./types.ts";
import { UpcomingBlock } from "./upcoming-block.tsx";
import { PendingBlock } from "./pending-block.tsx";
import { PathBlock } from "./path-block.tsx";
import { CompositionBlock } from "./composition-block.tsx";

export type MonthBlockId = "upcoming" | "pending" | "path" | "composition";

type MonthBlockEntry = { label: string; Component: (p: MonthBlockProps) => ReactNode };

export const MONTH_BLOCKS = {
  composition: { label: "Saídas por categoria", Component: CompositionBlock },
  upcoming: { label: "Vem aí", Component: UpcomingBlock },
  pending: { label: "Precisa de você", Component: PendingBlock },
  path: { label: "Caminho do saldo", Component: PathBlock },
} satisfies Record<MonthBlockId, MonthBlockEntry>;

// Ordem atual da tela: hero/avisos → Composição → Vem aí → Precisa de você →
// Caminho do saldo (hero fica no screen, fora deste array).
export const MONTH_BLOCK_ORDER: MonthBlockId[] = ["composition", "upcoming", "pending", "path"];
