import type pg from "pg";
import { mapPrices, mapSet, type CardRow, type MtgjsonSet, type PriceFormats, type PriceRow } from "./mtgjson";

const CARD_BATCH = 2000;
const PRICE_BATCH = 5000;

export type ImportStats = { sets: number; cards: number; prices: number; skippedSets: number };

/** Loads MTGJSON data through the import_* database functions, in batches. */
export class Importer {
  stats: ImportStats = { sets: 0, cards: 0, prices: 0, skippedSets: 0 };
  private cards: CardRow[] = [];
  private prices: PriceRow[] = [];

  constructor(private pool: pg.Pool, private log: (msg: string) => void = () => {}) {}

  async addSet(set: MtgjsonSet) {
    const mapped = mapSet(set);
    if (!mapped || !mapped.cards.length) { this.stats.skippedSets++; return; }
    await this.pool.query("select import_sets($1)", [JSON.stringify([mapped.set])]);
    this.stats.sets++;
    for (const c of mapped.cards) {
      this.cards.push(c);
      if (this.cards.length >= CARD_BATCH) await this.flushCards();
    }
  }

  async addPrices(uuid: string, formats: PriceFormats) {
    for (const r of mapPrices(uuid, formats)) {
      this.prices.push(r);
      if (this.prices.length >= PRICE_BATCH) await this.flushPrices();
    }
  }

  async flushCards() {
    if (!this.cards.length) return;
    const { rows } = await this.pool.query("select import_cards($1) as n", [JSON.stringify(this.cards)]);
    this.stats.cards += rows[0].n;
    this.cards = [];
    this.log(`cards ${this.stats.cards}`);
  }

  async flushPrices() {
    if (!this.prices.length) return;
    const { rows } = await this.pool.query("select import_prices($1) as n", [JSON.stringify(this.prices)]);
    this.stats.prices += rows[0].n;
    this.prices = [];
    this.log(`prices ${this.stats.prices}`);
  }

  async finish() {
    await this.flushCards();
    await this.flushPrices();
    return this.stats;
  }
}
