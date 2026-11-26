import { CategoryIcon } from "../../family-categories.tsx";

// Ícone de categoria injetado no buildMonthModel (iconFor). Um só lugar para
// a tela Mês da home e a preview.
export const categoryIconFor = (name: string) => <CategoryIcon name={name} />;
