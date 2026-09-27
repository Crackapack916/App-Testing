-- Removing a mis-logged card from a pack before it is finalized.
-- pack_contents_guard still rejects the delete once the pack is finalized.
create function clear_pack_card(p_pack_opening uuid, p_slot int) returns void language plpgsql as $$
begin
  delete from pack_contents where pack_opening_id = p_pack_opening and slot = p_slot;
end $$;
