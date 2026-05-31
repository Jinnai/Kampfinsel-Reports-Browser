drop policy if exists "public can insert spy reports" on public.spy_reports;

create policy "public can insert valid spy reports"
  on public.spy_reports
  for insert
  with check (
    length(trim(raw_report)) > 0
    and reported_at > now() - interval '180 days'
    and reported_at < now() + interval '1 day'
    and ocean is not null
    and island_x is not null
    and island_y is not null
    and target_player is not null
    and parsed_report->>'reportType' in ('player', 'old-empire', 'corsair-fortress')
    and (parsed_report->'resources') ? 'gold'
    and (parsed_report->'resources') ? 'stone'
    and (parsed_report->'resources') ? 'wood'
  );
