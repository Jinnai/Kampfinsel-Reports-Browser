alter table public.spy_reports
  drop constraint if exists spy_reports_island_x_check,
  drop constraint if exists spy_reports_island_y_check;

alter table public.spy_reports
  add constraint spy_reports_island_x_check
    check (island_x is null or (island_x >= 1 and island_x <= 25)),
  add constraint spy_reports_island_y_check
    check (island_y is null or (island_y >= 1 and island_y <= 10));
