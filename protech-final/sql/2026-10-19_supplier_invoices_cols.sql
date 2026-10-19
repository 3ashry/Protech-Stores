-- Applied 2026-10-19: columns the invoice-match save sends but the table lacked.
alter table public.supplier_invoices
  add column if not exists price_map jsonb,
  add column if not exists adjustments jsonb;
