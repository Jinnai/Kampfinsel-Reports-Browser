create extension if not exists pgcrypto;

create table if not exists public.spy_reports (
  id uuid primary key default gen_random_uuid(),
  report_hash text not null unique,
  reported_at timestamptz not null default now(),
  target_player text,
  target_alliance text,
  ocean integer check (ocean is null or (ocean >= 1 and ocean <= 99)),
  island_x integer check (island_x is null or (island_x >= 1 and island_x <= 25)),
  island_y integer check (island_y is null or (island_y >= 1 and island_y <= 10)),
  raw_report text not null,
  parsed_report jsonb not null default '{}'::jsonb,
  source text not null default 'manual' check (source in ('manual', 'loss-calculator', 'userscript', 'api')),
  created_at timestamptz not null default now()
);

create index if not exists spy_reports_reported_at_idx on public.spy_reports (reported_at desc);
create index if not exists spy_reports_ocean_idx on public.spy_reports (ocean);
create index if not exists spy_reports_target_player_idx on public.spy_reports (lower(target_player));
create index if not exists spy_reports_target_alliance_idx on public.spy_reports (lower(target_alliance));

alter table public.spy_reports enable row level security;

drop policy if exists "public can read spy reports" on public.spy_reports;
create policy "public can read spy reports"
  on public.spy_reports
  for select
  using (true);

drop policy if exists "public can insert spy reports" on public.spy_reports;
create policy "public can insert spy reports"
  on public.spy_reports
  for insert
  with check (
    length(trim(raw_report)) > 0
    and reported_at > now() - interval '180 days'
    and reported_at < now() + interval '1 day'
  );
