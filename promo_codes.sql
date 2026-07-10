-- Promo codes: free shipping, single use. Run once in the STORE Supabase project
-- (SQL Editor). Access is only via the service_role serverless function, so RLS is
-- on with no public policies.

create table if not exists promo_codes (
  code          text primary key,
  discount      text        not null default 'free_shipping',
  used          boolean     not null default false,
  used_at       timestamptz,
  order_id      text,
  used_by_phone text
);

alter table promo_codes enable row level security;

-- Seed the codes (0000 = test code). ON CONFLICT DO NOTHING so re-running is safe
-- and never resets an already-used code.
insert into promo_codes (code) values
  ('بروتيك-0000'),
  ('بروتيك-0305'),('بروتيك-8923'),('بروتيك-8210'),('بروتيك-0965'),('بروتيك-9299'),
  ('بروتيك-7946'),('بروتيك-5684'),('بروتيك-4259'),('بروتيك-8337'),('بروتيك-1084'),
  ('بروتيك-1389'),('بروتيك-1421'),('بروتيك-3886'),('بروتيك-4625'),('بروتيك-6159'),
  ('بروتيك-1004'),('بروتيك-5980'),('بروتيك-7885'),('بروتيك-1525'),('بروتيك-9729'),
  ('بروتيك-8139'),('بروتيك-2087'),('بروتيك-2704'),('بروتيك-1120'),('بروتيك-0038'),
  ('بروتيك-3247'),('بروتيك-8802'),('بروتيك-6034'),('بروتيك-9384'),('بروتيك-5078'),
  ('بروتيك-5800'),('بروتيك-8598'),('بروتيك-0690'),('بروتيك-2409'),('بروتيك-9784'),
  ('بروتيك-6803'),('بروتيك-6841')
on conflict (code) do nothing;

-- To re-arm the TEST code after a test order:
--   update promo_codes set used=false, used_at=null, order_id=null, used_by_phone=null
--   where code='بروتيك-0000';
