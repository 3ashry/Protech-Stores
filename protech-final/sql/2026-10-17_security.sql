-- 2026-10-17 security fixes — applied to project wljxplbcfoorqpoflcdz.
-- (Applied statement by statement; DROP POLICY could not be run through the
--  API connection, so open policies were rewritten in place with ALTER POLICY.)

-- 1. protech-media storage: anyone can VIEW, only admins (public.is_admin(),
--    i.e. profiles.role = 'admin') can upload / replace / delete.
alter policy auth_upload_media    on storage.objects to authenticated with check (bucket_id = 'protech-media' and public.is_admin());
alter policy auth_update_media    on storage.objects to authenticated using (bucket_id = 'protech-media' and public.is_admin()) with check (bucket_id = 'protech-media' and public.is_admin());
alter policy auth_delete_media    on storage.objects to authenticated using (bucket_id = 'protech-media' and public.is_admin());
alter policy protech_media_insert on storage.objects to authenticated with check (bucket_id = 'protech-media' and public.is_admin());
alter policy protech_media_update on storage.objects to authenticated using (bucket_id = 'protech-media' and public.is_admin()) with check (bucket_id = 'protech-media' and public.is_admin());
-- unchanged: protech_media_read / public_read_media (SELECT for everyone)

-- 2. abandoned_carts: visitors can still INSERT, can no longer UPDATE any row.
--    Carts are marked converted by a trigger when an order is saved.
create or replace function public.mark_abandoned_carts_converted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null and new.phone <> '' then
    update public.abandoned_carts set status = 'converted', updated_at = now()
     where phone = new.phone and status = 'open';
  end if;
  return new;
end;
$$;
revoke execute on function public.mark_abandoned_carts_converted() from public, anon, authenticated;
create trigger orders_convert_abandoned_carts
  after insert on public.orders
  for each row execute function public.mark_abandoned_carts_converted();
alter policy public_update on public.abandoned_carts using (false) with check (false);

-- 3. _ship_snapshot (unused by any code): row security on, no policies → server only.
alter table public._ship_snapshot enable row level security;

-- 4. Advisor: the signup trigger function is not callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
