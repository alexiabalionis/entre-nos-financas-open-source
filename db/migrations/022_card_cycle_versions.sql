-- Histórico mínimo dos ciclos de cartão (K1). Cada versão vale para compras a
-- partir de valid_from; o fim é derivado da versão seguinte. first_due_month
-- indica a primeira fatura da versão (de transição, depois de uma troca); as
-- datas dela saem da própria regra. card_cycles continua existindo como a
-- configuração lida pelas telas atuais.
CREATE TABLE card_cycle_versions (
 id uuid PRIMARY KEY,
 household_id uuid NOT NULL,
 account_id uuid NOT NULL,
 closing_day integer NOT NULL CHECK(closing_day BETWEEN 1 AND 31),
 due_day integer NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 due_month_offset integer NOT NULL CHECK(due_month_offset IN (0,1)),
 valid_from date NOT NULL,
 first_due_month date NOT NULL CHECK(extract(day FROM first_due_month)=1),
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(household_id,account_id,valid_from),
 UNIQUE(household_id,id),
 FOREIGN KEY(household_id,account_id) REFERENCES accounts(household_id,id),
 FOREIGN KEY(household_id,created_by) REFERENCES members(household_id,user_id),
 CHECK(first_due_month>=date_trunc('month',valid_from)::date
   AND first_due_month<=(date_trunc('month',valid_from)+interval '3 months')::date)
);
ALTER TABLE card_cycle_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_cycle_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON card_cycle_versions FROM PUBLIC;
CREATE POLICY family_read ON card_cycle_versions FOR SELECT TO family_app USING(current_member(household_id,false));
CREATE POLICY family_insert ON card_cycle_versions FOR INSERT TO family_app WITH CHECK(current_member(household_id,true));
CREATE POLICY family_update ON card_cycle_versions FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true));
-- DELETE só cancela uma versão futura, ainda não vigente.
CREATE POLICY family_delete ON card_cycle_versions FOR DELETE TO family_app USING(current_member(household_id,true) AND valid_from>(now() AT TIME ZONE 'America/Sao_Paulo')::date);
GRANT SELECT,INSERT,UPDATE,DELETE ON card_cycle_versions TO family_app;

-- Primeira versão a partir da configuração atual. saved_on = dia do
-- salvamento (auditoria, senão updated_at). Vale desde saved_on; se o
-- fechamento informado já tinha passado, desde o dia seguinte a ele, mas nunca
-- antes do início da fatura aberta em saved_on. A primeira fatura é a da regra
-- que contém saved_on, calculada como cardCyclePeriod (dia limitado ao fim do
-- mês). Cartões cuja fatura nesse mês teria vencimento até o fechamento ficam
-- sem versão (competência desconhecida até salvarem o ciclo de novo). Só
-- INSERT; card_cycles não é alterada.
INSERT INTO card_cycle_versions(id,household_id,account_id,closing_day,due_day,due_month_offset,valid_from,first_due_month,created_by)
SELECT gen_random_uuid(),c.household_id,c.account_id,c.closing_day,c.due_day,c.due_month_offset,
 CASE WHEN c.effective_close_date>=s.saved_on THEN s.saved_on
      ELSE GREATEST(c.effective_close_date+1,o.start_date) END,
 o.due_month,c.created_by
FROM card_cycles c
CROSS JOIN LATERAL (
 SELECT coalesce(
  (SELECT (a.created_at AT TIME ZONE 'America/Sao_Paulo')::date FROM audit_events a
   WHERE a.household_id=c.household_id AND a.action='card.cycle' AND a.entity_id=c.account_id
     AND a.metadata->>'close_date'=c.effective_close_date::text
     AND a.metadata->>'due_date'=c.effective_due_date::text
   ORDER BY a.created_at DESC LIMIT 1),
  (c.updated_at AT TIME ZONE 'America/Sao_Paulo')::date) AS saved_on
) s
CROSS JOIN LATERAL (
 SELECT b.due_month,b.start_date
 FROM generate_series(0,2) k
 CROSS JOIN LATERAL (SELECT (date_trunc('month',s.saved_on)+k*interval '1 month')::date AS due_month) dm
 CROSS JOIN LATERAL (SELECT (dm.due_month-c.due_month_offset*interval '1 month')::date AS close_month) cm
 CROSS JOIN LATERAL (SELECT
   dm.due_month,
   cm.close_month+least(c.closing_day,extract(day FROM (cm.close_month+interval '1 month')::date-1)::int)-1 AS close_date,
   (cm.close_month-interval '1 month')::date+least(c.closing_day,extract(day FROM cm.close_month-1)::int) AS start_date
 ) b
 -- Vencimento cortado no fim do mês (ex. 28/30 em fevereiro): quando o dia do
 -- vencimento calculado cai no fechamento ou antes, usa o dia seguinte ao
 -- fechamento, espelhando ruleBill. Sem o filtro de descarte, a fatura nunca
 -- some e o cartão recebe versão.
 CROSS JOIN LATERAL (SELECT
   greatest(dm.due_month+least(c.due_day,extract(day FROM (dm.due_month+interval '1 month')::date-1)::int)-1,
            b.close_date+1) AS due_date
 ) d
 WHERE b.start_date<=s.saved_on AND s.saved_on<=b.close_date
 ORDER BY k LIMIT 1
) o
ON CONFLICT DO NOTHING;
