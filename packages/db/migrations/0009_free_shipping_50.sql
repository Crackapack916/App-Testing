-- Free shipping threshold set to $50 of vaulted card value per shipment.
alter table system_config alter column free_ship_min_value_cents set default 5000;
update system_config set free_ship_min_value_cents = 5000;
