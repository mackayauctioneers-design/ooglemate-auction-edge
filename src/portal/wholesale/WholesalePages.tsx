import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { km } from "../format";
import {
  approvedBuyers,
  buyerContact,
  buyerPriceHistory,
  cautiousBuy,
  dealerContact,
  dealerUpdates,
  floorCar,
  floorKmAdjusted,
  heldCar,
  kmCap,
  nextComparables,
  prices,
  thinkingBuy,
  tradeIn,
  yearBelowReference,
  type BuyerPriceHistoryRow,
  type DealerUpdate,
  type PriceOutcome,
} from "./exampleData";

/*
 * Preview-only screens for franchise dealers sending a trade-in to Ooglecars wholesalers
 * from Carbitrage. Example data only: no button here calls a server, a buyer or a feed.
 * Design: black and white. Colour only for status (green picked, amber open/held,
 * blue franchise label) and the green floor accent.
 */

function aud(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

const GREEN = "#117A3A";
const AMBER = "#B7791F";
const BLUE = "#1F4FD8";

const STEPS = [
  { to: "/portal/wholesale/start", label: "1 Rego" },
  { to: "/portal/wholesale/guide", label: "2 Guide" },
  { to: "/portal/wholesale/send", label: "3 Send" },
  { to: "/portal/wholesale/held", label: "3b Held" },
  { to: "/portal/wholesale/compare", label: "4 Prices" },
  { to: "/portal/wholesale/handover", label: "5 Handover" },
  { to: "/portal/wholesale/updates", label: "6 Updates" },
  { to: "/portal/buyer-view", label: "7 Buyer" },
  { to: "/portal/buyer-prices", label: "8 My prices" },
];

const carTitle = `${tradeIn.year} ${tradeIn.make} ${tradeIn.model} ${tradeIn.badge}`;

/* ---------- building blocks ---------- */

function Frame({ title, sub, children, testId, wide = false }: { title: string; sub?: string; children: ReactNode; testId: string; wide?: boolean }) {
  return (
    <div data-testid={testId} className={`mx-auto ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
      <div className="mb-10 flex items-center gap-3 overflow-x-auto whitespace-nowrap text-[11px] text-neutral-400">
        <span className="uppercase tracking-wide">Preview · example data</span>
        <span aria-hidden="true">|</span>
        <nav aria-label="Preview steps" className="flex gap-3">
          {STEPS.map((step) => (
            <NavLink key={step.to} to={step.to} className={({ isActive }) => (isActive ? "text-neutral-950 underline underline-offset-4" : "hover:text-neutral-700")}>
              {step.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {sub ? <p className="mt-1 text-sm text-neutral-500">{sub}</p> : null}
      <div className="mt-8 space-y-6">{children}</div>
    </div>
  );
}

function Section({ title, children, accent, testId }: { title?: string; children: ReactNode; accent?: string; testId?: string }) {
  return (
    <section data-testid={testId} className="border border-neutral-200 p-6" style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}>
      {title ? <h2 className="mb-4 text-sm font-medium text-neutral-500">{title}</h2> : null}
      {children}
    </section>
  );
}

function Primary({ children, to, disabled = false, testId }: { children: ReactNode; to?: string; disabled?: boolean; testId?: string }) {
  const cls = "inline-flex min-h-12 w-full items-center justify-center px-6 text-sm font-medium sm:w-auto";
  if (disabled) return <button type="button" disabled className={`${cls} cursor-not-allowed bg-neutral-200 text-neutral-500`}>{children}</button>;
  return to
    ? <Link to={to} data-testid={testId} className={`${cls} bg-neutral-950 text-white hover:bg-neutral-800`}>{children}</Link>
    : <button type="button" data-testid={testId} className={`${cls} bg-neutral-950 text-white hover:bg-neutral-800`}>{children}</button>;
}

function Quiet({ children, to, onClick }: { children: ReactNode; to?: string; onClick?: () => void }) {
  const cls = "text-sm text-neutral-500 underline underline-offset-4 hover:text-neutral-950";
  return to ? <Link to={to} className={cls}>{children}</Link> : <button type="button" onClick={onClick} className={cls}>{children}</button>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center gap-4 pt-2 sm:flex-row">{children}</div>;
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

function Status({ color, children }: { color: string; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color }}><Dot color={color} />{children}</span>;
}

function Franchise() {
  return <span className="inline-flex shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" style={{ background: BLUE }}>Franchise car</span>;
}

function HowWeGotThis({ children }: { children: ReactNode }) {
  return (
    <details className="group text-xs text-neutral-500" data-testid="how-we-got-this">
      <summary className="cursor-pointer list-none underline underline-offset-4 hover:text-neutral-950">How we got this</summary>
      <div className="mt-3 space-y-1.5 leading-relaxed">{children}</div>
    </details>
  );
}

function Input({ label, value, readOnly = true, mono = false, onChange }: { label: string; value: string; readOnly?: boolean; mono?: boolean; onChange?: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-500">{label}</span>
      <input
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`mt-1 block min-h-12 w-full border border-neutral-300 px-3 text-base focus:border-neutral-950 focus:outline-none ${mono ? "font-mono uppercase" : ""}`}
      />
    </label>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="7" width="10" height="7" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

const credit = <p className="text-xs text-neutral-400">Valuations by Carbitrage</p>;

/* ---------- 1. Rego and odometer ---------- */

export function WholesaleStartPage() {
  return (
    <Frame testId="wholesale-start" title="Value a trade-in">
      <Section>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Input label="Rego" value={tradeIn.rego} mono />
          <Input label="State" value={tradeIn.state} />
        </div>
        <div className="mt-3"><Quiet>Or take photos instead</Quiet></div>
      </Section>
      <Section testId="found-car">
        <p className="text-lg font-semibold">{carTitle}</p>
        <p className="mt-1 text-sm text-neutral-500">{tradeIn.body} · {tradeIn.colour} · {tradeIn.transmission}</p>
        <div className="mt-6 max-w-xs">
          <Input label="Odometer (km)" value="58,400" />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked readOnly className="h-4 w-4 accent-neutral-950" />
          I've checked the odometer on the car
        </label>
      </Section>
      <Actions>
        <Primary to="/portal/wholesale/guide">Get the guide</Primary>
      </Actions>
    </Frame>
  );
}

/* ---------- 2. Carbitrage guide ---------- */

export function GuideBlock({ forBuyer = false }: { forBuyer?: boolean }) {
  const [more, setMore] = useState(false);
  const comps = more ? nextComparables : nextComparables.slice(0, 3);
  return (
    <div className="space-y-6" data-testid="guide-block">
      <Section accent={GREEN} testId="floor">
        <p className="text-sm text-neutral-500">Floor</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{aud(floorCar.priceExGov)}</p>
        <p className="mt-2 text-sm text-neutral-500">{floorCar.title} · {km(floorCar.km)} · {floorCar.state}</p>
      </Section>
      <div className="grid grid-cols-2 gap-6">
        <Section>
          <p className="text-sm text-neutral-500">Thinking</p>
          <p className="mt-1 text-2xl font-semibold">{aud(thinkingBuy)}</p>
        </Section>
        <Section>
          <p className="text-sm text-neutral-500">Cautious buy</p>
          <p className="mt-1 text-2xl font-semibold">{aud(cautiousBuy)}</p>
        </Section>
      </div>
      <Section title="Similar cars">
        <ul className="divide-y divide-neutral-100 text-sm" data-testid="comps">
          {comps.map((ad) => (
            <li key={`${ad.km}-${ad.priceExGov}`} className="grid grid-cols-[1fr_auto_auto] gap-4 py-2.5">
              <span className="text-neutral-500">{km(ad.km)}</span>
              <span className="w-10 text-neutral-500">{ad.state}</span>
              <span className="w-20 text-right font-medium">{aud(ad.priceExGov)}</span>
            </li>
          ))}
        </ul>
        {nextComparables.length > 3 ? (
          <div className="mt-3"><Quiet onClick={() => setMore((m) => !m)}>{more ? "Show less" : "Show more"}</Quiet></div>
        ) : null}
        <p className="mt-4 text-xs text-neutral-400" data-testid="year-below-reference">
          {yearBelowReference.year} cheapest {aud(yearBelowReference.priceExGov)} · reference only, not the floor
        </p>
      </Section>
      <div className="flex items-center justify-between gap-4">
        <HowWeGotThis>
          <p>The floor is the cheapest genuine dealer ad for the same model and badge, plate year {tradeIn.year} only, up to {km(kmCap)} ({km(tradeIn.odometerKm)} + 15,000 km), before government charges.</p>
          <p>Ads must be fresh: dealer sites within 2 days, feeds within 7. We need at least 2 fresh cars, or we run a live search.</p>
          <p>Cautious buy is adjusted for km from the floor car (km-adjusted floor {aud(floorKmAdjusted)}).</p>
          <p>The year-below price is shown for reference only. It's never the floor.</p>
          {forBuyer ? null : <p>Prices are all {tradeIn.year} {tradeIn.make} {tradeIn.model} {tradeIn.badge}, excluding government charges.</p>}
        </HowWeGotThis>
        {credit}
      </div>
    </div>
  );
}

export function WholesaleGuidePage() {
  return (
    <Frame testId="wholesale-guide" title={carTitle} sub={`${km(tradeIn.odometerKm)} · ${tradeIn.state}`}>
      <GuideBlock />
      <Actions>
        <Primary to="/portal/wholesale/send">Send to wholesalers</Primary>
      </Actions>
    </Frame>
  );
}

/* ---------- 3. Send to wholesalers ---------- */

export function WholesaleSendPage() {
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [picked, setPicked] = useState<string[]>(["macka", "cam"]);
  const count = mode === "all" ? approvedBuyers.length : picked.length;
  return (
    <Frame testId="wholesale-send" title="Send to wholesalers" sub={`${carTitle} · floor ${aud(floorCar.priceExGov)}`}>
      <Section title="Who gets it">
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-3">
            <input type="radio" name="mode" checked={mode === "all"} onChange={() => setMode("all")} className="h-4 w-4 accent-neutral-950" data-testid="mode-all" />
            All 4 buyers <span className="text-neutral-400">{approvedBuyers.map((b) => b.name).join(", ")}</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="mode" checked={mode === "pick"} onChange={() => setMode("pick")} className="h-4 w-4 accent-neutral-950" data-testid="mode-pick" />
            Choose buyers
          </label>
        </div>
        {mode === "pick" ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4 text-sm" data-testid="buyer-picker">
            {approvedBuyers.map((buyer) => (
              <label key={buyer.id} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-neutral-950"
                  checked={picked.includes(buyer.id)}
                  onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, buyer.id] : prev.filter((id) => id !== buyer.id)))}
                />
                {buyer.name}
              </label>
            ))}
          </div>
        ) : null}
      </Section>
      <Section title="Note for buyers (optional)">
        <textarea readOnly rows={2} value={tradeIn.notes} className="block w-full border border-neutral-300 p-3 text-sm" data-testid="buyer-note" />
        <p className="mt-2 text-xs text-neutral-400" data-testid="buyer-note-hint">Buyers see this note. Don't include your name or number.</p>
      </Section>
      <Actions>
        <Primary to="/portal/wholesale/compare">Send to {count} buyer{count === 1 ? "" : "s"}</Primary>
        <span className="text-xs text-neutral-400">No fee. No countdown.</span>
      </Actions>
    </Frame>
  );
}

/* ---------- 3b. Held, no floor ---------- */

export function WholesaleHeldPage() {
  const [kmValue, setKmValue] = useState("141,200");
  return (
    <Frame testId="wholesale-held" title={heldCar.title} sub={`${km(heldCar.odometerKm)} · ${heldCar.state}`}>
      <Section accent={AMBER}>
        <Status color={AMBER}>Held, no floor yet</Status>
        <p className="mt-3 text-sm">We found {heldCar.freshExactYearAds} fresh 2016 ad and need 2. A live search is running and usually takes a few minutes. It won't go to buyers without a floor.</p>
      </Section>
      <Section title="Check the details" testId="held-edit">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Odometer (km)" value={kmValue} readOnly={false} onChange={setKmValue} />
          <label className="block">
            <span className="text-xs text-neutral-500">Badge</span>
            <select defaultValue="LTZ AWD" className="mt-1 block min-h-12 w-full border border-neutral-300 bg-white px-3 text-base">
              <option>LTZ AWD</option>
              <option>LX AWD</option>
              <option>LS 2WD</option>
              <option>Active 2WD</option>
            </select>
          </label>
        </div>
      </Section>
      <Actions>
        <Primary>Re-check</Primary>
        <span className="text-xs text-neutral-400">We'll let you know when it's ready.</span>
      </Actions>
    </Frame>
  );
}

/* ---------- 4. Compare prices ---------- */

export function WholesaleComparePage() {
  const priced = prices.filter((p) => p.price != null).sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  const waiting = prices.filter((p) => p.price == null);
  const [pick, setPick] = useState<string>(priced[0]?.buyerId ?? "");
  const chosen = prices.find((p) => p.buyerId === pick);
  const chosenName = approvedBuyers.find((b) => b.id === pick)?.name ?? "";
  return (
    <Frame testId="wholesale-compare" title={`${priced.length} prices in`} sub={`${carTitle} · floor ${aud(floorCar.priceExGov)}`}>
      <Section>
        <ul className="divide-y divide-neutral-100">
          {priced.map((row) => {
            const name = approvedBuyers.find((b) => b.id === row.buyerId)?.name ?? "";
            return (
              <li key={row.buyerId}>
                <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-4 py-4">
                  <input type="radio" name="pick" checked={pick === row.buyerId} onChange={() => setPick(row.buyerId)} className="h-4 w-4 accent-neutral-950" />
                  <span className="text-sm">
                    {name}
                    {row.note ? <span className="block text-xs text-neutral-400">{row.note}</span> : null}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">{aud(row.price)}</span>
                </label>
              </li>
            );
          })}
          {waiting.map((row) => (
            <li key={row.buyerId} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4 text-sm text-neutral-400">
              <span className="h-4 w-4" />
              <span>{approvedBuyers.find((b) => b.id === row.buyerId)?.name}</span>
              <span>Waiting</span>
            </li>
          ))}
        </ul>
      </Section>
      <Actions>
        <Primary to="/portal/wholesale/handover">Accept {aud(chosen?.price ?? null)} from {chosenName}</Primary>
        <Quiet>Keep the car</Quiet>
      </Actions>
      <p className="text-center text-xs text-neutral-400 sm:text-left">No fee. No countdown. Take your time.</p>
    </Frame>
  );
}

/* ---------- 5. Handover ---------- */

function Contact({ title, c }: { title: string; c: { business: string; person: string; phone: string; email: string } }) {
  return (
    <Section title={title}>
      <p className="text-base font-semibold">{c.business}</p>
      <div className="mt-2 space-y-1 text-sm text-neutral-500">
        <p>{c.person}</p>
        <p>{c.phone}</p>
        <p>{c.email}</p>
      </div>
    </Section>
  );
}

export function WholesaleHandoverPage() {
  return (
    <Frame testId="wholesale-handover" title="Sold to Macka for $30,500" sub="You've both got each other's details. Sort out pickup and payment directly.">
      <div className="grid gap-6 sm:grid-cols-2">
        <Contact title="Buyer" c={buyerContact} />
        <Contact title="Your details (shared with the buyer)" c={dealerContact} />
      </div>
      <Actions>
        <Primary>Mark as collected</Primary>
        <Quiet>Report a problem</Quiet>
      </Actions>
    </Frame>
  );
}

/* ---------- 6. Status updates ---------- */

function updateColor(status: DealerUpdate["status"]): string {
  switch (status) {
    case "held": return AMBER;
    case "waiting":
    case "prices": return "#A3A3A3";
    case "picked":
    case "handover": return GREEN;
  }
}

export function WholesaleUpdatesPage() {
  return (
    <Frame testId="wholesale-updates" title="Updates">
      <ol className="relative border-l border-neutral-200 pl-6" data-testid="timeline">
        {dealerUpdates.map((u) => (
          <li key={`${u.at}-${u.rego}`} className="relative py-3 text-sm">
            <span className="absolute -left-[29px] top-[18px] block h-2.5 w-2.5 rounded-full" style={{ background: updateColor(u.status) }} />
            <span className="grid gap-1 sm:grid-cols-[8rem_12rem_1fr] sm:gap-4">
              <span className="text-xs text-neutral-400 sm:text-sm">{u.at}</span>
              <span className="font-medium">{u.car}</span>
              <span className="text-neutral-600">{u.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

/* ---------- 7. Buyer view ---------- */

function BuyerChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <p className="text-sm font-semibold">Buyer desk</p>
          <nav aria-label="Buyer" className="flex items-center gap-5 text-sm">
            <NavLink to="/portal/buyer-view" className={({ isActive }) => (isActive ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-950")}>Cars</NavLink>
            <NavLink to="/portal/buyer-prices" className={({ isActive }) => (isActive ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-950")} data-testid="link-my-prices">My prices</NavLink>
          </nav>
        </div>
      </header>
      <main className="px-4 py-8">{children}</main>
    </div>
  );
}

interface BuyerCar {
  id: string;
  title: string;
  short: string;
  km: number;
  state: string;
  franchise: boolean;
  note: string;
  myPrice: number | null;
  locked: boolean;
}

const buyerCars: BuyerCar[] = [
  { id: "rav4", title: carTitle, short: "2021 RAV4 GX Hybrid", km: tradeIn.odometerKm, state: tradeIn.state, franchise: true, note: tradeIn.notes, myPrice: null, locked: false },
  { id: "hilux", title: "2019 Toyota Hilux SR5 4x4", short: "2019 Hilux SR5", km: 162000, state: "QLD", franchise: false, note: "Tow bar, canopy.", myPrice: 24100, locked: false },
  { id: "cx5", title: "2019 Mazda CX-5 Maxx Sport", short: "2019 CX-5 Maxx Sport", km: 88300, state: "NSW", franchise: true, note: "One owner.", myPrice: 24800, locked: true },
];

export function WholesaleBuyerPage() {
  const [selected, setSelected] = useState("rav4");
  const car = buyerCars.find((c) => c.id === selected) ?? buyerCars[0];
  return (
    <BuyerChrome>
      <BuyerBody car={car} selected={selected} onSelect={setSelected} />
    </BuyerChrome>
  );
}

function BuyerBody({ car, selected, onSelect }: { car: BuyerCar; selected: string; onSelect: (id: string) => void }) {
  return (
    <Frame testId="wholesale-buyer" title="Cars to price" wide>
      <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
        <ul className="divide-y divide-neutral-100 border-y border-neutral-200 md:self-start" data-testid="buyer-car-list">
          {buyerCars.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                data-testid={`buyer-car-${c.id}`}
                className={`block w-full px-3 py-3 text-left ${selected === c.id ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">{c.short}{c.franchise ? <Franchise /> : null}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                  {c.locked ? <><LockIcon /> Locked · {aud(c.myPrice)}</> : c.myPrice ? `Your price ${aud(c.myPrice)}` : "Not priced"}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{car.title}</h2>
              {car.franchise ? <Franchise /> : null}
            </div>
            <p className="mt-1 text-sm text-neutral-500">{km(car.km)} · {car.franchise ? "Franchise dealer" : "Used car yard"}, {car.state}</p>
            <p className="mt-3 text-sm" data-testid="buyer-dealer-note">“{car.note}”</p>
          </div>
          {car.id === "rav4" ? <GuideBlock forBuyer /> : null}
          <Section title="Your price">
            {car.locked ? (
              <div data-testid="locked-price-box">
                <input disabled value={new Intl.NumberFormat("en-AU").format(car.myPrice ?? 0)} aria-label="Your price (locked)" className="block min-h-12 w-full max-w-xs cursor-not-allowed border border-neutral-200 bg-neutral-50 px-3 text-base text-neutral-400" />
                <p className="mt-3 flex items-center gap-1.5 text-sm font-medium"><LockIcon /> Price locked, dealer has picked a buyer</p>
              </div>
            ) : (
              <div data-testid="editable-price-box">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <input placeholder={car.myPrice ? new Intl.NumberFormat("en-AU").format(car.myPrice) : "e.g. 30,000"} aria-label="Your price" className="block min-h-12 w-full max-w-xs border border-neutral-300 px-3 text-base" />
                  <Primary>{car.myPrice ? "Update price" : "Send price"}</Primary>
                </div>
                <p className="mt-3 text-xs text-neutral-400">Private. You can change it until the dealer picks.</p>
              </div>
            )}
          </Section>
        </div>
      </div>
    </Frame>
  );
}

/* ---------- 8. My prices ---------- */

const SYDNEY = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function sydney(iso: string): string {
  return SYDNEY.format(new Date(iso)).replace(" am", "am").replace(" pm", "pm");
}

function sydneyDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const OUTCOME_LABEL: Record<PriceOutcome, string> = {
  open: "Open",
  picked: "Picked",
  not_picked: "Not picked",
  dealer_kept: "Dealer kept it",
};

function OutcomeText({ outcome }: { outcome: PriceOutcome }) {
  if (outcome === "picked") return <Status color={GREEN}>Picked</Status>;
  if (outcome === "open") return <Status color={AMBER}>Open</Status>;
  return <span className="text-xs text-neutral-500">{OUTCOME_LABEL[outcome]}</span>;
}

function HistoryRow({ row }: { row: BuyerPriceHistoryRow }) {
  const [editing, setEditing] = useState(false);
  const latest = row.events[row.events.length - 1];
  const earlier = row.events.slice(0, -1).reverse();
  const locked = row.outcome !== "open";
  return (
    <li className="grid gap-3 py-5 sm:grid-cols-[1fr_12rem_7rem_12rem] sm:items-start sm:gap-6" data-testid="price-history-row">
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {row.year} {row.make} {row.model} {row.badge}
          {row.franchise ? <Franchise /> : null}
        </div>
        <p className="mt-1 text-xs text-neutral-400">{km(row.km)} · {row.sellerLabel}</p>
      </div>
      <div>
        <p className="text-xl font-semibold tabular-nums">{aud(latest.amount)}</p>
        <p className="text-xs text-neutral-400">{sydney(latest.at)}</p>
        {earlier.length ? (
          <ul className="mt-1 space-y-0.5 text-xs text-neutral-400" data-testid="price-trail">
            {earlier.map((e) => (
              <li key={e.at} className="whitespace-nowrap">was <span className="line-through">{aud(e.amount)}</span> · {sydney(e.at)}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <div><OutcomeText outcome={row.outcome} /></div>
      <div className="text-xs">
        {locked ? (
          <span className="flex items-start gap-1.5 text-neutral-500" data-testid="locked-price-box">
            <LockIcon /> {row.outcome === "dealer_kept" ? "Price locked, dealer kept the car" : "Price locked, dealer has picked a buyer"}
          </span>
        ) : editing ? (
          <span className="flex gap-2" data-testid="editable-price-box">
            <input defaultValue={new Intl.NumberFormat("en-AU").format(latest.amount)} aria-label="New price" className="min-h-9 w-24 border border-neutral-300 px-2 text-sm" />
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 bg-neutral-950 px-3 text-white">Save</button>
          </span>
        ) : (
          <span data-testid="editable-price-box"><Quiet onClick={() => setEditing(true)}>Change price</Quiet></span>
        )}
      </div>
    </li>
  );
}

export function BuyerPriceHistoryPage() {
  const [from, setFrom] = useState("2026-11-17");
  const [to, setTo] = useState("2026-11-20");
  const [outcome, setOutcome] = useState<"all" | PriceOutcome>("all");
  const rows = useMemo(() => buyerPriceHistory.filter((row) => {
    const first = sydneyDay(row.events[0].at);
    const last = sydneyDay(row.events[row.events.length - 1].at);
    if (from && last < from) return false;
    if (to && first > to) return false;
    if (outcome !== "all" && row.outcome !== outcome) return false;
    return true;
  }), [from, to, outcome]);
  const field = "mt-1 block min-h-10 w-full border border-neutral-300 bg-white px-2 text-sm";
  return (
    <BuyerChrome>
      <Frame testId="buyer-price-history" title="My prices" sub="Every price you've given, in Sydney time. Only you can see this." wide>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[10rem_10rem_12rem]" data-testid="price-history-filters">
          <label className="text-xs text-neutral-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
          <label className="text-xs text-neutral-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></label>
          <label className="col-span-2 text-xs text-neutral-500 sm:col-span-1">Outcome
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as "all" | PriceOutcome)} className={field} data-testid="outcome-filter">
              <option value="all">All</option>
              {(Object.keys(OUTCOME_LABEL) as PriceOutcome[]).map((k) => <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>)}
            </select>
          </label>
        </div>
        <ul className="divide-y divide-neutral-100 border-y border-neutral-200">
          {rows.map((row) => <HistoryRow key={row.ref} row={row} />)}
        </ul>
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-neutral-400">No prices match.</p> : null}
      </Frame>
    </BuyerChrome>
  );
}
