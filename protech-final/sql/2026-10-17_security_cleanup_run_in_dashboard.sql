-- Optional tidy-up. Run in Supabase Dashboard → SQL Editor (the API connection
-- isn't allowed to drop/rename policies on storage.objects).
-- Removes the now-disabled cart policy and gives the storage policies clear names.
drop policy if exists public_update on public.abandoned_carts;
alter policy auth_upload_media    on storage.objects rename to protech_media_admin_insert;
alter policy auth_update_media    on storage.objects rename to protech_media_admin_update;
alter policy auth_delete_media    on storage.objects rename to protech_media_admin_delete;
drop policy if exists protech_media_insert on storage.objects;  -- duplicate of protech_media_admin_insert
drop policy if exists protech_media_update on storage.objects;  -- duplicate of protech_media_admin_update
