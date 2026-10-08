-- ════════════════════════════════════════════════════════════════════
-- PROTECH — SECURITY LOCKDOWN (RLS)   [plain-statement version]
-- Run in: Supabase → SQL Editor → New query → paste ALL → Run.
--
-- Replaces the wide-open "allow everyone" policies with an allowlist:
-- the public/anon key can ONLY do what the storefront needs; everything
-- else requires your logged-in admin JWT. Serverless keeps working via
-- the service_role key (bypasses RLS). Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Ensure RLS is on (it already is; harmless to repeat) ──────────
alter table public.abandoned_carts    enable row level security;
alter table public.admin_tasks        enable row level security;
alter table public.analytics_events   enable row level security;
alter table public.bosta_receipts     enable row level security;
alter table public.expenses           enable row level security;
alter table public.feedbacks          enable row level security;
alter table public.orders             enable row level security;
alter table public.picker_accounts    enable row level security;
alter table public.products           enable row level security;
alter table public.promo_codes        enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.site_settings      enable row level security;
alter table public.supplier_invoices  enable row level security;
alter table public.supplier_payments  enable row level security;
alter table public.waitlist           enable row level security;

-- ── 2. Drop every existing policy (your current set, by name) ────────
drop policy if exists ac_delete                                        on public.abandoned_carts;
drop policy if exists ac_insert                                        on public.abandoned_carts;
drop policy if exists ac_select                                        on public.abandoned_carts;
drop policy if exists ac_update                                        on public.abandoned_carts;
drop policy if exists admin_tasks_all                                  on public.admin_tasks;
drop policy if exists analytics_admin_all                             on public.analytics_events;
drop policy if exists analytics_public_insert                         on public.analytics_events;
drop policy if exists "anon can read recent product_view for live counter" on public.analytics_events;
drop policy if exists anon_insert_analytics                           on public.analytics_events;
drop policy if exists anon_select_analytics                           on public.analytics_events;
drop policy if exists bosta_receipts_admin_all                        on public.bosta_receipts;
drop policy if exists expenses_admin_all                              on public.expenses;
drop policy if exists feedbacks_admin_all                             on public.feedbacks;
drop policy if exists feedbacks_public_insert                         on public.feedbacks;
drop policy if exists anon_insert_orders                              on public.orders;
drop policy if exists anon_read_orders                                on public.orders;
drop policy if exists anon_select_orders                              on public.orders;
drop policy if exists orders_admin_all                                on public.orders;
drop policy if exists orders_public_insert                            on public.orders;
drop policy if exists anon_read_products                              on public.products;
drop policy if exists anon_update_products                            on public.products;
drop policy if exists products_admin_write                            on public.products;
drop policy if exists products_public_read                            on public.products;
drop policy if exists promo_read                                      on public.promo_codes;
drop policy if exists promo_update                                    on public.promo_codes;
drop policy if exists anon_read_settings                              on public.site_settings;
drop policy if exists anon_read_site_settings                         on public.site_settings;
drop policy if exists anon_update_site_settings                       on public.site_settings;
drop policy if exists settings_admin_all                              on public.site_settings;
drop policy if exists settings_public_read                            on public.site_settings;
drop policy if exists "admin full access"                             on public.supplier_invoices;
drop policy if exists anon_all_supplier_payments                      on public.supplier_payments;
drop policy if exists supplier_admin_all                              on public.supplier_payments;
drop policy if exists anon_insert_waitlist                            on public.waitlist;

-- Also drop the new names (so this whole script is safe to re-run).
drop policy if exists admin_all           on public.abandoned_carts;
drop policy if exists public_insert       on public.abandoned_carts;
drop policy if exists public_update       on public.abandoned_carts;
drop policy if exists admin_all           on public.admin_tasks;
drop policy if exists admin_all           on public.analytics_events;
drop policy if exists public_insert       on public.analytics_events;
drop policy if exists public_live_counter on public.analytics_events;
drop policy if exists admin_all           on public.bosta_receipts;
drop policy if exists admin_all           on public.expenses;
drop policy if exists admin_all           on public.feedbacks;
drop policy if exists public_insert       on public.feedbacks;
drop policy if exists admin_all           on public.orders;
drop policy if exists public_insert       on public.orders;
drop policy if exists admin_all           on public.picker_accounts;
drop policy if exists admin_all           on public.products;
drop policy if exists public_read         on public.products;
drop policy if exists admin_all           on public.promo_codes;
drop policy if exists admin_all           on public.push_subscriptions;
drop policy if exists admin_all           on public.site_settings;
drop policy if exists public_read         on public.site_settings;
drop policy if exists admin_all           on public.supplier_invoices;
drop policy if exists admin_all           on public.supplier_payments;
drop policy if exists admin_all           on public.waitlist;

-- ── 3. Admin-only tables (only your login; nothing for anon) ─────────
create policy admin_all on public.admin_tasks        for all to authenticated using (true) with check (true);
create policy admin_all on public.bosta_receipts     for all to authenticated using (true) with check (true);
create policy admin_all on public.expenses           for all to authenticated using (true) with check (true);
create policy admin_all on public.picker_accounts    for all to authenticated using (true) with check (true);
create policy admin_all on public.promo_codes        for all to authenticated using (true) with check (true);
create policy admin_all on public.supplier_invoices  for all to authenticated using (true) with check (true);
create policy admin_all on public.supplier_payments  for all to authenticated using (true) with check (true);
create policy admin_all on public.push_subscriptions for all to authenticated using (true) with check (true);

-- ── 4. products: public reads published rows; admin does everything ──
create policy admin_all   on public.products for all    to authenticated using (true) with check (true);
create policy public_read on public.products for select to anon
  using (is_published = true or is_published is null);

-- ── 5. orders: public can ONLY insert (checkout); admin everything ──
create policy admin_all     on public.orders for all    to authenticated using (true) with check (true);
create policy public_insert on public.orders for insert to anon with check (true);

-- ── 6. feedbacks: public insert; admin manages ──
create policy admin_all     on public.feedbacks for all    to authenticated using (true) with check (true);
create policy public_insert on public.feedbacks for insert to anon with check (true);

-- ── 7. waitlist: public insert; admin reads ──
create policy admin_all     on public.waitlist for all    to authenticated using (true) with check (true);
create policy public_insert on public.waitlist for insert to anon with check (true);

-- ── 8. abandoned_carts: public insert + update; admin everything ──
create policy admin_all     on public.abandoned_carts for all    to authenticated using (true) with check (true);
create policy public_insert on public.abandoned_carts for insert to anon with check (true);
create policy public_update on public.abandoned_carts for update to anon using (true) with check (true);

-- ── 9. analytics_events: public insert + last-60s product_view read ──
create policy admin_all          on public.analytics_events for all    to authenticated using (true) with check (true);
create policy public_insert      on public.analytics_events for insert to anon with check (true);
create policy public_live_counter on public.analytics_events for select to anon
  using (event_type = 'product_view' and created_at > now() - interval '60 seconds');

-- ── 10. site_settings: public reads; writes admin-only ──
create policy admin_all   on public.site_settings for all    to authenticated using (true) with check (true);
create policy public_read on public.site_settings for select to anon using (true);

-- ── 11. Column-lock buy_price so the public key can't read cost ──────
-- Revoke table-wide SELECT from anon, then grant SELECT on every product
-- column EXCEPT buy_price. The storefront's select=* then returns all
-- columns except the cost. Admin keeps full access.
grant select, insert, update, delete on public.products to authenticated;

do $lock$
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
end
$lock$;
