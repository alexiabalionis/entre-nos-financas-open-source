# Spec · Componentes do Copiloto Futuro (frontend)

> **Para quem é este documento:** um agente de código que vai **construir componentes reutilizáveis**, um
> por vez. Ele foi escrito para ser seguido ao pé da letra. Se algo aqui parecer ambíguo, **pare e pergunte**
> em vez de inventar. Não pule etapas de verificação.
>
> **O que este documento NÃO pede:** montar a tela final `/copiloto`. Isso é uma tarefa posterior, que vai
> só compor as peças daqui. Também não pede backend (ver `docs/SPEC-COPILOTO-FUTURO-BACKEND.md`).

---

## 0. Como trabalhar (leia antes de tudo)

1. Trabalhe na branch `feat/copiloto-futuro-ui` (crie a partir da branch atual). Não faça commit em `main`.
2. **Uma tarefa = um commit.** As tarefas estão numeradas (`T01`, `T02`, …). Faça na ordem da seção 9.
3. Antes de começar uma tarefa, leia a seção dela inteira **e** as Regras (seção 3).
4. Ao terminar cada tarefa, rode **todos** os comandos da seção 4. Só faça o commit se todos passarem.
5. Mensagem de commit: `feat(ds): <Componente>` para a camada 1, `feat(futuro): <Componente>` para a camada 2.
6. **Não edite** arquivos fora da lista "Arquivos" da tarefa. Exceções permitidas: os índices
   `app/ds/index.ts` e `app/future/index.ts`, os arquivos CSS indicados e a vitrine (T30).
7. **Nunca edite** `app/copilot/*`, `app/hooks/use-copilot.ts`, `src/**` nem `app/preview-copiloto/*`.
   `app/preview-copiloto/*` é **só para leitura**: é o protótipo aprovado e a referência visual/comportamental.
8. Pare e pergunte se: um teste existente quebrar; você precisar mudar um tipo de `src/domain/future-months.ts`;
   um token de cor de que você precisa não existir; ou o comportamento do protótipo contradisser esta spec.

### Referência visual

Rode o app (`npm run dev`) e abra `http://localhost:3210/preview-copiloto?v=ab`. Esse é o design aprovado
(variante "A+B"). Os componentes daqui reproduzem as peças dessa tela, mas com os tokens do app real.
As variantes `?v=c` (simulador) e `?v=d` também têm peças que reaproveitamos (indicado em cada tarefa).

---

## 1. Objetivo

Criar um conjunto de peças que:

- montam a nova tela do Copiloto ("o futuro de vocês, mês a mês");
- **serão reutilizadas em outras telas** (Mês, Cartões, Objetivos), por isso ficam separadas em camadas e
  não sabem em qual página estão.

Resultado esperado ao fim desta spec:

- **Camada 1 — `app/ds/`:** primitivos genéricos, sem nada de finanças (ícone, botão de ícone, seletor
  segmentado, campo de valor, painel lateral, números animados, barras empilhadas, trilhos, trilha de meses,
  lista de conta, lista antes/depois, barra de rascunho).
- **Camada 2 — `app/future/`:** peças que conhecem o motor `src/domain/future-months.ts` (decodificação do
  fio, estado de simulação, modelos de visualização testados e componentes de domínio).
- **Vitrine — `app/preview-ds/futuro/`:** página que mostra cada peça com dados fixos, para conferência visual.

---

## 2. Arquitetura

```
src/domain/future-months.ts      ← motor puro (backend; já existe, NÃO editar)
        ▲
app/future/                      ← camada 2: domínio "futuro"
  *-model.ts   (lógica pura, testada)
  *.tsx        (componentes de domínio)
  use-future.ts / future-context.tsx
        ▲
app/ds/                          ← camada 1: primitivos genéricos (sem domínio)
```

### Regras de import (obrigatórias)

| Arquivo em…        | Pode importar de…                                                     | Não pode importar de…                 |
| ------------------ | --------------------------------------------------------------------- | ------------------------------------- |
| `app/ds/`          | `react`, outros arquivos de `app/ds/`, `app/lib/cents.ts`, `app/button.tsx` | `src/**`, `app/future/`, `app/copilot/`, demais arquivos de `app/lib/` |
| `app/future/`      | `react`, `app/ds/`, `app/lib/`, `src/domain/future-months.ts`, `src/domain/format.ts` | `src/server/**`, `app/copilot/`, `app/preview-copiloto/` |
| páginas (`app/(app)/…`, vitrine) | `app/future/`, `app/ds/`, `app/session/`, `app/lib/`     | `app/preview-copiloto/`               |

Para importar só **tipos** do servidor (ex.: `FutureWire`), use `import type` — isso é permitido em
`app/future/use-future.ts` e só lá.

### Convenções de arquivo

- Componentes: `kebab-case.tsx`, um componente exportado principal por arquivo, começando com `"use client";`.
- Lógica pura: `kebab-case-model.ts` (ou `.ts` sem JSX). **Imports com extensão `.ts` explícita** e só de
  arquivos `.ts` (é o que permite rodar os testes com `node --experimental-strip-types`).
- Testes: `tests-js/<nome>.test.ts`, com `node:test` e `node:assert/strict` (copie o estilo de
  `tests-js/chart-data.test.ts`).
- Cada componente exportado tem um comentário `/** … */` de 2–5 linhas em português dizendo o que faz e
  o que **não** faz (veja `app/ds/money-text.tsx` como exemplo).
- Índices: `app/ds/index.ts` e `app/future/index.ts` reexportam tudo o que é público
  (`export { X } from "./x.tsx";`). Crie os arquivos se não existirem.

---

## 3. Regras invioláveis

Releia esta lista antes de cada tarefa.

**Cor e tema**

1. Só use tokens `--family-*` (lista na seção 5.1), os tokens de movimento `--ds-ease*`/`--ds-dur-*`
   (seção 5.5) e `var(--tone)` / `var(--tone-bg)`. **Zero hex, rgb ou
   hsl no código ou no CSS.** A única exceção é cor de **dado** passada por prop (`color: string`) e
   aplicada via `style` — mesma regra de `app/ds/segmented-bar.tsx`.
2. Tom semântico é sempre o tipo `Tone` de `app/ds/shared.ts` aplicado com `toneAttr(tone)`. Não crie
   outro enum de tom.
3. Não use tokens `--cf-*` nem `--c-*` do protótipo. Ao portar CSS do protótipo, **troque** cada um pelo
   `--family-*` equivalente da tabela da seção 5.2.
4. Tudo deve funcionar no tema claro e no escuro. O tema escuro vem de `[data-theme="dark"]` no
   `<html>` (os tokens já mudam sozinhos — não escreva regras de tema nos seus arquivos).
5. Nas peças, **nunca** escreva nome de fonte em `font-family`. Texto: `var(--family-font-sans)`. Números
   e valores: `var(--family-font-numeric)` com `font-variant-numeric: tabular-nums`. A nova tela usa
   **Instrument Sans**, mas ela entra só pela T19 (`FutureScope`), que redefine `--family-font-sans`
   dentro da tela nova. Fora dela, as mesmas peças continuam em DM Sans sozinhas. Não use Manrope.

**Dinheiro**

6. No domínio e na camada 2, dinheiro é **centavos `bigint`**. A camada 1 recebe **reais em `number`**
   (como `MoneyText`). A conversão acontece **só** com as funções de `app/lib/cents.ts` (T01). Nunca faça
   `Number(x) / 100` espalhado pelo código.
7. Todo valor exibido respeita **"ocultar valores"** (`hidden`): mostra `••••`. Na camada 1, o primitivo
   que mostra valor aceita `hidden?: boolean`. Na camada 2, `hidden` vem do contexto (T21).
8. Formato: `R$ 4.100` (reais inteiros, sem centavos) nas visualizações. Use `Intl.NumberFormat("pt-BR",
   { style: "currency", currency: "BRL", maximumFractionDigits: 0 })` — já encapsulado em `formatReais`
   (T01). Não use `toFixed`, não concatene `"R$ "` na mão.

**Acessibilidade**

9. Todo controle é um `<button type="button">`, `<input>`, `<select>` ou `<a>` nativo. Nada de `div`
   clicável. Exceção documentada: a faixa de um trilho (T10) pode ter `onClick` **se** existir um botão
   equivalente acessível por teclado.
10. Todo botão só com ícone tem `aria-label` em português.
11. Gráficos SVG: o `<svg>` é `aria-hidden`, e a informação está também em texto (rótulos, botões com
    `aria-label` ou lista). Nenhuma informação existe **só** na cor.
12. Alvo de toque mínimo 44×44 px em controles (exceto links de texto dentro de parágrafo).
13. Foco visível: não remova `outline` sem substituto. Use o padrão da seção 5.4.
14. Movimento: toda animação respeita `prefers-reduced-motion` (use `useReducedMotion`, T02). Com
    movimento reduzido, os valores trocam na hora e nada desliza.

**CSS**

15. CSS da camada 1 vai em `app/ds/ds-extra.css`; da camada 2, em `app/future/future.css`. Os dois são
    importados **uma vez** em `app/layout.tsx`, logo depois de `import "./family.css";` (T01 faz isso).
    Não edite `app/family.css` nem `app/globals.css`.
16. Prefixos de classe: `ds-` na camada 1, `fut-` na camada 2. **Os nomes de classe raiz são fixos**
    (tabela abaixo), para não colidir com classes que já existem em `family.css` — por exemplo, `.ds-rail`
    e `.ds-stepper` já existem e são de outras peças. Classes internas usam a raiz como prefixo
    (`.ds-mrail-item`, `.ds-bars-legend`). Antes de criar qualquer classe nova, rode
    `grep -n "\.<nome>\b" app/family.css app/globals.css` e confirme que não aparece nada.
    Única reutilização permitida: `AnimatedMoney` usa `ds-money`/`ds-cur`/`is-neg` de propósito.

    | Componente | Classe raiz | | Componente | Classe raiz |
    | --- | --- | --- | --- | --- |
    | IconButton | `ds-iconbtn` | | LaneTracks | `ds-lanes` |
    | Segmented | `ds-seg` | | CalcList | `ds-calc` |
    | AnimatedMoney | `ds-amoney` | | DiffList | `ds-diff` |
    | ChangedText | `ds-changed` | | DraftBar | `ds-draftbar` |
    | AmountStepper | `ds-amount` | | Icon | `ds-icon` |
    | Sheet | `ds-sheet` | | camada 2 | `fut-<nome-do-arquivo>` |
    | MonthRail | `ds-mrail` | | | |
    | StackedBars | `ds-bars` | | | |
17. `app/globals.css` estiliza `button`, `p`, `h1-h3`, `label`, `small`, `nav`, `input`, `select` **soltos**.
    Todo componente novo que use esses elementos aplica o reset da seção 5.3 na sua classe raiz.
17b. **Toda regra em `ds-extra.css` e `future.css` começa com `:root `** (ex.: `:root .ds-seg button`).
    As telas reais ficam dentro de `.family-app`, e `family.css` tem regras como `.family-app button`,
    `.family-app h2`, `.family-app p` e `.family-app input` (especificidade 0,1,1), que venciam as peças novas
    e trocavam fundo, cor, raio e altura. O `:root` soma uma classe e resolve sem tocar no CSS antigo.
    Exceção: `@keyframes` e os blocos de tokens `:root { … }`. O `Button` do app (`.ds-button`) fica fora
    do reset. Para conferir: na vitrine (que fica dentro de `.family-app`), as peças devem ter o mesmo
    estilo calculado com e sem a classe `family-app` na raiz.
18. Sem `!important`. Sem `position: fixed` (exceto `Sheet` e `DraftBar`, que já dizem como).
19. Layout responsivo: tem que funcionar de 320 px a 1440 px **sem rolagem horizontal da página**.
    Gráficos largos rolam **dentro** do próprio contêiner (`overflow-x: auto`).

**Componentes**

20. Camada 1 não sabe o que é "fatura", "objetivo", "mês" financeiro etc. Se você está escrevendo uma
    palavra de finanças num arquivo de `app/ds/`, está no lugar errado. (Rótulos chegam por prop.)
21. Componentes não buscam dados. Só a T22 (`useFuture`) chama a API.
22. Nada de bibliotecas novas. Não use `recharts` nas peças novas (as visualizações daqui são SVG feito à
    mão, como no protótipo, porque precisam morfar). `ChartFrame` continua sendo o único lugar com recharts.
23. Textos de interface em português do Brasil, frases curtas, sem jargão ("folga", não "superávit").
    Copie as frases do protótipo quando existirem.
24. Modo leitura (`reader: true`, perfil que só lê): nenhuma ação de gravar aparece. Simular **pode**
    (não grava nada).

---

## 4. Verificação (rodar ao fim de toda tarefa)

```bash
npx tsc --noEmit
npx eslint app/ds app/future app/preview-ds tests-js --max-warnings=0
npm test
```

- Os três têm que passar. Se `tsc` acusar erro **fora** dos seus arquivos e que já existia antes da sua
  tarefa (ex.: algo do backend em andamento), anote no commit e siga; não tente consertar.
- A partir da T30 (vitrine), também abra `http://localhost:3210/preview-ds/futuro` e confira a peça nova
  em 375 px e 1280 px de largura, tema claro e escuro (seção 8).

---

## 5. Referências fixas

### 5.1 Tokens disponíveis (`app/family.css`)

- Superfícies: `--family-bg`, `--family-surface`, `--family-surface-2`, `--family-soft`, `--family-tint`
- Texto: `--family-text`, `--family-muted`, `--family-on-accent`, `--family-on-lime`
- Linhas e trilhos: `--family-line`, `--family-track`, `--family-track-2`
- Marca: `--family-accent` (muda por pessoa), `--family-accent-soft`, `--family-lime`
- Estados: `--family-success(-bg)`, `--family-warn(-bg)`, `--family-danger(-bg)`, `--family-info`
- Categorias (cor de dado): `--family-cat-1` … `--family-cat-12`, `--family-cat-cards`, `--family-cat-none`
- Gráfico: `--family-chart-grid`, `--family-chart-axis`, `--family-chart-label`
- Raios: `--family-radius-sm|md|lg|xl|pill`
- Espaço: `--family-space-1` … `--family-space-7`
- Fontes: `--family-font-sans`, `--family-font-numeric`

### 5.2 Troca de tokens do protótipo

| Protótipo (`copiloto.css`)         | Use                           |
| ---------------------------------- | ----------------------------- |
| `--c-ink`                          | `--family-text`               |
| `--c-muted`                        | `--family-muted`              |
| `--c-line`                         | `--family-line`               |
| `--c-surface`                      | `--family-surface`            |
| `--c-surface-2`, `--c-wash`        | `--family-surface-2`          |
| `--c-accent`                       | `--family-accent`             |
| `--c-accent-wash`                  | `--family-tint`               |
| `--c-good`                         | `--family-success`            |
| `--c-warn`                         | `--family-warn`               |
| `--c-bad`                          | `--family-danger`             |
| cores de objetivo/dívida (`res`, `trip`, `debt`) | cor de dado por prop (ver `goalColor`, T20) |
| `--r-sm`, `--r-md`, `--r-lg`       | `--family-radius-sm|md|lg`    |
| `--cf-font-display`, `--cf-font-journey` | `--family-font-sans`    |

Se aparecer um token do protótipo que não está nesta tabela, **pare e pergunte**.

### 5.3 Reset obrigatório (copie para a classe raiz de cada componente que usa elementos soltos)

```css
.ds-xxx :where(button) {
  border: 0; background: none; padding: 0; margin: 0; border-radius: 0;
  color: inherit; font: inherit; cursor: pointer; min-height: 0;
  display: inline-flex; align-items: center; gap: 6px; transition: none;
}
.ds-xxx :where(button):hover { background: none; }
.ds-xxx :where(button:disabled) { cursor: not-allowed; opacity: 0.45; }
.ds-xxx :where(h1, h2, h3, h4, p, ul, ol, dl, dd, figure) { margin: 0; }
.ds-xxx :where(h1, h2, h3, h4) { font-size: inherit; font-weight: 600; line-height: 1.2; color: inherit; }
.ds-xxx :where(p, label, small) { color: inherit; font-size: inherit; }
.ds-xxx :where(ul, ol) { padding: 0; list-style: none; }
```

Para não repetir, a T01 cria a classe utilitária **`.ds-reset`** com essas regras. Componentes novos
colocam `ds-reset` junto da classe raiz (`className={cx("ds-reset", "ds-xxx")}`) e não copiam o bloco.

### 5.4 Foco

```css
.ds-reset :where(button, a, input, select, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--family-accent);
  outline-offset: 3px;
  border-radius: var(--family-radius-sm);
}
```
(Também faz parte de `.ds-reset`.)

### 5.5 Movimento

O movimento aqui tem uma função: **mostrar o que mudou e para onde foi**. Quando uma simulação muda um
número, ele vai até o valor novo e fica marcado por um instante; barras e trilhos crescem ou encolhem em
vez de trocar de repente. Nada se mexe sozinho, sem uma ação de quem usa.

#### 5.5.1 Tokens (criados na T01, em `app/ds/ds-extra.css`)

```css
:root {
  --ds-ease: cubic-bezier(0.16, 1, 0.3, 1);       /* entradas, cor, realce */
  --ds-ease-move: cubic-bezier(0.22, 1, 0.36, 1); /* coisas que se deslocam */
  --ds-dur-press: 120ms;
  --ds-dur-fast: 200ms;
  --ds-dur: 280ms;
  --ds-dur-move: 380ms;
  --ds-dur-shape: 420ms;
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --ds-dur-press: 0ms; --ds-dur-fast: 0ms; --ds-dur: 0ms; --ds-dur-move: 0ms; --ds-dur-shape: 0ms;
  }
}
```

Keyframes (também na T01, definidos **uma vez**; a camada 2 reutiliza, não redefine):

```css
@keyframes ds-rise    { from { opacity: 0; transform: translateY(-4px); } }
@keyframes ds-fade    { from { opacity: 0; } }
@keyframes ds-sheet-in { from { opacity: 0; transform: translateX(40px); } }
@keyframes ds-sheet-up { from { transform: translateY(100%); } }
@keyframes ds-dock-in { from { opacity: 0; transform: translateY(24px); } }
@keyframes ds-reach   { 0% { transform: scale(0.7); } 60% { transform: scale(1.18); } }
```

#### 5.5.2 Regras

1. Toda declaração `animation:` fica **dentro** de `@media (prefers-reduced-motion: no-preference) { … }`.
   Toda `transition:` usa os tokens `--ds-dur-*` (que viram 0 com movimento reduzido). Nunca escreva
   duração em ms solta no CSS.
2. Em JS (tweens), use `useReducedMotion()`: com movimento reduzido, o valor final aparece na hora.
   `scrollIntoView` usa `behavior: reduced ? "auto" : "smooth"`.
3. Em CSS, anime só `transform`, `opacity`, `color`, `background-color`, `border-color` e `box-shadow`.
   Tamanho e posição de forma (alturas das barras, largura do trilho, posição do cursor) mudam **só pelo
   tween em JS** (`useTween`), nunca por `transition` de `width`/`height`/`left`/`top`.
4. Saídas são instantâneas (o que some, some na hora). Só entradas animam. Isso evita estados
   intermediários difíceis de acertar.
5. Nada de animação em loop, `infinite`, "bounce" ou "elastic". A única curva com passagem do ponto é
   `ds-reach` (bandeira alcançada), uma vez só.
6. Tweens em JS: curva `easeOutQuart` (`1 - (1 - t)^4`), já em `useTween` (T02).
7. Uma ação = no máximo um movimento por peça. Se um número já está indo até o valor novo, não faça ele
   também subir/aparecer.

#### 5.5.3 Catálogo (o que anima, em qual tarefa)

| Peça (tarefa) | Gatilho | O que acontece | Duração · curva | Com movimento reduzido |
| --- | --- | --- | --- | --- |
| `AnimatedMoney` (T05) | `value` muda | número vai do valor antigo até o novo (tween JS) | 320 ms · easeOutQuart | troca na hora |
| `AnimatedMoney`, `ChangedText` (T05) | valor/texto muda | fundo `--family-tint` aparece na hora, fica 1100 ms e some com `transition: background-color var(--ds-dur-shape) var(--ds-ease)` (a transição fica só na regra **sem** `[data-changed]`, para entrar seco e sair suave) | sai em `--ds-dur-shape` | realce aparece e some sem transição |
| Botões (`IconButton`, `Segmented`, itens do `MonthRail`) (T04, T08) | `:active` | `transform: scale(0.96)` | `--ds-dur-press` · `--ds-ease` | sem escala |
| `Segmented` (T04) | opção muda | pílula desliza até a opção (`transform: translateX`) | `--ds-dur-fast` · `--ds-ease-move` | pula |
| `Sheet` (T07) | abre | desktop: `ds-sheet-in`; mobile: `ds-sheet-up`; `::backdrop`: `ds-fade` | `--ds-dur-move` (fundo `--ds-dur`) · `--ds-ease` | aparece na hora |
| `Sheet` (T07) | fecha | instantâneo | — | — |
| `MonthRail` (T08) | `selected` muda | a fileira rola até o item no centro; o conteúdo do item selecionado entra com `ds-rise` (use `key={selected}` no invólucro do conteúdo para a animação rodar a cada troca) | rolagem nativa; `ds-rise` `--ds-dur` | rolagem `auto`; sem `ds-rise` |
| `StackedBars` (T09) | valores mudam (simulação) | alturas de cada camada vão até o novo valor (`useTween`) | 420 ms | troca na hora |
| `StackedBars` (T09) | horizonte muda (mais colunas) | colunas novas **crescem do zero** (`useTween(…, 420, "zero")`) | 420 ms | troca na hora |
| `StackedBars` (T09) | `selected` muda | faixa de seleção desliza (`transform: translateX`) | `--ds-dur-move` · `--ds-ease-move` | pula |
| `StackedBars` (T09) | contorno de comparação aparece | `ds-fade` | `--ds-dur` | aparece |
| `LaneTracks` (T10) | `end` muda | barra cresce/encolhe (tween JS da largura) | 460 ms | troca na hora |
| `LaneTracks` (T10) | `selected` muda | cursor desliza (tween JS) | 380 ms | pula |
| `LaneTracks` (T10) | bandeira passa a `data-passed` | `ds-reach` na bandeira | `--ds-dur-shape` · `--ds-ease` | só muda a cor |
| `CalcList` (T11) | linha nova aparece | `ds-rise` na linha | `--ds-dur` | aparece |
| `DiffList` (T12) | lista aparece | `ds-rise` por linha, com atraso `calc(var(--i) * 40ms)` (`style={{ "--i": idx }}`, máximo 6 linhas com atraso; da 7ª em diante, atraso da 6ª) | `--ds-dur` | aparece |
| `DraftBar` (T13) | `open` passa a true | `ds-dock-in` | `--ds-dur-move` · `--ds-ease` | aparece |
| `DraftBar` (T13) | entra/sai da confirmação | conteúdo novo com `ds-fade` | `--ds-dur-fast` | troca |
| `Headline` (T24) | frase muda | só o realce do `ChangedText` (a frase não desliza) | — | — |
| `StationCard`, `CardMonthPanel` (T26, T27) | mês muda | valores via `AnimatedMoney`; lista de itens com `ds-rise` (`key` = mês) | `--ds-dur` | troca |
| `PurchaseSimulator` (T28) | compra aplicada/retirada | nada próprio: quem anima são as barras e números que mudam | — | — |

#### 5.5.4 Como conferir (na vitrine, T30)

- Mude o aporte da reserva de R$ 500 para R$ 700: os números vão até o valor novo e ficam marcados, o
  trilho da reserva encolhe, a bandeira anda para a esquerda, a barra de simulação entra por baixo.
- Troque o horizonte de 1 ano para 3 anos: as colunas novas crescem do zero; as antigas não piscam.
- Ative movimento reduzido no DevTools e repita: tudo troca na hora, os realces de mudança continuam.
- No painel de desempenho do DevTools, mexer no aporte não deve gerar "Layout" contínuo (só o tween).

---

## 6. Camada 1 — primitivos (`app/ds/`)

Cada tarefa lista: **Arquivos**, **API** (tipo exato), **Comportamento**, **Referência no protótipo**,
**Teste** e **Pronto quando**.

### T01 · Base: centavos, formatação, CSS e reset

**Arquivos:** `app/lib/cents.ts`, `app/ds/ds-extra.css`, `app/future/future.css` (vazio com comentário de
cabeçalho), `app/layout.tsx` (só adicionar 2 imports), `app/ds/index.ts`, `app/future/index.ts`,
`tests-js/cents.test.ts`.

**API (`app/lib/cents.ts`):**

```ts
/** Centavos → reais (number). Arredonda para o real mais próximo (meio para cima). */
export function toReais(cents: bigint): number;
/** Reais (number inteiro) → centavos. Lança erro se não for inteiro finito. */
export function fromReais(reais: number): bigint;
/** "R$ 4.100" (sem centavos); "−R$ 150" para negativo; "••••" se hidden. */
export function formatReais(reais: number, hidden?: boolean): string;
/** Atalho: formatReais(toReais(cents), hidden). */
export function formatCents(cents: bigint, hidden?: boolean): string;
/** "+R$ 50" / "−R$ 50" / "R$ 0". */
export function formatSignedReais(reais: number, hidden?: boolean): string;
```

- O sinal de menos é o caractere `−` (U+2212), como no protótipo.
- `toReais(15050n)` → `151`; `toReais(15049n)` → `150`; `toReais(-15050n)` → `-151` (simétrico).

**CSS (`app/ds/ds-extra.css`):** cabeçalho de comentário + `.ds-reset` (5.3 + 5.4) + tokens e keyframes
de movimento (5.5.1).

**`app/layout.tsx`:** adicionar, logo após `import "./family.css";`:
```ts
import "./ds/ds-extra.css";
import "./future/future.css";
```

**Teste:** `toReais` (positivo, negativo, meio), `fromReais` (inteiro, e `assert.throws` para `1.5` e
`NaN`), `formatReais` (`4100` → `"R$ 4.100"`, `-150` → `"−R$ 150"`, `hidden` → `"••••"`).
Atenção: `Intl` usa espaço não separável entre `R$` e o número; normalize para espaço comum
(`.replace(/ /g, " ")`) dentro de `formatReais` e teste com espaço comum.

**Pronto quando:** testes passam; app abre igual a antes (nenhuma mudança visual).

---

### T02 · Hooks de movimento e medida

**Arquivos:** `app/ds/use-motion.ts`, `app/ds/use-element-width.ts`.

**API:**

```ts
export function useReducedMotion(): boolean;
/** Interpola cada posição do vetor até o novo alvo. Se o vetor crescer, as posições novas partem do
 *  último valor (pad "last", padrão) ou de zero (pad "zero" — usado pelas barras, ver 5.5.3). */
export function useTween(target: number[], ms?: number, pad?: "last" | "zero"): number[]; // ms padrão 420
export function useTweenNumber(value: number, ms?: number): number; // ms padrão 320
/** true por 1100 ms depois que `value` muda (comparação por JSON.stringify). false no primeiro render. */
export function useChanged(value: unknown): boolean;
export function useElementWidth<T extends HTMLElement>(fallback?: number): [React.RefObject<T | null>, number];
```

**Referência:** `app/preview-copiloto/kit.tsx` — `useReducedMotion` (linha ~137), `useTween` (~152),
`useTweenNumber`, `useChanged` (~189), `useElementWidth` (~1249). **Copie a lógica**, mude só o que
for preciso para tipos e lint.

**Cuidados:** `useTween` precisa de `cancelAnimationFrame` no cleanup; com movimento reduzido retorna
o alvo direto. `useElementWidth` usa `ResizeObserver` e desconecta no cleanup.

**Teste:** não há (hooks de efeito). Verificação na vitrine (T30).

**Pronto quando:** tsc/lint passam.

---

### T03 · `Icon`

**Arquivos:** `app/ds/icon.tsx`.

**API:**

```ts
export type IconName =
  | "plus" | "minus" | "check" | "close" | "left" | "right" | "up" | "down"
  | "undo" | "flag" | "info" | "pause" | "play" | "alert" | "spark" | "layers" | "calendar" | "card";
export function Icon(props: { name: IconName; size?: number; title?: string; className?: string }): JSX.Element;
```

- SVG 24×24, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.75}`, pontas redondas.
- Sem `title`: `aria-hidden`. Com `title`: `role="img"` + `<title>`.
- Caminhos: copie o objeto `PATHS` de `kit.tsx` (~linha 228). Para `calendar` use
  `"M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"`;
  para `card` use `"M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h3"`.
- `name` é `IconName` (união fechada), não `string`.

**Pronto quando:** tsc/lint passam.

---

### T04 · `IconButton` e `Segmented`

**Arquivos:** `app/ds/icon-button.tsx`, `app/ds/segmented.tsx`, CSS em `ds-extra.css`.

**API:**

```ts
export function IconButton(props: {
  icon: IconName;
  label: string;              // vira aria-label (obrigatório)
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "md";         // sm = 36px visual com área de toque 44px; md = 44px
  pressed?: boolean;          // se definido, renderiza aria-pressed
}): JSX.Element;

export function Segmented<T extends string | number>(props: {
  label: string;              // rótulo acessível do grupo
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}): JSX.Element;
```

**Comportamento do `Segmented`:**
- Renderiza `<div role="radiogroup" aria-label={label}>` com um `<button role="radio" aria-checked>`
  por opção.
- Teclado: setas esquerda/direita movem a seleção (e o foco) para a opção anterior/seguinte, com volta
  ao início/fim. `Home`/`End` vão para a primeira/última. Só a opção marcada tem `tabIndex={0}`, as outras `-1`.
- A "pílula" da opção marcada desliza (CSS `transform`, 220 ms); sem deslizar com movimento reduzido.

**Referência:** `kit.tsx` → `Segmented` (~linha 270); CSS `.cf-seg` em `copiloto.css`.

**Pronto quando:** na vitrine, dá para trocar só com teclado; foco visível.

---

### T05 · `AnimatedMoney` e `ChangedText`

**Arquivos:** `app/ds/animated-money.tsx`, CSS.

**API:**

```ts
/** Valor em reais que morfa até o novo número e marca a mudança. Visual = MoneyText. */
export function AnimatedMoney(props: {
  value: number;              // reais
  signed?: boolean;           // mostra +/−
  hidden?: boolean;
  className?: string;
}): JSX.Element;

/** Texto que marca quando muda (ex.: "quitada em nov/27"). */
export function ChangedText(props: { value: string; className?: string }): JSX.Element;
```

- `AnimatedMoney` usa `useTweenNumber` e `formatReais`/`formatSignedReais`, com as classes de
  `MoneyText` (`ds-money`, `is-neg` quando negativo) mais `ds-amoney`. Com `hidden`, mostra `••••` e não anima.
- Os dois põem `data-changed` quando `useChanged` for true.
- CSS: `[data-changed]` ganha `background: var(--family-tint)`; a saída segue o catálogo 5.5.3;
  `border-radius: var(--family-radius-sm)`; sem mudança de tamanho (não pode empurrar o layout).
- O número precisa de `aria-live` **não**: quem decide região viva é o componente pai.

**Referência:** `kit.tsx` → `Money` e `ChangedText` (~205–225).

---

### T06 · `AmountStepper`

**Arquivos:** `app/ds/amount-stepper.tsx`, CSS.

**API:**

```ts
export function AmountStepper(props: {
  label: string;
  value: number;              // reais inteiros
  onChange: (v: number) => void;
  step?: number;              // padrão 50
  min?: number;               // padrão 0
  max?: number;               // padrão 999_999
  hint?: React.ReactNode;
  compact?: boolean;
  disabled?: boolean;
}): JSX.Element;
```

**Comportamento (copie de `kit.tsx` → `MoneyStepper`, ~linha 335):**
- `−` e `+` somam/subtraem `step`, limitados a `[min, max]`; botões desabilitam no limite.
- O campo aceita só dígitos (`inputMode="numeric"`), atualiza a cada tecla válida; ao sair (`blur`) volta
  a mostrar o valor limitado. Setas ↑/↓ no campo somam/subtraem `step`.
- `aria-label` dos botões: `"Diminuir {label} em R$ 50"` / `"Aumentar {label} em R$ 50"` (com `formatReais(step)`).
- `<label htmlFor>` ligado ao `<input>` via `useId`.

**Pronto quando:** digitar "abc" não muda nada; digitar acima do `max` fica no `max`.

---

### T07 · `Sheet`

**Arquivos:** `app/ds/sheet.tsx`, CSS.

**API:**

```ts
/** Painel lateral (≥ 768px) ou folha de baixo (< 768px) sobre <dialog> nativo. */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;   // área fixa embaixo (ex.: botões)
}): JSX.Element;
```

- `<dialog>` com `showModal()`/`close()` num `useEffect` (copie de `kit.tsx` → `Sheet`, ~399).
- Fecha com Esc (nativo), clique no fundo (`e.target === dialog`) e botão `IconButton icon="close"`.
- `aria-labelledby` aponta para o `<h2>` do título.
- Conteúdo só é montado com `open` (como no protótipo).
- Desktop: `position: fixed` à direita, largura `min(440px, 100vw)`, altura total, entra deslizando da
  direita. Mobile: embaixo, largura total, `max-height: 88dvh`, cantos de cima arredondados, desliza de
  baixo. `::backdrop` com `background: color-mix(in srgb, var(--family-text) 32%, transparent)`.
- Rolagem interna no corpo; `footer` fica visível sempre.

**Não confundir** com `app/dialogs/family-dialog.tsx` (formulários centrados). `Sheet` é para detalhe e
assistentes; não substitua o `FamilyDialog`.

---

### T08 · `MonthRail` (trilha de cartões horizontais com seleção)

Primitivo genérico: uma fileira horizontal rolável de itens, um deles selecionado e expandido.
É a base das "estações" da jornada (T26).

**Arquivos:** `app/ds/month-rail.tsx`, `app/ds/month-rail-model.ts`, `tests-js/month-rail-model.test.ts`, CSS.

**API:**

```ts
export type RailItem = {
  key: string;
  label: string;              // ex.: "jan/27" (vem pronto do chamador)
  caption?: string;           // linha secundária curta
  marks?: number;             // quantos marcadores (pontos) mostrar
  tone?: Tone;                // destaque do item
};

export function MonthRail(props: {
  label: string;              // rótulo acessível ("Meses da jornada")
  items: RailItem[];
  selected: number;           // índice
  onSelect: (i: number) => void;
  renderSelected: (i: number) => React.ReactNode;  // conteúdo do item expandido
  prevLabel?: string;         // padrão "Anterior"
  nextLabel?: string;         // padrão "Próximo"
}): JSX.Element;
```

**Modelo puro (`month-rail-model.ts`):**

```ts
/** Próximo índice para a tecla; null se a tecla não for de navegação. */
export function railKey(key: string, selected: number, count: number): number | null;
// "ArrowRight" → +1, "ArrowLeft" → −1, "Home" → 0, "End" → count−1, "PageDown" → +3, "PageUp" → −3,
// sempre limitado a [0, count−1]. Outras teclas → null.
```

**Comportamento:**
- Dois `IconButton` (anterior/próximo) acima da fileira; desabilitam nas pontas.
- Cada item não selecionado é um `<button>` compacto (rótulo, legenda e `marks` pontinhos). O selecionado
  é um `<div>` largo (mín. 280 px, máx. 420 px) que mostra `renderSelected(i)`; o rótulo do selecionado
  continua visível no topo dele.
- O contêiner da fileira tem `tabIndex={0}`, `role="group"`, `aria-label={label}` e `onKeyDown` usando
  `railKey` (chame `preventDefault` quando a tecla for de navegação).
- Ao mudar `selected`, rola o item para o centro (`scrollIntoView({ inline: "center", block: "nearest",
  behavior: reduced ? "auto" : "smooth" })`).
- `overflow-x: auto` com `scroll-snap-type: x proximity`. A página nunca rola para o lado.

**Referência:** `b-journey.tsx` → `Stations` (~linha 170–260) e CSS `.cf-b-strip*`, `.cf-b-station*`.

**Teste:** `railKey` para cada tecla, pontas e tecla qualquer.

---

### T09 · `StackedBars` (barras empilhadas com contorno de comparação)

Primitivo genérico de gráfico. Base da projeção da fatura (T27) e reutilizável para "gastos por mês".

**Arquivos:** `app/ds/stacked-bars.tsx`, `app/ds/stacked-bars-model.ts`, `tests-js/stacked-bars-model.test.ts`, CSS.

**API:**

```ts
export type BarLayer = {
  key: string;
  label: string;              // legenda
  color: string;              // cor de dado (ex.: "var(--family-cat-4)")
  estimate?: boolean;         // desenha com hachura (padrão SVG) = valor estimado
};

export function StackedBars(props: {
  label: string;              // aria-label do grupo
  columns: string[];          // rótulo de cada coluna (ex.: "jan", "fev")
  columnLabels: string[];     // aria-label completo de cada coluna ("janeiro de 2027: R$ 1.850")
  layers: BarLayer[];         // de baixo para cima
  values: number[][];         // values[coluna][camada], reais, >= 0
  ghost?: (number | null)[];  // total de comparação por coluna (contorno tracejado); null = sem contorno
  selected: number;
  onSelect: (i: number) => void;
  footnotes?: (string | null)[]; // texto pequeno sob o rótulo da coluna (ex.: "−R$ 260")
  formatTotal: (v: number) => string; // como escrever o total acima da barra
  height?: number;            // padrão 240
  minColumnWidth?: number;    // padrão 46
  ghostLabel?: string;        // legenda do contorno (só aparece se houver algum ghost)
}): JSX.Element;
```

**Modelo puro (`stacked-bars-model.ts`):**

```ts
export type BarRect = { col: number; layer: number; x: number; y: number; w: number; h: number };
export function barGeometry(args: {
  values: number[][]; ghost?: (number | null)[]; width: number; height: number;
  top: number; bottom: number; minColumnWidth: number;
}): {
  width: number;              // largura final (>= colunas × minColumnWidth)
  col: number;                // largura de cada coluna
  barW: number;               // min(44, col × 0.62)
  max: number;                // maior total entre valores e ghost (mínimo 1)
  rects: BarRect[];           // só camadas com valor > 0.5
  totals: number[];
};
/** Quais camadas têm algum valor > 0 (para a legenda não mostrar camadas vazias). */
export function usedLayers(values: number[][], layerCount: number): boolean[];
```

**Comportamento:**
- SVG `aria-hidden`; a interação é feita por uma fileira de `<button>` sob o gráfico (uma por coluna),
  cada um com `aria-pressed={i === selected}` e `aria-label={columnLabels[i]}`.
- A faixa de seleção desliza até a coluna (`transform: translateX`, 380 ms).
- As alturas morfam com `useTween(values.flat())` (420 ms).
- Total acima da barra: na selecionada sempre; nas outras só se houver ≤ 12 colunas.
- Com mais de 12 colunas, rótulos ímpares ficam vazios (exceto o selecionado).
- Camada `estimate`: preenchimento com `<pattern>` hachurado (linhas a 45°, stroke `var(--family-muted)`
  com opacidade 0.35 por cima da cor). O `id` do pattern usa `useId()` (não fixo: pode haver dois gráficos na tela).
- Legenda (`<ul>`) abaixo: amostra de cor + rótulo, só camadas usadas; mais o contorno, se houver ghost.
- Largura: `useElementWidth`; se `colunas × minColumnWidth` passar da largura, o gráfico rola dentro do contêiner.

**Referência:** `card-projection.tsx` → `CardProjection` (linhas 24–134) e CSS `.cf-card-*`.

**Teste:** `barGeometry` com 3 colunas × 2 camadas conhecidas (confira `max`, `totals`, `rects.length`,
que `y + h` da camada de baixo = `bottom` e que a de cima começa onde a de baixo termina); ghost maior
que valores define `max`; `usedLayers`.

---

### T10 · `LaneTracks` (trilhos com bandeira e cursor)

Primitivo genérico: uma linha por item, cada uma com uma barra que vai do início até um ponto final
(ou além do horizonte), e um cursor vertical que mostra o item/mês selecionado.

**Arquivos:** `app/ds/lane-tracks.tsx`, `app/ds/lane-tracks-model.ts`, `tests-js/lane-tracks-model.test.ts`, CSS.

**API:**

```ts
export type Lane = {
  key: string;
  label: string;              // nome à esquerda
  color: string;              // cor de dado da barra
  end: number | null;         // índice da coluna em que termina; null = além do horizonte
  endLabel: string;           // texto à direita ("R$ 10.000 em mar/28", "não completa no horizonte")
};

export function LaneTracks(props: {
  label: string;
  lanes: Lane[];
  columns: number;            // tamanho do horizonte
  selected: number;
  onSelect: (i: number) => void;
}): JSX.Element;
```

**Modelo puro:**

```ts
/** Fração (0–1) da largura preenchida pela barra. */
export function laneFill(end: number | null, columns: number): number;   // null → 1; senão min(1, (end+1)/columns)
/** Posição (0–1) da bandeira, ou null se não houver bandeira. */
export function flagAt(end: number | null, columns: number): number | null; // (end+0.5)/columns se end < columns
/** Coluna clicada a partir da posição relativa do clique (0–1). */
export function columnAt(fraction: number, columns: number): number;     // floor(fraction×columns), limitado
```

**Comportamento:**
- Grade CSS de 3 colunas: nome | trilho | texto final (variáveis `--lane-label` e `--lane-end`; no mobile
  < 600 px o texto final vai para baixo do trilho e o nome para cima).
- Bandeira (`Icon flag`) na posição `flagAt`; se `null`, uma seta `Icon right` na ponta direita.
  A bandeira fica "cheia" quando `selected >= end` (atributo `data-passed`).
- Barra e cursor morfam (`useTween`).
- Clique na faixa seleciona a coluna (`columnAt`) — permitido porque o `MonthRail`/botões oferecem o
  mesmo por teclado (regra 9). A faixa **não** é focável.
- `endLabel` usa `ChangedText`.

**Referência:** `b-journey.tsx` → `LaneMap` (~linha 140–170) e CSS `.cf-b-map`, `.cf-b-lane*`, `.cf-b-traveler`.

**Teste:** os três helpers, incluindo `end = 0`, `end >= columns`, `null`, e fração 0, 0.999 e 1.

---

### T11 · `CalcList` (a conta, linha a linha)

Mostra uma conta simples: linhas com rótulo e valor, separador e um total. É o "por que esse número"
que aparece em vários lugares (mês, fatura, folga).

**Arquivos:** `app/ds/calc-list.tsx`, CSS.

**API:**

```ts
export type CalcLine = {
  key: string;
  label: string;
  note?: string;              // texto pequeno sob o rótulo ("parcela 4/10 · última em jun/27")
  value: number;              // reais; o sinal define a cor (negativo = is-neg)
  op?: "+" | "−" | "=";       // símbolo à esquerda (opcional)
  estimate?: boolean;         // marca "estimativa" (itálico + texto "estimado" para leitor de tela)
  highlight?: boolean;        // ex.: item simulado
};

export function CalcList(props: {
  lines: CalcLine[];
  total?: { label: string; value: number };
  hidden?: boolean;
  compareTotal?: number;      // se presente e diferente, mostra "antes: R$ X" riscado ao lado do total
}): JSX.Element;
```

- Semântica: `<dl>` com pares `<dt>`/`<dd>`; valores com `AnimatedMoney`.
- Linha `highlight`: fundo `var(--family-tint)`.

**Referência:** `kit.tsx` → `MonthLedger` (~444) e `card-projection.tsx` → lista `.cf-card-parts`.

---

### T12 · `DiffList` (antes → depois)

**Arquivos:** `app/ds/diff-list.tsx`, CSS.

**API:**

```ts
export type DiffRow = {
  key: string;
  label: string;
  before: string;             // já formatado
  after: string;
  sense: number;              // > 0 melhorou, < 0 piorou, 0 neutro
  delta?: string;             // "2 meses antes", "+R$ 150"
};
export function DiffList(props: { rows: DiffRow[]; empty?: string }): JSX.Element;
```

- Cada linha: rótulo; `before` riscado em `--family-muted`; seta; `after` em destaque; `delta` num
  `StatusChip` com tom `ok` (melhorou), `danger` (piorou) ou `neutral`.
- O sentido também vai em texto para leitor de tela (`<span className="sr-only">melhorou</span>` etc.).
  Use a classe `.sr-only`, que já existe em `family.css`.
- Sem linhas: mostra `empty` (padrão "Nada muda.").

**Referência:** `kit.tsx` → `ScenarioDock` (lista de comparação, ~504–615).

---

### T13 · `DraftBar` (barra de rascunho)

Barra que aparece quando há uma simulação não salva. Genérica: não sabe o que é um plano.

**Arquivos:** `app/ds/draft-bar.tsx`, CSS.

**API:**

```ts
export function DraftBar(props: {
  open: boolean;              // false = não renderiza nada
  summary: React.ReactNode;   // "2 mudanças · reserva completa 2 meses antes"
  onCompare?: () => void;     // botão "Comparar tudo"
  compareLabel?: string;      // padrão "Comparar tudo"
  onDiscard: () => void;      // "Descartar"
  onSave?: () => void;        // ausente = sem botão salvar (ex.: modo leitura)
  saveLabel?: string;         // padrão "Salvar como plano"
  saving?: boolean;
  confirmSave?: string;       // se presente, salvar pede confirmação inline com este texto
}): JSX.Element | null;
```

- `position: sticky; bottom: 0` dentro do conteúdo (não `fixed`), com `padding-bottom:
  env(safe-area-inset-bottom)`. No mobile ocupa a largura toda.
- Confirmação inline: o primeiro clique em salvar troca a barra por `confirmSave` + "Confirmar" / "Voltar".
  "Confirmar" chama `onSave`. Nada de `window.confirm`.
- Botões: use `Button` de `app/button.tsx` (`variant="primary"` no salvar, `"quiet"` no descartar),
  com `state="loading"` quando `saving`. **Exceção à regra de import:** `app/ds/` pode importar
  `../button.tsx` (é o botão do design system).
- `role="region"` com `aria-label="Simulação não salva"`; o `summary` fica num `aria-live="polite"`.

**Referência:** `kit.tsx` → `ScenarioDock` modo `bar`.

---

## 7. Camada 2 — domínio futuro (`app/future/`)

Base: tipos e funções de `src/domain/future-months.ts` (`FutureInput`, `Scenario`, `FutureResult`,
`FutureRow`, `Milestone`, `Decision`, `DiffItem`, `CardFuture`, `projectFuture`, `applyScenario`,
`compareFuture`, `describeScenario`, `monthShort`, `monthLong`, `neededMonthly`). **Leia esse arquivo
inteiro antes da T20.** Se uma função de que você precisa não existir lá, **não a crie no domínio**:
pergunte.

### T19 · `FutureScope` (Instrument Sans só na nova tela)

A nova tela usa Instrument Sans no texto; o resto do app continua em DM Sans. Isso é feito redefinindo
o token `--family-font-sans` **dentro** de um invólucro. Assim nenhuma peça precisa saber qual fonte usar.

**Arquivos:** `app/future/future-scope.tsx`, CSS em `app/future/future.css`.

```tsx
// SEM "use client": é um componente sem estado (exceção à convenção da seção 2).
import { Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";

const instrument = Instrument_Sans({ subsets: ["latin"], display: "swap", variable: "--family-font-future" });

/** Invólucro da nova tela: troca a fonte de texto para Instrument Sans só aqui dentro.
 *  Números continuam em Space Grotesk. Use uma vez por página, nunca aninhado. */
export function FutureScope({ children }: { children: ReactNode }) {
  return <div className={`${instrument.variable} fut-scope`}>{children}</div>;
}
```

```css
.fut-scope {
  --family-font-sans: var(--family-font-future), system-ui, sans-serif;
  font-family: var(--family-font-sans);
}
.fut-scope :where(h1, h2) { letter-spacing: -0.02em; }
```

- Não mude `app/layout.tsx` para isso; a fonte é carregada só onde `FutureScope` é usado.
- Não troque `--family-font-numeric`.
- Peças da camada 1 e 2 usadas **fora** do `FutureScope` (em telas antigas) ficam em DM Sans — é o
  comportamento esperado.

**Pronto quando:** na vitrine, o DevTools mostra Instrument Sans como fonte calculada do título do
`Headline` (dentro do escopo) e DM Sans num `Segmented` fora do escopo; valores em Space Grotesk nos dois.

---

### T20 · Fixtures e cores

**Arquivos:** `app/future/fixtures.ts`, `app/future/colors.ts`, `tests-js/future-fixtures.test.ts`.

**`fixtures.ts`:** exporta `briefingInput(): FutureInput` com o cenário do briefing (o mesmo dos testes
do backend: confira `tests-js/future-months.test.ts` e **reaproveite** o input de lá se existir um
construtor exportável; se não, monte igual): mês 0 = `2026-12`, saldo livre R$ 4.100, entrada R$ 6.000,
contas fixas R$ 700, reserva R$ 2.300 → R$ 10.000 com R$ 500/mês, viagem R$ 900 → R$ 4.000 até
`2027-12` sem aporte, cartão com recorrentes R$ 120 + R$ 110, dia a dia ≈ R$ 650/mês, parcelas Geladeira
(R$ 260, 10×, 3 pagas) e Óculos (R$ 160, 6×, 3 pagas). Exporte também `emptyInput(): FutureInput`
(sem objetivos, sem cartão, sem entrada) para testar estados vazios.

**`colors.ts`:**

```ts
/** Cor de dado de um objetivo pela posição; mesma paleta de app/copilot/money.ts (copie a lista, não importe). */
export function goalColor(index: number): string;      // var(--family-cat-4|6|2|8), cíclico
/** Cor de dado da camada de fatura. */
export function cardLayerColor(kind: "recorrente" | "estimado" | "parcela" | "fatura" | "pontual", index?: number): string;
// recorrente → var(--family-cat-cards); estimado → var(--family-cat-none); parcela → var(--family-cat-1|3|5|7) por index;
// fatura → var(--family-cat-9); pontual → var(--family-cat-11)
```

**Teste:** `projectFuture(briefingInput())` roda sem erro e a reserva completa em `2028-03`
(`result.reach[idReserva] === "2028-03"`). Se der outro mês, **pare e avise** (o motor ou a fixture
divergem do briefing).

---

### T21 · Decodificação do fio

O servidor manda `bigint` como `string` (padrão `Wire<T>` de `src/server/copilot.ts`). O cliente precisa
de `bigint` de volta para rodar `projectFuture` no navegador.

**Arquivos:** `app/future/decode.ts`, `tests-js/future-decode.test.ts`.

**API:**

```ts
/** Converte de volta todo campo cujo tipo no domínio é bigint. Lança erro se um campo bigint não for string de dígitos. */
export function decodeFutureInput(wire: unknown): FutureInput;
export function decodeFutureResult(wire: unknown): FutureResult;
/** Inverso de decodeFutureInput (para testes e para a vitrine). */
export function encodeFutureInput(input: FutureInput): unknown;
```

- **Escreva a lista de campos à mão**, campo a campo, seguindo os tipos de `future-months.ts`. Não use
  "converte toda string que parece número" (rótulos podem ser numéricos).
- Campos `bigint | null` aceitam `null`.

**Teste:** `decodeFutureInput(encodeFutureInput(briefingInput()))` é `deepEqual` ao original; string
inválida (`"12a"`) lança; `null` em campo anulável passa.

---

### T22 · Estado: `useFuture` e `FutureProvider`

Este é o único lugar que busca dados. Guarda o **plano salvo** (vindo do servidor) e o **rascunho**
(simulação local), e recalcula no navegador.

**Arquivos:** `app/future/future-state.ts` (lógica pura), `app/future/future-context.tsx`,
`app/future/use-future.ts`, `tests-js/future-state.test.ts`.

**Lógica pura (`future-state.ts`):**

```ts
export type FutureState = {
  input: FutureInput | null;  // salvo (do servidor)
  scenario: Scenario;         // rascunho; {} = sem mudanças
  months: 3 | 6 | 12 | 24 | 36;
  selected: number;           // índice do mês selecionado
};
export type FutureAction =
  | { type: "loaded"; input: FutureInput }
  | { type: "setMonths"; months: FutureState["months"] }
  | { type: "select"; index: number }
  | { type: "patch"; patch: Partial<Scenario> }          // mescla listas por id/chave (ver abaixo)
  | { type: "replace"; scenario: Scenario }
  | { type: "remove"; list: "contributions" | "pauses" | "newGoals" | "purchases" | "shocks"; key: string } // tira o item com essa chave
  | { type: "discard" };
export function futureReducer(s: FutureState, a: FutureAction): FutureState;
export function isDirty(s: Scenario): boolean;          // algum campo não vazio
export function changeCount(s: Scenario): number;       // soma dos itens de todas as listas + 1 por campo escalar definido
```

Regras do `patch`:
- Listas (`contributions`, `pauses`, `newGoals`, `purchases`, `shocks`): **substitui** os itens com a
  mesma chave e acrescenta os novos. Chave: `goalId` (contributions, pauses), `id` (newGoals),
  `label` (purchases, shocks). Um item com `cents === 0n` em `contributions` **remove** a entrada.
- Escalares (`everydayWeekly`, `freedTo`): substitui; `undefined` remove.
- `select` limita a `[0, months−1]`; `setMonths` também ajusta `selected`.
- `loaded` mantém o `scenario` atual (recarregar não apaga a simulação), mas limpa itens que apontem
  para objetivos que sumiram.

**Contexto (`future-context.tsx`):**

```ts
export function FutureProvider(props: {
  value: ReturnType<typeof useFuture>;
  hidden: boolean;
  reader: boolean;
  children: React.ReactNode;
}): JSX.Element;
export function useFutureContext(): FutureView;   // lança erro claro se usado fora do provider

export type FutureView = {
  status: "loading" | "ready" | "error";
  error: string;
  hidden: boolean;
  reader: boolean;
  months: number;
  selected: number;
  base: FutureResult | null;       // projectFuture(input)
  draft: FutureResult | null;      // projectFuture(applyScenario(input, scenario)); === base se não sujo
  draftInput: FutureInput | null;
  scenario: Scenario;
  dirty: boolean;
  changes: number;
  describe: string[];              // describeScenario(input, scenario)
  diff: DiffItem[];                // compareFuture(base, draft, months, nomes) — nomes = { [goal.id]: goal.name } de input.goals + scenario.newGoals
  select(i: number): void;
  setMonths(m: FutureState["months"]): void;
  patch(p: Partial<Scenario>): void;
  replace(s: Scenario): void;
  remove(list: "contributions" | "pauses" | "newGoals" | "purchases" | "shocks", key: string): void;
  discard(): void;
  canSave: boolean;                // ver "save()" abaixo
  save(): Promise<void>;           // grava o rascunho como plano (ver abaixo)
  saving: boolean;
};
```

- `base` e `draft` com `useMemo` (dependências: `input`, `scenario`, `months`). Nunca recalcule no render
  sem memo.

**Hook (`use-future.ts`):**

```ts
export function useFuture(opts: { months?: FutureState["months"] }): /* valor para o FutureProvider */;
```

- Busca `GET family/future?months=36` **uma vez** com `api()` de `app/lib/api.ts` (sempre 36: trocar o
  horizonte na tela não refaz a busca, só recorta). Decodifica com `decodeFutureInput`. Cancela com
  `AbortController` no cleanup.
- `save()`: para cada item de `scenario.contributions`, `POST reserves/plan-range` com
  `{ goal_id, from_month, months, planned }` (formato no backend spec, seção de rotas; `planned` em texto
  no formato da API — use `apiAmount` copiado de `app/copilot/money.ts` para `app/lib/cents.ts` como
  `toApiAmount(cents: bigint): string`, com teste). Depois recarrega e chama `discard`.
- **Nesta spec, `save()` só grava `contributions`.** Outras mudanças do rascunho (compra simulada,
  choque, dia a dia) não são "plano": se o rascunho tiver só elas, o `DraftBar` não mostra "Salvar"
  (exponha `canSave: boolean` no `FutureView` = existe ao menos uma contribution e `!reader`).
- Se a rota `family/future` ainda não existir (404), `status = "error"` com a mensagem
  "O futuro ainda não está disponível." — não quebre.

**Teste (`future-state.test.ts`):** cada ação do reducer; `patch` substitui por chave; `cents 0n`
remove; `isDirty({})` é false; `changeCount`; `select` limitado.

---

### T23 · Modelos de visualização (lógica pura)

Toda conta que os componentes de domínio precisam fica aqui, **testada**. Os componentes (T24–T29) só
chamam estas funções e desenham.

**Arquivos:** `app/future/view-model.ts`, `tests-js/future-view-model.test.ts`.

**API:**

```ts
import type { DiffItem, FutureInput, FutureResult, Milestone } from "../../src/domain/future-months.ts";
import type { BarLayer, CalcLine, DiffRow, Lane, RailItem } from "../ds/types.ts";
// Os tipos da camada 1 ficam em app/ds/types.ts (arquivo .ts, sem JSX), para os testes conseguirem
// importá-los. Regra para T08–T12: declare RailItem, BarLayer, Lane, CalcLine e DiffRow em
// app/ds/types.ts e reexporte no .tsx (`export type { RailItem } from "./types.ts";`).
// Em CalcLine, troque `label: React.ReactNode` por `label: string` (o modelo puro não gera JSX).

/** Trilhos dos objetivos ativos, na ordem de prioridade. */
export function goalLanes(input: FutureInput, result: FutureResult, months: number): Lane[];
// end = índice do mês de `result.reach[id]` relativo a input.startMonth (null se fora ou ausente);
// endLabel: "R$ 10.000 em mar/28" | "não completa no horizonte" | "sem meta" (target 0n);
// color = goalColor(posição). Rótulo = goal.name.

/** Itens da trilha de meses, com quantos marcos cada mês tem. */
export function railItems(input: FutureInput, result: FutureResult, months: number): RailItem[];
// label = monthShort(m); caption = formatCents(row.free) + " de folga"; marks = marcos do mês;
// tone = "danger" se row.free < 0n, "ok" se houver marco "goal-reached" no mês, senão undefined.
// Respeite `hidden` recebendo-o como parâmetro extra: railItems(input, result, months, hidden).

/** Marcos agrupados por índice de mês. */
export function milestonesByMonth(input: FutureInput, result: FutureResult, months: number): Map<number, Milestone[]>;

/** A conta do mês: entrada, essenciais/fixas, fatura, objetivos, folga. */
export function monthCalc(input: FutureInput, result: FutureResult, index: number): { lines: CalcLine[]; total: { label: string; value: number } };
// Linhas (nesta ordem): "Entrada" (+), "Contas fixas" (−), "Dia a dia fora do cartão" (−, estimate) se > 0,
// "Fatura do cartão" (−), "Imprevistos" (−) se row.shocks > 0, um "Para {objetivo}" (−) por goalIn > 0.
// Total: "Folga do mês" = row.free. A soma das linhas TEM que bater com row.free —
// se não bater, a função lança erro com a diferença (isso pega erro de interpretação do motor).

/** Camadas e valores do gráfico da fatura, somando todos os cartões. */
export function cardBars(input: FutureInput, result: FutureResult, months: number): {
  columns: string[]; columnLabels: string[]; layers: BarLayer[]; values: number[][]; footnotes: (string | null)[];
};
// Camadas: "Recorrentes", "Dia a dia (média)" (estimate), uma por parcela (label da compra), "Fatura já fechada" (kind fatura).
// values em reais (toReais). footnotes: "−R$ X" no mês seguinte ao fim de parcelas (soma das que terminaram).
// columnLabels: "{monthLong}: fatura de {valor}".

/** Itens da fatura de um mês, prontos para CalcList. */
export function cardMonthLines(result: FutureResult, index: number): CalcLine[];
// note da parcela: "parcela k/n · última em {monthShort(lastMonth)}"; estimado: "estimativa pela média das últimas faturas".

/** Frase de destaque do topo (a "manchete"). */
export function headline(input: FutureInput, result: FutureResult, months: number): { lead: string; detail: string };
// Ver regras abaixo.

/** Diferenças do rascunho, prontas para DiffList. */
export function diffRows(diff: DiffItem[]): DiffRow[]; // mapeamento 1:1
```

**Regras da `headline`** (em ordem; use a primeira que valer):
1. Algum mês com `free < 0n` no horizonte → lead `"Em {monthShort} falta {valor}."`, detail
   `"A diferença sai do saldo em conta. Veja o que dá para ajustar."`
2. Algum objetivo alcança a meta no horizonte → lead `"{nome} completa em {monthLong}."`, detail
   `"Mantendo {valor}/mês, como no plano."` (valor = plano vigente do mês 0; se 0, detail
   `"Sem aporte mensal, só com o que já está guardado."`).
3. Senão → lead `"Nenhum objetivo completa nos próximos {months} meses."`, detail = `result.viability.detail`.

**Teste:** com `briefingInput()`: `goalLanes` da reserva termina no índice de `2028-03` (15 com mês 0 =
dez/26); `monthCalc(…, 1)` (jan/27) tem folga −150 e a soma bate; `cardBars` tem 1.300 em dez, 1.850 em
jan e 880 em jul/27 (totais por coluna); footnote no mês seguinte ao fim da Óculos; `headline` cai na
regra 1 (jan/27). Com `emptyInput()`: nenhuma função lança; listas vazias. Se os números do briefing não
baterem, **pare e avise** (não ajuste o teste para passar).

---

### T24 · `HorizonSwitch` e `Headline`

**Arquivos:** `app/future/horizon-switch.tsx`, `app/future/headline.tsx`, CSS em `future.css`.

- `HorizonSwitch`: `Segmented` com `3 meses`, `6 meses`, `1 ano`, `2 anos`, `3 anos` ligado a
  `months`/`setMonths` do contexto. `label="Quanto do futuro mostrar"`.
- `Headline`: `<header>` com eyebrow `"O futuro de vocês"`, `<h1>` com `lead` (grande, peso 600,
  `clamp(1.75rem, 4vw, 2.75rem)`), `<p>` com `detail`, e o `HorizonSwitch` à direita (embaixo no mobile).
  `lead` usa `ChangedText`. Com `hidden`, os valores dentro das frases viram `••••` (a `headline` recebe
  `hidden` — adicione o parâmetro na T23 se ainda não tiver).

**Referência:** cabeçalho e frase de destaque de `a-editorial.tsx` (o usuário aprovou esse cabeçalho).

---

### T25 · `GoalLanes`

**Arquivos:** `app/future/goal-lanes.tsx`.

- `LaneTracks` com `goalLanes(input, draft ?? base, months)`, `selected`/`select` do contexto.
- Título `<h2>` "Cada objetivo no tempo" (prop `title?: string` para outras telas trocarem).
- Sem objetivos: mensagem "Nenhum objetivo ativo ainda." e nada de trilho.

---

### T26 · `MonthStations` e `StationCard`

**Arquivos:** `app/future/month-stations.tsx`, `app/future/station-card.tsx`.

- `MonthStations`: `MonthRail` com `railItems(...)`; `renderSelected={(i) => <StationCard index={i} />}`.
- `StationCard({ index })`: mês por extenso (`monthLong`) + "daqui a N meses"; os marcos do mês
  (`milestonesByMonth`), cada um com `title` e, num `<details>`, a lista `why` ("por que nessa data");
  depois `CalcList` com `monthCalc(...)`, com `compareTotal` = folga do plano salvo quando `dirty`.
- Mês com folga negativa: `Callout tone="danger"` com "Faltam {valor} neste mês. Sai do saldo em conta."

**Referência:** `b-journey.tsx` → `Stations`/`StationDetail` (o usuário aprovou o card de descrição do mês).

---

### T27 · `CardBillChart` e `CardMonthPanel`

**Arquivos:** `app/future/card-bill-chart.tsx`, `app/future/card-month-panel.tsx`.

- `CardBillChart`: título "Fatura do cartão", frase "{valor} em {mês 0}, caindo para {mínimo} em {mês}
  conforme as parcelas terminam. Barras hachuradas são estimativa." (a parte "caindo…" só se o mínimo
  for menor que o primeiro). `StackedBars` com `cardBars(...)` do **rascunho**; `ghost` = totais do
  plano salvo **só quando `dirty`** e só nas colunas em que diferem; `ghostLabel="Fatura no plano atual"`.
  Layout: gráfico à esquerda e `CardMonthPanel` à direita (≥ 960 px); empilhados abaixo disso.
- `CardMonthPanel({ index })`: "Fatura de {mês}", valor grande (`AnimatedMoney`), variação sobre o mês
  anterior ("−R$ 570 sobre jan/27"), `CalcList` com `cardMonthLines`, e a frase: "Depois de essenciais e
  contas fixas sobram {preCard}. A fatura leva {card}, ficam {budget} para objetivos e folga." O painel
  tem `aria-live="polite"`.
- Sem cartão (`input.cards.length === 0`): não renderiza nada (retorna `null`).

**Referência:** `card-projection.tsx` → `CardProjection` (linhas 24–180).

---

### T28 · `PurchaseSimulator` e `EverydayControl`

**Arquivos:** `app/future/purchase-simulator.tsx`, `app/future/everyday-control.tsx`.

- `PurchaseSimulator`: "E se vocês parcelarem uma compra?" — `AmountStepper` (valor total, passo 100),
  `<select>` de parcelas (1, 2, 3, 4, 5, 6, 8, 10, 12; texto "6× de R$ 300"), `<select>` de cartão (só
  se houver mais de um) e de dia da compra (hoje por padrão; opções: hoje e o dia 1 dos próximos 11
  meses — rótulo `monthShort`). Botão "Simular na fatura" faz `patch({ purchases: [{ card, cents,
  installments, day, label: "Compra simulada" }] })`. Com a compra aplicada: mudar qualquer campo
  reaplica na hora; aparece "Folga mínima no horizonte: {valor}" (+ aviso se negativa) e "Tirar a compra"
  (chama `remove("purchases", "Compra simulada")`).
- `EverydayControl`: `AmountStepper` "Gasto do dia a dia (média por mês)", passo 50; converte mensal ↔
  semanal com `semanal = mensal × 7 / 30` (arredonde para centavos inteiros com `BigInt(Math.round(...))`
  feito **em centavos**). Hint: "No plano: {valor}. Cada R$ 50 a menos vira R$ 50 de folga por mês."
  Com `everyday.source === "ausente"`, mostra só o texto "Ainda não há média do dia a dia." sem controle.
- Os dois funcionam com `reader: true` (simular não grava).

**Referência:** `card-projection.tsx` → `CardSimulator` (linhas 182–280).

---

### T29 · `ContributionControl`, `DecisionList`, `Premises` e `FutureDraftBar`

**Arquivos:** `app/future/contribution-control.tsx`, `app/future/decision-list.tsx`,
`app/future/premises.tsx`, `app/future/future-draft-bar.tsx`.

- `ContributionControl({ goalId })`: `AmountStepper` "Quanto guardar por mês em {nome}", passo 50,
  valor = contribution do rascunho ou plano vigente do mês 0; muda via `patch({ contributions: [{ goalId,
  fromMonth: startMonth, months: null, cents }] })`. Hint: "No plano: {valor}. Completa em {mês}." (mês
  do rascunho, `ChangedText`). Se o objetivo tem prazo: "Para chegar até {prazo} precisa de {neededMonthly}/mês."
- `DecisionList`: lista de `result.decisions` do rascunho. Cada uma: `IconBadge`/tom (`atencao` →
  `warn`, `oportunidade` → `ok`, `info` → `neutral`), `title`, `calc` (texto pequeno, "a conta") e
  `impact`. Se tiver `action`, botão "Testar" que faz `patch(action.scenario)` (o reducer da T22 já
  mescla por chave) — **não** salve. Vazio: "Nenhuma decisão pendente neste horizonte."
- `Premises`: `<details>` "Premissas desta projeção" com `result.premises` em lista. Sempre presente
  (honestidade sobre estimativas).
- `FutureDraftBar`: `DraftBar` com `open={dirty}`, `summary` = `"{changes} mudança(s)"` + primeira linha de
  `describe`; `onCompare` abre um `Sheet` "O que muda" com `DiffList(diffRows(diff))` e a lista `describe`;
  `onSave` só se `canSave`; `confirmSave="Gravar o novo aporte a partir de {mês 0}? Os planos anteriores
  ficam no histórico."`.

**Referência:** `kit.tsx` → `DecisionList` (~645), `Premises` (~487), `ScenarioDock` (~504).

---

## 8. Vitrine (`app/preview-ds/futuro/`)

### T30 · Página de vitrine

**Arquivos:** `app/preview-ds/futuro/page.tsx`, `app/preview-ds/layout.tsx` (com `robots: noindex`, copie
de `app/preview-copiloto/layout.tsx` **sem** as fontes).

- Página `"use client"` que mostra, em seções com `<h2>` do nome do componente, **cada** peça da camada 1
  com dados de exemplo e **cada** peça da camada 2 dentro de um `FutureProvider` alimentado pela fixture
  (crie um `useFixtureFuture(input)` local na própria página que imita `useFuture` sem rede; `save()` só
  faz `console.info`).
- As seções da camada 2 ficam dentro de um `FutureScope`; as da camada 1 ficam fora, com um controle
  "fonte da nova tela" que as envolve num `FutureScope` para comparar as duas fontes.
- Controles no topo: tema claro/escuro (alterna `document.documentElement.dataset.theme`), "ocultar
  valores", "modo leitura" e fixture (`briefing` / `vazio`).
- Faça a T30 **logo depois da T13** com as peças da camada 1, e vá acrescentando cada peça da camada 2 na
  própria tarefa dela.

### Checklist visual (para cada peça, na vitrine)

- [ ] 375 px e 1280 px: nada cortado, nenhuma rolagem horizontal da página.
- [ ] Tema escuro: contraste legível, nenhuma cor "presa" do claro.
- [ ] Teclado: Tab chega em todos os controles na ordem visual; foco visível; Esc fecha o `Sheet`.
- [ ] "Ocultar valores": nenhum número de dinheiro aparece.
- [ ] Movimento: a peça faz exatamente o que o catálogo 5.5.3 diz, e nada além (roteiro em 5.5.4).
- [ ] Movimento reduzido (DevTools → Rendering → `prefers-reduced-motion: reduce`): nada desliza.
- [ ] Fonte: dentro do `FutureScope`, Instrument Sans; fora, DM Sans; números sempre Space Grotesk.
- [ ] Fixture vazia: nenhuma peça quebra; mensagens de vazio aparecem.
- [ ] Os números da fixture `briefing` batem com `/preview-copiloto?v=ab` (fatura dez R$ 1.300, jan
      R$ 1.850; folga jan −R$ 150; reserva completa mar/28).

---

## 9. Ordem e dependências

| Ordem | Tarefa | Depende de |
| ----- | ------ | ---------- |
| 1 | T01 base | — |
| 2 | T02 hooks | T01 |
| 3 | T03 Icon | T01 |
| 4 | T04 IconButton, Segmented | T03 |
| 5 | T05 AnimatedMoney | T02 |
| 6 | T06 AmountStepper | T03, T04 |
| 7 | T07 Sheet | T04 |
| 8 | T08 MonthRail (+ `app/ds/types.ts`) | T04 |
| 9 | T09 StackedBars | T02, T05 |
| 10 | T10 LaneTracks | T02, T03, T05 |
| 11 | T11 CalcList | T05 |
| 12 | T12 DiffList | T01 |
| 13 | T13 DraftBar | T01 |
| 14 | T30 vitrine (camada 1) | T01–T13 |
| 15 | T19 FutureScope (fonte) | T01 |
| 16 | T20 fixtures e cores | backend: `future-months.ts` existente |
| 17 | T21 decode | T20 |
| 18 | T22 estado | T21 |
| 19 | T23 modelos | T20, T22 |
| 20–25 | T24 → T29 (um commit cada) | T19, T23 |

T01–T14 **não dependem do backend** e podem começar já. T22 (`useFuture`) só funciona de verdade quando a
rota `GET family/future` existir; até lá, a vitrine usa a fixture e o hook mostra o erro amigável.

---

## 10. Critérios de aceite (fim da spec)

1. Todas as tarefas commitadas na branch, uma por commit, com tsc, lint e testes passando.
2. Nenhum arquivo fora das listas foi alterado (confira com `git diff --stat main...HEAD`).
3. `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(" app/ds/ds-extra.css app/future app/ds/*.tsx` não encontra
   cor crua (exceto dentro de comentários).
4. `grep -rn "from \"../../src/server" app/future` só encontra `import type` em `use-future.ts`.
5. `grep -rln "preview-copiloto" app/ds app/future app/preview-ds` não encontra nada.
6. Vitrine passa no checklist da seção 8 para todas as peças.
7. Os números da fixture batem com o protótipo (T20/T23 testam isso).

---

## 11. Fora de escopo (não faça)

- Montar `/copiloto` com estas peças ou mexer na tela atual (`app/copilot/*`).
- Dívidas (não existem no modelo; v1 usa parcelas do cartão como compromissos que terminam).
- Assistente de novo objetivo (`GoalWizard` do protótipo) — vai numa spec própria.
- Faixa de alocação arrastável e gráfico de comparação (variante C) e "rio da verba" (variante D).
- Remover `app/preview-copiloto/` (só depois do porte da tela).
- Qualquer mudança em `src/**`.

---

## 12. Perguntas em aberto (o agente não decide; seguir o padrão indicado)

1. **Fonte (decidido).** Instrument Sans só na nova tela, via `FutureScope` (T19). Levar para o app
   inteiro é uma decisão futura; quando vier, basta trocar a fonte em `app/layout.tsx` e remover o escopo.
2. **"Salvar como plano" com outras mudanças.** Hoje só aportes viram plano. Compra simulada e dia a dia
   ficam como simulação. Padrão: como descrito na T22.
3. **Horizonte de 3 anos.** Incluído no `HorizonSwitch` porque o backend aceita até 36 meses. Se o backend
   mudar o máximo, ajustar as opções.
