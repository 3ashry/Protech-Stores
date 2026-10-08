-- ════════════════════════════════════════════════════════════════════
-- HIDE BUY PRICE — STEP 1 of 2: create the cost-free public view
-- Run this NOW. It is additive and changes nothing the storefront or
-- admin currently depend on (the storefront still reads `products` until
-- its new build is deployed). Safe to re-run.
--
-- Builds `store_products` = every product column EXCEPT buy_price,
-- limited to published rows. Postgres fills in the column list itself,
-- so nothing the storefront needs is ever missed. Single DO block (no
-- loop), which the Supabase editor handles fine.
-- ════════════════════════════════════════════════════════════════════

do $mkview$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'products'
    and column_name  <> 'buy_price';

  execute format(
    'create or replace view public.store_products as '
    'select %s from public.products '
    'where is_published = true or is_published is null',
    cols
  );
end
$mkview$;

-- Public + admin can read the view; nobody can write through it.
grant select on public.store_products to anon, authenticated;

-- Tell PostgREST about the new view immediately.
notify pgrst, 'reload schema';
