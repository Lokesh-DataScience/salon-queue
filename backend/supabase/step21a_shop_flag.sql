-- backend/supabase/step21a_shop_flag.sql — Commerce Phase 1, C2: the shop on/off switch.
-- Run on the TESTS project first, with NOTHING highlighted. Ends with "step21a OK". Safe to run twice.
-- Production: run this BEFORE deploying the C2 backend. The flag starts OFF; customers see nothing.
--
-- shop_enabled (Admin → Tech → Tools & flags):
--   enabled  = false → no Shop tab, no Shop strip, the customer shop API answers 404 (default)
--   enabled  = true  → Shop tab for everyone; the strip on ticket pages follows the value:
--   value    = 'internal' → strip only on tickets of internal (test/demo) salons   (C7 pilot, Q12)
--   value    = 'all'      → strip on every salon's tickets
-- The strip shows on waiting AND completed tickets (Q12 default).

begin;

insert into public.feature_flags (key, enabled, value, description) values
  ('shop_enabled', false, 'internal',
   'Customer shop (Commerce Phase 1). On = Shop tab for customers. Value "internal" = the Shop strip shows on internal salons'' tickets only; "all" = on every salon''s tickets.')
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.feature_flags where key = 'shop_enabled') then
    raise exception 'step21a check failed: flag missing.';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'products') then
    raise exception 'step21a check failed: run step21_shop_catalog.sql first.';
  end if;
  raise notice 'step21a OK';
end $$;

commit;

-- Check: select key, enabled, value from public.feature_flags where key = 'shop_enabled';
