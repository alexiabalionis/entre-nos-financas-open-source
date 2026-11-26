# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(PWA mobile-first, instalável no iOS via Capacitor; desktop também é usado para planejar.)

## Users

Casais e famílias que dividem as contas da casa, em pt-BR. O recorte explícito é ajudar quem tem dificuldade de organização e constância financeira: a dona do produto tem TDAH. O usuário típico administra o dinheiro de forma improvisada, pode ter dívidas e parcelamentos, ainda não tem (ou está começando) uma reserva de emergência e tem dificuldade em transformar metas abstratas em ações mensais.

## Product Purpose

Entre Nós reúne as contas, os planos e o futuro do casal em um só lugar: planejar o mês, acompanhar o que foi pago, registrar imprevistos e decidir o que construir daqui para frente. Sucesso é a pessoa saber qual é a próxima decisão e conseguir sustentar o plano mesmo em meses ruins.

## Positioning

Instalação independente e de código aberto (MIT): cada operador controla sua infraestrutura, sem conta de demonstração pública. Os números vêm de cálculos determinísticos sobre os dados da família; nada de cotação inventada, rentabilidade presumida ou valor "a definir" tratado como zero.

## Operating Context

Abas principais: **Mês** (plano mensal: entradas previstas, custos fixos/variáveis, cartões, reservas, vencimentos), **Movimentos** (confirmados, busca, histórico por dia), **Copiloto** (gestão do futuro: metas, reservas, dívidas, projeção) e **Judite** (assistente que consulta o histórico local; alterações geram prévia para confirmação). Perfil "Nosso espaço" com foto, cor de destaque por pessoa e tema claro/escuro.

O **Copiloto** responde: "considerando minha situação atual, o que posso construir daqui para frente e quais decisões preciso tomar para chegar lá?". Não é tela inicial nem substitui Movimentos ou o Mês. IA conversacional pode existir no futuro, mas não é o centro da experiência.

## Capabilities and Constraints

- Dinheiro em centavos (`BigInt`), BRL, formato `R$ 1.234,56`, numerais tabulares.
- Estados de conta: aberto / pago / parcial; valor "a definir" nunca vira zero.
- Distinções que não se misturam: saldo em conta projetado, dinheiro livre após compromissos, valor acumulado em reservas, patrimônio líquido (com escopo declarado).
- Reserva não é dinheiro disponível para gasto corrente. Dívida quitada deixa de consumir pagamento. Simulação nunca é apresentada como decisão aplicada; salvar exige confirmação.
- Stack: Next 16 + React 19 + TypeScript, CSS puro com tokens `--family-*` (`app/family.css`), PGlite local. Gráficos em SVG/CSS autorais; recharts existe como dependência mas o Copiloto não deve depender de um gráfico default.

## Brand Commitments

- Nome **Entre Nós**; logo de duas formas ascendentes unidas por um coração.
- Voz afetiva de casal ("vocês dois", "nosso mês"), sem julgamento sobre dívidas ou metas atrasadas, sem otimismo artificial, sem gamificação infantil.
- Tokens do design system em `app/family.css` (paleta roxo + lime, acento trocado por pessoa em runtime), DM Sans no texto e Space Grotesk nos números. Claro e escuro obrigatórios.
- Não usar fundos off-white, bege, creme ou amarelados.

## Evidence on Hand

Nenhum dado real de usuário no repositório. Protótipos usam cenários fictícios explicitamente marcados. Explorações anteriores em `prototypes/` (ver `prototypes/EXPLORACAO.md`).

## Product Principles

1. Mostrar primeiro a informação da próxima decisão; revelar o resto sob demanda.
2. Toda mensagem acionável nasce de uma regra ou cálculo verificável, com a conta à vista.
3. O futuro é manipulável: mudar uma decisão mostra o impacto antes de virar plano.
4. Planos sobrevivem a meses ruins: pausar e reduzir são caminhos normais, não falhas.
5. Progresso tangível com marcos próximos, sem percentuais arbitrários.

## Accessibility & Inclusion

Baixa carga cognitiva (TDAH) sem virar app clínico ou infantil. Navegação por teclado, foco visível, `prefers-reduced-motion`, feedback que não depende só de cor, nada que dependa de hover no mobile.
