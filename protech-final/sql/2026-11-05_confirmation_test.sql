-- Confirmation test: record, for every order, whether the customer had
-- confirmed at the moment it was sent to prep. Shipping unconfirmed orders
-- stays a manual choice ("Send to prep" in the admin); this only measures it.
--
--   confirmed_at_prep = true   customer confirmed (button or call) before/at send-to-prep
--   confirmed_at_prep = false  sent to prep without confirmation (the test group)
--   confirmed_at_prep = null   not sent to prep yet, or sent before this was added

alter table public.orders add column if not exists confirmed_at_prep boolean;

create or replace function public.orders_mark_confirmed_at_prep()
returns trigger
language plpgsql
as $$
begin
  -- Only on the first move into prep (null -> set). Undo + resend keeps the
  -- original reading, so withdrawing and re-sending doesn't rewrite history.
  if new.sent_to_picker_at is not null
     and (tg_op = 'INSERT' or old.sent_to_picker_at is null)
     and new.confirmed_at_prep is null then
    new.confirmed_at_prep := coalesce(new.customer_confirmed, false);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_confirmed_at_prep on public.orders;
create trigger orders_confirmed_at_prep
  before insert or update of sent_to_picker_at on public.orders
  for each row execute function public.orders_mark_confirmed_at_prep();
