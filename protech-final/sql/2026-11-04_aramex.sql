-- Applied 2026-11-04: courier switch Bosta → Aramex.
alter table public.orders
  add column if not exists courier text,               -- 'aramex' | 'bosta'
  add column if not exists shipping_label_url text,    -- Aramex label (bolisa) link
  add column if not exists ship_error text,            -- last shipment-creation error
  add column if not exists ship_sent_at timestamptz,
  add column if not exists stock_decremented_at timestamptz, -- stock taken once
  add column if not exists courier_status text,        -- latest Aramex tracking update
  add column if not exists courier_status_at timestamptz;
update public.orders set courier='bosta' where courier is null and (bosta_id is not null or coalesce(ship_code,'')<>'');
update public.orders set stock_decremented_at = coalesce(created_at, now()) where stock_decremented_at is null;
-- calc_shipping
alter table public.orders add column if not exists calc_shipping numeric; -- estimated courier charge (2026-11-05)
