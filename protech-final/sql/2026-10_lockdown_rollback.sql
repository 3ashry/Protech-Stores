-- ════════════════════════════════════════════════════════════════════
-- PROTECH — LOCKDOWN ROLLBACK (EMERGENCY ONLY)
-- Run this ONLY if the lockdown broke the storefront and you need to
-- restore the previous (open) behaviour instantly while we debug.
-- It re-opens anon access the way it was before. It is NOT secure —
-- it's a panic button, not a destination.
-- ════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname='public'
      and tablename in (
        'abandoned_carts','admin_tasks','analytics_events','bosta_receipts',
        'expenses','feedbacks','orders','picker_accounts','products',
        'promo_codes','push_subscriptions','site_settings','supplier_invoices',
        'supplier_payments','waitlist')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Restore table-level SELECT on products for anon (undo the column-lock).
grant select on public.products to anon;

-- Re-create permissive open policies (pre-lockdown behaviour).
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
