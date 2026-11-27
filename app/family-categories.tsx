"use client";
import { useState } from "react";
import { Button } from "./ds/button.tsx";
// Desenho do ícone por categoria. A ordem importa: a primeira regex que casa
// vence, então as categorias mais específicas vêm antes das mais amplas. Cobre
// as categorias-semente (auth.ts) e as criadas pelo categorizador (assisted.ts);
// o que não casa cai no ícone genérico de etiqueta.
const ICON_RULES: [RegExp, string][] = [
  // Cartões / fatura -> cartão de crédito (antes de "compra", que também casa
  // em "compra no cartão")
  [/\bcartao\b|\bcartoes\b|fatura|credito/, "M3 6h18v12H3zM3 10h18M7 15h4"],
  // Supermercado e feira -> carrinho
  [/supermerc|feira|mercado|hortifr|acougue|padaria/, "M3 3h2l3 12h10l3-9H6M9 20h.01M18 20h.01"],
  // Alimentação / fora -> talheres
  [/aliment|lanche|restaurante|comida|cafe/, "M5 3v7m3-7v7M3 7h7m-4 3v11M17 3v18m0-18c-5 4-5 9 0 9"],
  // Moradia -> casa
  [/morad|casa|aluguel|condomin|energ|agua|saneam/, "m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7"],
  // Transporte -> carro
  [/transpor|combust|gasolina|uber|pedagio|estacion/, "m5 7 2-4h10l2 4M3 8h18v10H3zM6 12h.01M18 12h.01M5 18v3m14-3v3"],
  // Saúde -> cruz médica
  [/saude|farmac|droga|medic|remed|terapia|psico/, "M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"],
  // Seguros -> escudo
  [/seguro|previden/, "M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"],
  // Cuidados infantis / Família -> pessoas
  [/infantil|crianc|fralda|bebe|familia|baba/, "M9 7a3 3 0 1 0 0 1M4 21v-2a4 4 0 0 1 4-4h2M16 11a3 3 0 1 0 0 1M14 21v-2a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4v2"],
  // Pet -> patinha
  [/\bpet\b|racao|veterin|animal/, "M5 10a1.6 1.6 0 1 0 0 1M9 6a1.6 1.6 0 1 0 0 1M15 6a1.6 1.6 0 1 0 0 1M19 10a1.6 1.6 0 1 0 0 1M12 13c-2 0-4 1.5-4 4 0 1.5 1 2 2 2h4c1 0 2-.5 2-2 0-2.5-2-4-4-4z"],
  // Educação -> capelo
  [/educa|curso|escola|faculdade|universidade|livro/, "m2 8 10-5 10 5-10 5-10-5M6 10v7c4 3 8 3 12 0v-7m4-2v8"],
  // Lazer -> ingresso/pipoca
  [/lazer|academia|cinema|passeio|fitness|shopping/, "M3 8h18v13H3zM8 8V4h8v4M8 8v13m8-13v13"],
  // Viagens -> avião
  [/viag|passaporte|hotel|airbnb|voo/, "M10 3 4 13l-2-.5.5 3.5 3 .5 10-6M14 11l6 10h-3l-4-6"],
  // Assinaturas e streaming -> play
  [/assinatura|streaming|netflix|spotify|disney/, "M4 4h16v12H4zM9 8l5 2-5 2zM8 20h8"],
  // Telefonia e internet -> celular
  [/telefon|internet|celular|\bvivo\b|\bclaro\b/, "M8 3h8v18H8zM11 17h2"],
  // Impostos e tarifas -> recibo
  [/tarifa|impost|taxa|\biof\b|ipva/, "M5 3h14v18l-3-2-4 2-4-2-3 2zM8 7h8M8 11h8M8 15h4"],
  // Doações -> coração/mão
  [/doac|dizim|oferta|igreja|caridade/, "M12 20s-7-4.5-9-9a4 4 0 0 1 9-3 4 4 0 0 1 9 3c-2 4.5-9 9-9 9z"],
  // Compras pessoais / vestuário -> sacola
  [/compra|roupa|vest|pessoal|cosmetic/, "M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0"],
  // Receitas profissionais / Rendimentos / Atividade profissional -> dinheiro
  [/receita|rendiment|salario|profissional|cashback/, "M3 6h18v12H3zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M6 9h.01M18 15h.01"],
];
const GENERIC_ICON = "M20.6 13.4 10.6 3.4A2 2 0 0 0 9.2 3H4v5.2a2 2 0 0 0 .6 1.4l10 10a2 2 0 0 0 2.8 0l3.2-3.2a2 2 0 0 0 0-2.8zM7.5 7.5h.01";
export function CategoryIcon({ name }: { name: string }) {
  const n = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const path = ICON_RULES.find(([re]) => re.test(n))?.[1] ?? GENERIC_ICON;
  return (
    <svg
      className="size-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
export function CategoryPicker({
  categories,
  value,
  required = false,
}: {
  categories: { id: string; name: string }[];
  value?: string | null;
  required?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded
    ? categories
    : categories.filter((c, i) => i < 8 || c.id === value);
  return (
    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-ink">
        Categoria{required ? "" : " (opcional)"}
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {!required && (
          <label className="category-choice relative block min-w-0 cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name="category_id"
              value=""
              defaultChecked={!value}
            />
            <span className="flex h-full min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-1.5 py-2 text-center text-xs leading-snug text-ink transition-colors hover:bg-surface-2 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent [overflow-wrap:anywhere]">
              <CategoryIcon name="Sem categoria" />
              Sem categoria
            </span>
          </label>
        )}
        {shown.map((c) => (
          <label
            className="category-choice relative block min-w-0 cursor-pointer"
            key={c.id}
          >
            <input
              className="peer sr-only"
              type="radio"
              name="category_id"
              value={c.id}
              required={required}
              defaultChecked={c.id === value}
            />
            <span className="flex h-full min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-surface px-1.5 py-2 text-center text-xs leading-snug text-ink transition-colors hover:bg-surface-2 peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent [overflow-wrap:anywhere]">
              <CategoryIcon name={c.name} />
              {c.name}
            </span>
          </label>
        ))}
      </div>
      {!expanded && categories.length > 8 && (
        <Button
          variant="quiet"
          size="sm"
          className="self-start"
          onClick={() => setExpanded(true)}
        >
          Ver todas as categorias
        </Button>
      )}
    </fieldset>
  );
}
