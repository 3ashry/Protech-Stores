-- Heartbeat for scheduled syncs (first user: /api/meta-sync).
-- One row per run, success or failure, so the dashboard and the agents can
-- tell "no ad spend" apart from "the sync isn't running".
create table if not exists public.sync_runs (
  id              bigint generated always as identity primary key,
  job             text        not null,          -- e.g. 'meta-sync'
  ran_at          timestamptz not null default now(),
  ok              boolean     not null,
  rows            integer,
  window_since    date,
  window_until    date,
  last_spend_date date,                          -- meta-sync: last day with spend in the window
  error           text
);

create index if not exists sync_runs_job_ran_at on public.sync_runs (job, ran_at desc);

alter table public.sync_runs enable row level security;

drop policy if exists admin_all on public.sync_runs;
create policy admin_all on public.sync_runs
  for all to authenticated using (is_admin()) with check (is_admin());
-- Writes come from the server with the service_role key, which bypasses RLS.
