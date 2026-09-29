/**
 * The cards picked in the Vault on their way to the shipping checkout (/ship). Kept in memory
 * only: a reload of the checkout sends the customer back to pick again.
 */
export type ShipItem = { key: string; card_id: string; individual_card_id: string | null; finish: string; condition: string; qty: number;
  name: string; set_code: string; set_name: string; collector_number: string; rarity: string; image_url: string | null; market_cents: number | null };
export type ShipCart = { items: ShipItem[]; shipping: { free_min: number; fee: number }; shipped: boolean };

let cart: ShipCart | null = null;
export const setShipCart = (c: ShipCart | null) => { cart = c; };
export const getShipCart = () => cart;
