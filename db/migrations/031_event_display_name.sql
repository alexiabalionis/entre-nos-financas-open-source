ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS display_name text CHECK (display_name IS NULL OR length(btrim(display_name)) BETWEEN 1 AND 120);
