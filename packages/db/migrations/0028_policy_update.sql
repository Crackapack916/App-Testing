-- Fairness and Terms match how the test run works now (persona testing).
--
-- Invariants:
--   * Published policy versions never change (0018), so this publishes new versions of Fairness
--     and Terms. Customers accept the new Terms at their next purchase (needs_policy_acceptance).
--   * The limit is 6 packs of each set per night across every customer (0026), not per customer.
--   * Packs are opened after the 7:00 PM lock and filmed one video per pack; there is no fixed
--     opening window.

create function publish_policy_edit(p_doc text, p_version text, p_published timestamptz, p_edits text[][])
returns void language plpgsql as $$
declare v policy_versions; body text; i int;
begin
  select * into v from policy_versions where doc = p_doc order by published_at desc, version desc limit 1;
  body := v.body_md;
  for i in 1 .. array_length(p_edits, 1) loop
    if position(p_edits[i][1] in body) = 0 then raise exception 'policy_edit_not_found: %', p_edits[i][1]; end if;
    body := replace(body, p_edits[i][1], p_edits[i][2]);
  end loop;
  insert into policy_versions (doc, version, published_at, title, body_md) values (p_doc, p_version, p_published, v.title, body);
end $$;

select publish_policy_edit('fairness', '2026-10-02', '2026-09-29T00:00:00Z', array[
  ['3. We open sealed packs on camera, in order, and match them to the list.',
   '3. We open sealed packs in order, match them to the list, and film each pack.'],
  ['We then open sealed packs on camera in the order they come out of the case and match them to the list in order.',
   'We then open sealed packs in the order they come out of the case, match them to the list in order, and film each pack.'],
  ['Every opening is recorded, and yours is in your Vault.',
   'Every pack''s opening is recorded, and your videos are in your Vault.'],
  ['During the test run, each customer can buy up to 6 packs of each set. A drop can set its own limit, shown on the Packs page.',
   'During the test run, each night''s queue holds up to 6 packs of each set, shared by all customers. There is no limit per customer. When a night''s packs of a set are taken, that set is sold out until 7:00 PM Pacific, when orders for the next night open. A drop can have its own number of packs, shown on the Packs page.']
]);

select publish_policy_edit('terms', '2026-10-02', '2026-09-29T00:00:00Z', array[
  ['We open packs on camera between 7:00 and 8:00 PM Pacific in the order they come out of the case and match them to the queue in order.',
   'After the lock we open packs in the order they come out of the case, match them to the queue in order, and film each pack.'],
  ['During the test run each customer can buy up to 6 packs of each set, counting orders not yet opened. A drop may set a different limit. We may change a limit for a customer and keep a record of why.',
   'During the test run each night''s queue holds up to 6 packs of each set, shared by all customers, counting orders not cancelled. There is no limit per customer. A drop may have its own number of packs.']
]);

drop function publish_policy_edit(text, text, timestamptz, text[][]);
