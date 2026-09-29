-- Our promise to local game stores, on the Fairness page (Tyson's wording).
--
-- Invariants:
--   * Published policy versions never change (0018), so this publishes a new Fairness version
--     with the section added after "Our fairness promise". Fairness needs no acceptance, so
--     customers are not asked to accept anything again.

do $$
declare v policy_versions; marker text := E'\n## Credits\n';
begin
  select * into v from policy_versions where doc = 'fairness' order by published_at desc, version desc limit 1;
  if position(marker in v.body_md) = 0 then raise exception 'policy_edit_not_found'; end if;
  insert into policy_versions (doc, version, published_at, title, body_md) values ('fairness', '2026-10-03', '2026-09-29T00:00:01Z', v.title,
    replace(v.body_md, marker, E'\n## Our promise to local game stores\n'
      || 'Magic''s best moments happen at a table with friends. We crack packs online so you can spend more time and money at your local game store building decks, playing events, and being part of the community. Whether you''re across the country from your nearest shop or just don''t have time to visit, we make sure everyone can experience that thrill of opening packs. Magic should be accessible to all players, no matter where they are or how busy life gets.'
      || E'\n' || marker));
end $$;
