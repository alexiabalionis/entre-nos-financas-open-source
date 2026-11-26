// Contrato comum de TODOS os blocos da tela Mês: cada bloco recebe o modelo
// já pronto (buildMonthModel) + a moeda, e decide sozinho se renderiza (null
// quando a condição atual esconderia o painel). Extraído de month-screen.tsx
// (Etapa 2) — nenhum bloco recebe props além destas duas.
import type { Currency } from "../../../src/domain/finance.ts";
import type { MonthModel } from "../model.ts";

export type MonthBlockProps = { model: MonthModel; currency: Currency };
