// Generates small fixtures in MTGJSON v5 shape. Run: node test/make-fixtures.mjs
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const meta = { date: "2026-09-27", version: "5.2.2+20260927" };
const card = (o) => ({ availability: ["paper", "mtgo"], finishes: ["nonfoil", "foil"], legalities: { standard: "Legal", commander: "Legal" }, ...o });
const tst = {
  code: "TST", name: "Test Set", releaseDate: "2026-08-01", isOnlineOnly: false,
  cards: [
    card({ uuid: "u-bolt", name: "Lightning Bolt", number: "1", setCode: "TST", rarity: "common", type: "Instant", manaCost: "{R}",
           text: "Lightning Bolt deals 3 damage to any target.", identifiers: { scryfallId: "sf-bolt", tcgplayerProductId: "1001" } }),
    card({ uuid: "u-dragon", name: "Shivan Dragon", number: "2", setCode: "TST", rarity: "mythic", type: "Creature — Dragon",
           legalities: { commander: "Legal", legacy: "Banned" }, identifiers: { scryfallId: "sf-dragon", tcgPlayerId: 1002 } }),
    card({ uuid: "u-dfc-a", name: "Delver of Secrets // Insectile Aberration", side: "a", number: "3", setCode: "TST", rarity: "uncommon" }),
    card({ uuid: "u-dfc-b", name: "Delver of Secrets // Insectile Aberration", side: "b", number: "3", setCode: "TST", rarity: "uncommon" }),
    card({ uuid: "u-serial", name: "Sheoldred", number: "4z", setCode: "TST", rarity: "mythic", promoTypes: ["serialized"], finishes: ["foil"] }),
    card({ uuid: "u-etched", name: "Sol Ring", number: "5", setCode: "TST", rarity: "uncommon", finishes: ["nonfoil", "etched", "signed"] }),
    card({ uuid: "u-online", name: "Digital Thing", number: "6", setCode: "TST", rarity: "rare", isOnlineOnly: true }),
    card({ uuid: "u-mtgo", name: "MTGO Only", number: "7", setCode: "TST", rarity: "rare", availability: ["mtgo"] }),
    card({ uuid: "u-odd", name: "Odd Rarity", number: "8", setCode: "TST", rarity: "timeshifted" }),
  ],
  tokens: [{ uuid: "u-token", name: "Goblin", number: "T1" }],
};
const digital = { code: "YTS", name: "Alchemy Test", isOnlineOnly: true, cards: [card({ uuid: "u-alch", name: "A", number: "1", setCode: "YTS", rarity: "rare" })] };

writeFileSync("test/fixtures/TST.json", JSON.stringify({ meta, data: tst }));
writeFileSync("test/fixtures/AllPrintings.json.gz", gzipSync(JSON.stringify({ meta, data: { TST: tst, YTS: digital } })));

const retail = (o) => ({ currency: "USD", retail: o });
const prices = {
  "u-bolt": { paper: { tcgplayer: retail({ normal: { "2026-09-25": 1.1, "2026-09-27": 1.25 }, foil: { "2026-09-27": 4.5 } }),
                       cardmarket: { currency: "EUR", retail: { normal: { "2026-09-27": 0.9 } } } } },
  "u-dragon": { paper: { cardkingdom: retail({ normal: { "2026-09-27": 24.99 } }) } },
  "u-etched": { paper: { tcgplayer: retail({ normal: { "2026-09-27": 2 }, etched: { "2026-09-27": 12.34 } }) } },
  "u-dfc-a": { paper: { tcgplayer: { currency: "USD", buylist: { normal: { "2026-09-27": 0.5 } } } } },
  "u-missing": { paper: { tcgplayer: retail({ normal: { "2026-09-27": 99 } }) } },
  "u-online": { mtgo: { cardhoarder: { currency: "TIX", retail: { normal: { "2026-09-27": 1 } } } } },
};
writeFileSync("test/fixtures/AllPricesToday.json.gz", gzipSync(JSON.stringify({ meta, data: prices })));
const older = { "u-bolt": { paper: { tcgplayer: retail({ normal: { "2026-09-20": 0.75 } }) } } };
writeFileSync("test/fixtures/AllPricesOlder.json", JSON.stringify({ meta, data: older }));
