-- ════════════════════════════════════════════════════════════════════
-- PROTECH — LOCKDOWN ROLLBACK (EMERGENCY ONLY)   [plain-statement version]
-- Run ONLY if the lockdown broke the storefront and you need the old
-- (open) behaviour back while we debug. NOT secure — a panic button.
-- ════════════════════════════════════════════════════════════════════

-- Drop the lockdown policies.
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

-- Undo the buy_price column-lock (restore table-wide SELECT for anon).
grant select on public.products to anon;

-- Re-create the old wide-open policies.
create policy allow_all on public.abandoned_carts    for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.admin_tasks         for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.analytics_events    for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.bosta_receipts      for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.expenses            for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.feedbacks           for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.orders              for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.picker_accounts     for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.products            for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.promo_codes         for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.push_subscriptions  for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.site_settings       for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.supplier_invoices   for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.supplier_payments   for all to anon, authenticated using (true) with check (true);
create policy allow_all on public.waitlist            for all to anon, authenticated using (true) with check (true);
