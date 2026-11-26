-- reserve_plans.occurrence_id passa a apontar para o núcleo de recorrências.
-- Os ids das ocorrências migradas são os mesmos e hoje todos os valores são nulos.
DO $$
DECLARE c text;
BEGIN
 FOR c IN
  SELECT con.conname FROM pg_constraint con
  WHERE con.conrelid='reserve_plans'::regclass AND con.contype='f'
   AND con.confrelid IN ('income_occurrences'::regclass,'recurrence_occurrences'::regclass)
   AND con.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='reserve_plans'::regclass AND attname='occurrence_id')]
 LOOP
  EXECUTE format('ALTER TABLE reserve_plans DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE reserve_plans ADD CONSTRAINT reserve_plans_occurrence_id_fkey
 FOREIGN KEY(occurrence_id) REFERENCES recurrence_occurrences(id);
