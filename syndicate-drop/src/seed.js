// Loaded once, on the very first run, so the program starts with a watchlist
// and release calendar instead of an empty screen. Researched 11 Nov 2026;
// entries without a url are calendar-only (reminders and the daily brief).
export const SEED_ITEMS = [
  { name: 'Delta Reign Sleeved Booster Pack', kind: 'OTHER', releaseDate: '2026-11-06', maxPrice: 8.5,
    url: 'https://www.target.com.au/p/pre-order-pokemon-tcg-mega-evolution-delta-reign-sleeved-booster-pack-assorted/73493143' },
  { name: 'Delta Reign Elite Trainer Box', kind: 'ETB', releaseDate: '2026-11-06', maxPrice: 110,
    url: 'https://www.bigw.com.au/product/delta-reign-elite-trainer-box-pokemon-tcg/p/9904768138' },
  { name: 'Delta Reign Build & Battle Box (EB Games, $49)', kind: 'OTHER', releaseDate: '2026-11-20', url: null },
  { name: "Valentine's Box (not yet confirmed)", kind: 'COLLECTION', releaseDate: '2027-01-15', url: null },
  { name: 'Flowing Fists prerelease events start', kind: 'OTHER', releaseDate: '2027-01-23', url: null },
  { name: 'Flowing Fists (ME07): ETB, booster box, bundles', kind: 'BOOSTER_BOX', releaseDate: '2027-02-05', url: null },
];
