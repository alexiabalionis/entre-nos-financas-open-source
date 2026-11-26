-- Fase 2 de docs/SPEC-FATOS-CARTAO.md: compra de cartão lida do banco vira
-- evento sozinha. auto_recorded marca a linha cujo evento o app criou e mantém:
-- ela segue o banco (valor, data, descrição) e o evento acompanha. Linhas
-- aprovadas à mão continuam com false e o comportamento antigo.
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS auto_recorded boolean NOT NULL DEFAULT false;
