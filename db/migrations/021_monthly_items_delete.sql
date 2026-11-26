-- Itens de "Custos fixos" derivados automaticamente dos gastos de categorias
-- fixas (readRoutine/deriveFixedItems) são recalculados a cada abertura do mês:
-- os derivados ainda não tocados são apagados e recriados com o valor atual.
-- Para isso, monthly_items precisa de DELETE (migration 001 só deu
-- SELECT,INSERT,UPDATE). A policy limita o DELETE à própria família, como as
-- demais (current_member). Só o app derivado apaga; itens manuais nunca são
-- removidos por esta via (o gerador só apaga derived=true AND event_id IS NULL).
CREATE POLICY delete_family ON monthly_items FOR DELETE TO family_app USING (current_member(household_id,true));
GRANT DELETE ON monthly_items TO family_app;
