-- Reports written by the Protech agent team (daily check, Thursday brief,
-- pricing report, alerts). Every new row is pushed to Telegram through
-- /api/agent-report, which re-reads the row and sends it once.
create table if not exists public.agent_reports (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  kind             text not null,                 -- daily_check | weekly_brief | pricing | market | alert | test
  agent            text not null default 'maestro',
  severity         text not null default 'info',  -- info | warn | alert
  title            text not null,
  summary          text not null,                 -- short plain text, what Telegram shows
  body_md          text,                          -- full report (Markdown), shown on the Team page
  data             jsonb,                         -- numbers behind the report, with the queries used
  notify           boolean not null default true, -- false = save to the Team page only
  telegram_sent_at timestamptz,
  telegram_error   text
);

create index if not exists agent_reports_created on public.agent_reports (created_at desc);

alter table public.agent_reports enable row level security;
drop policy if exists admin_all on public.agent_reports;
create policy admin_all on public.agent_reports
  for all to authenticated using (is_admin()) with check (is_admin());

-- Push each new report to the Vercel endpoint (same mechanism as the
-- new-order webhook). The endpoint ignores the payload's content and reads
-- the row itself, so a forged call can at most re-send a real report once.
drop trigger if exists agent_reports_notify on public.agent_reports;
create trigger agent_reports_notify
  after insert on public.agent_reports
  for each row
  when (new.notify)
  execute function supabase_functions.http_request(
    'https://protech-stores.vercel.app/api/agent-report', 'POST',
    '{"Content-type":"application/json"}', '{}', '5000');
