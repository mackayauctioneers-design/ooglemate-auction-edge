/**
 * OogleVal-inside-Carbitrage franchise wholesale preview.
 * EXAMPLE DATA ONLY. Nothing here calls Ooglecars, a buyer, a feed or a database.
 * Figures are illustrative and follow the 20 Nov 2026 floor rule:
 * floor = exact plate year only (same model and badge, km up to +15k, cheapest genuine
 * dealer ad excluding government charges, fresh ads, at least 2 fresh cars, else live search).
 * The cheapest year-below ad is a reference line only, never the floor.
 */

export interface ExampleCar {
  rego: string;
  state: string;
  year: number;
  make: string;
  model: string;
  badge: string;
  body: string;
  colour: string;
  transmission: string;
  vinMasked: string;
  odometerKm: number;
  notes: string;
}

export interface ExampleAd {
  year: number;
  title: string;
  km: number;
  priceExGov: number;
  state: string;
  source: string;
  ageDays: number;
}

export const tradeIn: ExampleCar = {
  rego: "EXA21P",
  state: "NSW",
  year: 2021,
  make: "Toyota",
  model: "RAV4",
  badge: "GX Hybrid 2WD",
  body: "Wagon",
  colour: "Glacier White",
  transmission: "CVT auto",
  vinMasked: "JTM•••••••••1234",
  odometerKm: 58400,
  notes: "Service books, two keys, small chip in windscreen.",
};

export const kmCap = tradeIn.odometerKm + 15000;

export const floorCar: ExampleAd = {
  year: 2021,
  title: "2021 Toyota RAV4 GX Hybrid 2WD",
  km: 66900,
  priceExGov: 35200,
  state: "QLD",
  source: "Dealer site",
  ageDays: 1,
};

export const floorKmAdjusted = 35600;

export const nextComparables: ExampleAd[] = [
  { year: 2021, title: "2021 Toyota RAV4 GX Hybrid 2WD", km: 61300, priceExGov: 35990, state: "NSW", source: "Dealer site", ageDays: 2 },
  { year: 2021, title: "2021 Toyota RAV4 GX Hybrid 2WD", km: 70100, priceExGov: 36450, state: "VIC", source: "Feed", ageDays: 4 },
  { year: 2021, title: "2021 Toyota RAV4 GX Hybrid 2WD", km: 52000, priceExGov: 37480, state: "NSW", source: "Dealer site", ageDays: 1 },
  { year: 2021, title: "2021 Toyota RAV4 GX Hybrid 2WD", km: 72800, priceExGov: 37990, state: "QLD", source: "Feed", ageDays: 6 },
];

export const yearBelowReference: ExampleAd = {
  year: 2020,
  title: "2020 Toyota RAV4 GX Hybrid 2WD",
  km: 63800,
  priceExGov: 32990,
  state: "NSW",
  source: "Dealer site",
  ageDays: 2,
};

export const thinkingBuy = 30600;
export const cautiousBuy = 29600;

export interface Buyer {
  id: string;
  name: string;
  note: string;
}

/** The four approved buyers. All four see franchise cars by default. */
export const approvedBuyers: Buyer[] = [
  { id: "macka", name: "Macka", note: "Approved buyer" },
  { id: "alex", name: "Alex", note: "Approved buyer" },
  { id: "griefy", name: "Griefy", note: "Approved buyer" },
  { id: "cam", name: "Cam", note: "Approved buyer" },
];

export interface BuyerPrice {
  buyerId: string;
  price: number | null;
  at: string | null;
  note: string | null;
}

export const prices: BuyerPrice[] = [
  { buyerId: "macka", price: 30500, at: "9:42am", note: "Can collect Monday." },
  { buyerId: "alex", price: 30200, at: "9:18am", note: null },
  { buyerId: "cam", price: 29900, at: "10:05am", note: "Subject to windscreen." },
  { buyerId: "griefy", price: null, at: null, note: null },
];

export const heldCar = {
  rego: "EXA16H",
  state: "NSW",
  title: "2016 Holden Captiva LTZ AWD",
  odometerKm: 141200,
  freshExactYearAds: 1,
};

export const dealerContact = {
  business: "Patrick Auto",
  person: "Sam Example (used car manager)",
  phone: "0400 000 000",
  email: "sam@patrickauto.example",
  address: "1 Example St, Example NSW 2000",
};

export const buyerContact = {
  business: "Mackay Traders",
  person: "Macka",
  phone: "0400 000 001",
  email: "buyer@example.invalid",
  address: "Example yard address, NSW",
};

export interface DealerUpdate {
  at: string;
  rego: string;
  car: string;
  status: "held" | "waiting" | "prices" | "picked" | "handover";
  text: string;
}

export const dealerUpdates: DealerUpdate[] = [
  { at: "10:06am", rego: "EXA21P", car: "2021 Toyota RAV4 GX Hybrid 2WD", status: "prices", text: "3 prices in. Best is $30,500. Griefy hasn't priced yet. Pick one whenever you're ready." },
  { at: "9:31am", rego: "EXA16H", car: "2016 Holden Captiva LTZ AWD", status: "held", text: "Held, no floor yet. Only 1 fresh 2016 ad matches, and we need 2. A live search is running. We'll send it as soon as it has a floor." },
  { at: "9:02am", rego: "EXA21P", car: "2021 Toyota RAV4 GX Hybrid 2WD", status: "waiting", text: "Sent to 4 buyers with the Carbitrage guide. Waiting for prices." },
  { at: "Yesterday 3:40pm", rego: "EXA19C", car: "2019 Mazda CX-5 Maxx Sport", status: "handover", text: "You picked Alex at $24,800. You both have each other's details to arrange pickup and payment." },
  { at: "Yesterday 11:15am", rego: "EXA20T", car: "2020 Toyota Corolla Ascent Sport", status: "picked", text: "4 prices in. You picked Cam at $19,900." },
];
