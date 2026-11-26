-- Teto por categoria vale "a partir de" um mês. planned_cents NULL numa linha
-- significa "sem teto a partir deste mês". Só relaxa a coluna; nenhum dado muda.
ALTER TABLE budgets ALTER COLUMN planned_cents DROP NOT NULL;
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_planned_cents_check;
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_planned_nonneg;
ALTER TABLE budgets ADD CONSTRAINT budgets_planned_nonneg CHECK (planned_cents IS NULL OR planned_cents >= 0);
