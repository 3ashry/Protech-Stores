-- ══════════════════════════════════════════════
-- PROTECH ORDER MANAGEMENT — SUPABASE SETUP
-- Run this in: Supabase → SQL Editor → New Query → Run
-- ══════════════════════════════════════════════

-- PRODUCTS TABLE
create table if not exists products (
  id text primary key,
  code text not null,
  name text not null,
  qty integer default 0,
  price numeric(10,2) default 0,
  created_at timestamptz default now()
);

-- ORDERS TABLE
create table if not exists orders (
  id text primary key,
  code text not null,
  customer_name text not null,
  phone text not null,
  ship_code text,
  est_shipping numeric(10,2) default 0,
  actual_shipping numeric(10,2) default 0,
  products jsonb default '[]',
  total numeric(10,2) default 0,
  status text default 'Processing',
  date text,
  cancel_reason text,
  created_at timestamptz default now()
);

-- EXPENSES TABLE
create table if not exists expenses (
  id text primary key,
  category text not null,
  description text,
  amount numeric(10,2) default 0,
  date text,
  created_at timestamptz default now()
);

-- FEEDBACKS TABLE
create table if not exists feedbacks (
  id text primary key,
  order_code text,
  service text,
  general text,
  recommend text,
  quality text,
  delivery text,
  packing text,
  comment text,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════════════
-- ENABLE ROW LEVEL SECURITY + OPEN ACCESS POLICY
-- Required for the publishable key to work
-- ══════════════════════════════════════════════

alter table products enable row level security;
alter table orders enable row level security;
alter table expenses enable row level security;
alter table feedbacks enable row level security;

-- Allow all operations (your app handles auth with its own login screen)
create policy "allow_all_products" on products for all using (true) with check (true);
create policy "allow_all_orders" on orders for all using (true) with check (true);
create policy "allow_all_expenses" on expenses for all using (true) with check (true);
create policy "allow_all_feedbacks" on feedbacks for all using (true) with check (true);
