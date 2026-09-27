-- Putting a set on sale. A product starts inactive; it can be activated only with a valid
-- price ladder. The ladder must start at 1 pack and never charge more per pack for a
-- bigger order.

create function set_price_ladder(p_product uuid, p_ladder jsonb) returns void language plpgsql as $$
declare prev bigint := null; t record;
begin
  if jsonb_array_length(coalesce(p_ladder, '[]')) = 0 then raise exception 'ladder_empty'; end if;
  for t in select * from jsonb_to_recordset(p_ladder) as x(min_qty int, per_pack_credits bigint) order by min_qty loop
    if prev is null and t.min_qty <> 1 then raise exception 'ladder_must_start_at_one'; end if;
    if t.per_pack_credits is null or t.per_pack_credits <= 0 then raise exception 'ladder_price_invalid'; end if;
    if prev is not null and t.per_pack_credits > prev then raise exception 'ladder_not_decreasing'; end if;
    prev := t.per_pack_credits;
  end loop;
  delete from price_tiers where product_id = p_product;
  insert into price_tiers (product_id, min_qty, per_pack_credits)
  select p_product, x.min_qty, x.per_pack_credits from jsonb_to_recordset(p_ladder) as x(min_qty int, per_pack_credits bigint);
end $$;

-- The launch ladder from the business context: $9, $8.50, $8.25, $8, $7.75 per pack.
create function default_price_ladder() returns jsonb language sql immutable as $$
  select '[{"min_qty":1,"per_pack_credits":900},{"min_qty":3,"per_pack_credits":850},{"min_qty":6,"per_pack_credits":825},
           {"min_qty":9,"per_pack_credits":800},{"min_qty":12,"per_pack_credits":775}]'::jsonb
$$;

create function create_product(p_set text, p_booster_type text, p_name text, p_ladder jsonb, p_actor uuid)
returns uuid language plpgsql as $$
declare id uuid;
begin
  if not exists (select 1 from mtg_sets where code = upper(p_set)) then raise exception 'unknown_set'; end if;
  insert into products (set_code, booster_type, name, active)
  values (upper(p_set), p_booster_type, coalesce(nullif(trim(p_name), ''),
          (select name from mtg_sets where code = upper(p_set)) || ' ' || initcap(p_booster_type) || ' Booster'), false)
  returning products.id into id;
  insert into product_stock (product_id) values (id);
  perform set_price_ladder(id, coalesce(p_ladder, default_price_ladder()));
  perform log_custody(null, 'product_created', jsonb_build_object('product_id', id, 'set_code', upper(p_set), 'booster_type', p_booster_type), p_actor);
  return id;
end $$;

create function set_product_active(p_product uuid, p_active boolean, p_actor uuid) returns void language plpgsql as $$
begin
  if p_active and not exists (select 1 from price_tiers where product_id = p_product and min_qty = 1) then
    raise exception 'ladder_must_start_at_one';
  end if;
  update products set active = p_active where id = p_product;
  if not found then raise exception 'unknown_product'; end if;
  perform log_custody(null, case when p_active then 'product_activated' else 'product_deactivated' end,
                      jsonb_build_object('product_id', p_product), p_actor);
end $$;
