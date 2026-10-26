-- step2_salon_qr_code.sql
-- Adds a short, unguessable public code to every salon. It is what the printed wall QR encodes:
--   https://<your-domain>/q/<qr_code>
-- Idempotent and additive: safe to run on a live database and safe to re-run. 
-- gen_random_uuid() is built into Postgres, so this needs no extension.

ALTER TABLE public.salons ADD COLUMN IF NOT EXISTS qr_code text;

-- Existing salons get a code (volatile function: evaluated once per row).
UPDATE public.salons
SET qr_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE qr_code IS NULL;

-- New salons (including ones made by db:create-salon) get one automatically.
ALTER TABLE public.salons
  ALTER COLUMN qr_code SET DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
ALTER TABLE public.salons ALTER COLUMN qr_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS salons_qr_code_key ON public.salons (qr_code);
