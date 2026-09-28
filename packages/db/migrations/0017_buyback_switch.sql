-- Sell back is off for the test run: customers keep cards in the vault or ship them.
--
-- Invariant: while system_config.buyback_enabled is false, no new buyback request can
-- exist. Enforced on insert, so every path (request_buyback or anything added later) is
-- covered. Held buybacks already in flight still release on schedule.

alter table system_config add column buyback_enabled boolean not null default false;

create function buyback_requests_switch() returns trigger language plpgsql as $$
begin
  if not (cfg()).buyback_enabled then raise exception 'buyback_disabled'; end if;
  return new;
end $$;
create trigger buyback_requests_switch before insert on buyback_requests
  for each row execute function buyback_requests_switch();
