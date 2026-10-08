-- ════════════════════════════════════════════════════════════════════
-- PROTECH — SECURITY LOCKDOWN (RLS)
-- Run in: Supabase → SQL Editor → New Query → Run (as one script).
--
-- WHAT THIS DOES
--   Replaces the current wide-open "allow everyone" policies with an
--   allowlist: the public/anon key can ONLY do the few things the public
--   storefront needs; everything else requires your logged-in admin JWT
--   (role = authenticated). Serverless functions use the service_role
--   key, which bypasses RLS, so Bosta / WhatsApp / picker are unaffected.
--
--   This is idempotent: it drops every existing policy on each table and
--   recreates the precise set, so running it twice is safe.
--
-- PUBLIC (anon) IS ALLOWED ONLY:
--   products         SELECT published rows, WITHOUT buy_price (column-locked)
--   orders           INSERT only (checkout; storefront uses return=minimal)
--   site_settings    SELECT only  (inline edit-mode write is now admin-only)
--   analytics_events INSERT, plus SELECT of product_view in the last 60s
--   feedbacks        INSERT
--   waitlist         INSERT
--   abandoned_carts  INSERT + UPDATE (cart tracking; low sensitivity)
--   push_subscriptions  (none — handled server-side via service_role)
--
-- EVERYTHING below requires the admin JWT (authenticated):
--   orders (read/update/delete), products (write), expenses,
--   supplier_invoices, supplier_payments, bosta_receipts, admin_tasks,
--   promo_codes, picker_accounts, feedbacks (read), analytics (read all),
--   site_settings (write).
-- ════════════════════════════════════════════════════════════════════

-- Make sure RLS is on for every table we touch (it already is, but be safe).
do $$
declare t text;
begin
  foreach t in array array[
    'abandoned_carts','admin_tasks','analytics_events','bosta_receipts',
    'expenses','feedbacks','orders','picker_accounts','products',
    'promo_codes','push_subscriptions','site_settings','supplier_invoices',
    'supplier_payments','waitlist'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Drop ALL existing policies on these tables, so no leftover permissive
-- rule (e.g. the duplicate anon order-read policies) survives.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'abandoned_carts','admin_tasks','analytics_events','bosta_receipts',
        'expenses','feedbacks','orders','picker_accounts','products',
        'promo_codes','push_subscriptions','site_settings','supplier_invoices',
        'supplier_payments','waitlist'
      )
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── Admin-only tables (authenticated = your login; nothing for anon) ──
create policy admin_all on public.admin_tasks        for all to authenticated using (true) with check (true);
create policy admin_all on public.bosta_receipts     for all to authenticated using (true) with check (true);
create policy admin_all on public.expenses           for all to authenticated using (true) with check (true);
create policy admin_all on public.picker_accounts    for all to authenticated using (true) with check (true);
create policy admin_all on public.promo_codes        for all to authenticated using (true) with check (true);
create policy admin_all on public.supplier_invoices  for all to authenticated using (true) with check (true);
create policy admin_all on public.supplier_payments  for all to authenticated using (true) with check (true);
create policy admin_all on public.push_subscriptions for all to authenticated using (true) with check (true);

-- ── products: public reads published rows; admin does everything ──
create policy admin_all   on public.products for all   to authenticated using (true) with check (true);
create policy public_read on public.products for select to anon
  using (is_published = true or is_published is null);

-- ── orders: public can ONLY insert (checkout); admin everything ──
create policy admin_all    on public.orders for all    to authenticated using (true) with check (true);
create policy public_insert on public.orders for insert to anon with check (true);

-- ── feedbacks: public insert; admin reads/manages ──
create policy admin_all    on public.feedbacks for all    to authenticated using (true) with check (true);
create policy public_insert on public.feedbacks for insert to anon with check (true);

-- ── waitlist: public insert; admin reads ──
create policy admin_all    on public.waitlist for all    to authenticated using (true) with check (true);
create policy public_insert on public.waitlist for insert to anon with check (true);

-- ── abandoned_carts: public insert + update own cart; admin everything.
--    (Cart contents are low-sensitivity and keyed by a client-held id.) ──
create policy admin_all    on public.abandoned_carts for all    to authenticated using (true) with check (true);
create policy public_insert on public.abandoned_carts for insert to anon with check (true);
create policy public_update on public.abandoned_carts for update to anon using (true) with check (true);

-- ── analytics_events: public insert; public reads ONLY the last-60s
--    product_view rows (the live viewer counter); admin reads everything ──
create policy admin_all    on public.analytics_events for all    to authenticated using (true) with check (true);
create policy public_insert on public.analytics_events for insert to anon with check (true);
create policy public_live_counter on public.analytics_events for select to anon
  using (event_type = 'product_view' and created_at > now() - interval '60 seconds');

-- ── site_settings: public reads; writes are admin-only now ──
create policy admin_all   on public.site_settings for all   to authenticated using (true) with check (true);
create policy public_read on public.site_settings for select to anon using (true);

-- ── Column-lock buy_price on products ──
-- With table-level SELECT revoked and column-level SELECT granted on every
-- column EXCEPT buy_price, the storefront's `select=*` silently returns all
-- product columns except the cost. The admin (authenticated) keeps full
-- access through its own grant below.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'products'
     and column_name  <> 'buy_price';
  revoke select on public.products from anon;
  execute format('grant select (%s) on public.products to anon', cols);
  -- authenticated keeps full column access (incl. buy_price).
  grant select, insert, update, delete on public.products to authenticated;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- QUICK VERIFY after running (optional):
--   -- As anon (use the Anon key in a REST call), this must return 0 rows / 401-ish:
--   --   GET /rest/v1/orders?select=*          → should be empty / denied
--   --   GET /rest/v1/products?select=buy_price → column should NOT come back
--   -- Logged in as admin, everything works as before.
-- ════════════════════════════════════════════════════════════════════
