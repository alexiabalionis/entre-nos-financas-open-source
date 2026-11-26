-- Margem de segurança do Copiloto: o saldo mínimo que a pessoa quer manter
-- na conta até o próximo salário. NULL = ainda não escolheu (o Copiloto usa
-- meia semana típica). Separada de cushion_cents para não mudar a aba Mês.
ALTER TABLE household_finance_settings ADD COLUMN IF NOT EXISTS copilot_margin_cents bigint CHECK(copilot_margin_cents IS NULL OR copilot_margin_cents>=0);
