-- Aprendizado de categoria por correção: a tabela merchant_rules (migration 005)
-- guarda match_text -> category_name por família e já é lida na categorização
-- (assisted.ts, bank-analysis.ts), mas só tinha GRANT SELECT,INSERT. Para
-- reaprender uma chave já existente (ON CONFLICT(household_id,match_text) DO
-- UPDATE), é preciso a policy e o GRANT de UPDATE. DELETE fica de fora até haver
-- uma tela de gerenciar regras.
CREATE POLICY family_update ON merchant_rules FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true));
GRANT UPDATE ON merchant_rules TO family_app;
