-- Applied 2026-10-18. Where a cancelled order was stopped:
--   before_prep = cancelled before the prep center prepared it ("failed before preparing")
--   after_prep  = cancelled after it was prepared (prep center gets the DO NOT SHIP popup)
alter table public.orders add column if not exists cancel_stage text
  check (cancel_stage in ('before_prep','after_prep'));
