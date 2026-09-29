-- Real pack photos for every set on sale (brand kit, item 2).
--
-- Invariants:
--   * A set can't be put on sale, or get a published drop, without a pack photo
--     (mtg_sets.pack_image_url). Customers never see a drawn, text only pack tile.
--   * A set's photo can't be removed while it is on sale or has a published drop.
--   * Foundations uses the Play Booster photo bundled with the customer site.

update mtg_sets set pack_image_url = '/packs/fdn.jpg' where code = 'FDN' and pack_image_url is null;

create or replace function set_product_active(p_product uuid, p_active boolean, p_actor uuid) returns void language plpgsql as $$
begin
  if p_active and not exists (select 1 from price_tiers where product_id = p_product and min_qty = 1) then
    raise exception 'ladder_must_start_at_one';
  end if;
  if p_active and not exists (select 1 from products p join mtg_sets s on s.code = p.set_code where p.id = p_product and s.card_data_ok) then
    raise exception 'card_data_unverified';
  end if;
  if p_active and not exists (select 1 from products p join mtg_sets s on s.code = p.set_code where p.id = p_product and s.pack_image_url is not null) then
    raise exception 'pack_photo_required';
  end if;
  update products set active = p_active where id = p_product;
  if not found then raise exception 'unknown_product'; end if;
  perform log_custody(null, case when p_active then 'product_activated' else 'product_deactivated' end,
                      jsonb_build_object('product_id', p_product), p_actor);
end $$;

create function drops_pack_photo_guard() returns trigger language plpgsql as $$
begin
  if new.status = 'published' and not exists (select 1 from mtg_sets where code = new.set_code and pack_image_url is not null) then
    raise exception 'pack_photo_required';
  end if;
  return new;
end $$;
create trigger drops_pack_photo_guard before insert or update on drops for each row execute function drops_pack_photo_guard();

create or replace function set_set_info(p_set text, p_wizards_url text, p_pack_image_url text) returns void language plpgsql as $$
declare v_photo text := nullif(trim(p_pack_image_url), '');
begin
  if v_photo is null and (exists (select 1 from products where set_code = upper(p_set) and active)
      or exists (select 1 from drops where set_code = upper(p_set) and status = 'published')) then
    raise exception 'pack_photo_required';
  end if;
  update mtg_sets set wizards_info_url = nullif(trim(p_wizards_url), ''), pack_image_url = v_photo where code = upper(p_set);
  if not found then raise exception 'unknown_set'; end if;
end $$;
