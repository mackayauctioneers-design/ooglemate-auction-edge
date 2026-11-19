import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { km } from "../format";

function aud(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}
import {
  approvedBuyers,
  buyerContact,
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
  type DealerUpdate,
  type ExampleAd,
} from "./exampleData";

/*
 * Preview-only screens for franchise dealers sending a trade-in to Ooglecars wholesalers
 * from Carbitrage. Example data only: no button here calls a server, a buyer or a feed.
 * Design: black and white, with small pops of colour (green = floor car / picked,
 * amber = held, blue = franchise label).
 */

const STEPS = [
  { to: "/portal/wholesale/start", label: "1 Rego & odometer" },
  { to: "/portal/wholesale/guide", label: "2 Carbitrage guide" },
  { to: "/portal/wholesale/send", label: "3 Send to wholesalers" },
  { to: "/portal/wholesale/held", label: "3b Held, no floor" },
  { to: "/portal/wholesale/compare", label: "4 Compare prices" },
  { to: "/portal/wholesale/handover", label: "5 Handover" },
  { to: "/portal/wholesale/updates", label: "6 Status updates" },
  { to: "/portal/buyer-view", label: "7 Buyer view" },
];

const carTitle = `${tradeIn.year} ${tradeIn.make} ${tradeIn.model} ${tradeIn.badge}`;

function Frame({ title, lede, children, testId }: { title: string; lede?: string; children: ReactNode; testId: string }) {
  return (
    <div data-testid={testId}>
      <p className="mb-3 inline-flex border border-neutral-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
        Preview · example data only · nothing is sent
      </p>
      <nav aria-label="Wholesale steps" className="mb-5 flex flex-wrap gap-1 border-b border-neutral-200 pb-3">
        {STEPS.map((step) => (
          <NavLink
            key={step.to}
            to={step.to}
            className={({ isActive }) =>
              `px-2.5 py-1.5 text-xs ${isActive ? "bg-neutral-950 text-white" : "border border-neutral-200 text-neutral-700 hover:bg-neutral-100"}`
            }
          >
            {step.label}
          </NavLink>
        ))}
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {lede ? <p className="mt-1 max-w-3xl text-sm text-neutral-600">{lede}</p> : null}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Card({ title, right, children, className = "" }: { title?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-neutral-950 p-4 ${className}`}>
      {title || right ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-xs font-semibold uppercase tracking-wide">{title}</h2> : <span />}
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function Primary({ children, to }: { children: ReactNode; to?: string }) {
  const cls = "inline-flex min-h-11 items-center bg-neutral-950 px-4 text-sm font-medium text-white hover:bg-neutral-800";
  return to ? <Link to={to} className={cls}>{children}</Link> : <button type="button" className={cls}>{children}</button>;
}

function Secondary({ children, to }: { children: ReactNode; to?: string }) {
  const cls = "inline-flex min-h-11 items-center border border-neutral-950 px-4 text-sm font-medium hover:bg-neutral-100";
  return to ? <Link to={to} className={cls}>{children}</Link> : <button type="button" className={cls}>{children}</button>;
}

function Pill({ tone, children }: { tone: "green" | "amber" | "blue" | "plain"; children: ReactNode }) {
  const tones = {
    green: "bg-[#117A3A] text-white",
    amber: "bg-[#F2A900] text-neutral-950",
    blue: "bg-[#1F4FD8] text-white",
    plain: "border border-neutral-950 text-neutral-950",
  } as const;
  return <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

function PhotoBox({ label }: { label: string }) {
  return (
    <div className="flex aspect-[4/3] items-center justify-center border border-neutral-300 bg-neutral-100 text-center text-xs text-neutral-500">
      {label}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="font-medium">{value}</p>
      {hint ? <p className="text-[11px] text-neutral-500">{hint}</p> : null}
    </div>
  );
}

const credit = <p className="mt-3 text-[11px] uppercase tracking-wide text-neutral-500">Valuations by Carbitrage</p>;

/* 1. Rego / photos entry and odometer confirm */
export function WholesaleStartPage() {
  return (
    <Frame testId="wholesale-start" title="Value a trade-in" lede="Type the rego or take photos. We fill in the car, you confirm the odometer, and the Carbitrage guide comes next.">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Rego">
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="text-xs text-neutral-500">Rego</span>
              <input readOnly value={tradeIn.rego} className="mt-1 block min-h-11 w-full border border-neutral-950 px-3 font-mono text-lg uppercase" />
            </label>
            <label className="w-28">
              <span className="text-xs text-neutral-500">State</span>
              <input readOnly value={tradeIn.state} className="mt-1 block min-h-11 w-full border border-neutral-950 px-3 text-lg" />
            </label>
          </div>
          <p className="my-4 text-center text-xs uppercase tracking-wide text-neutral-500">or</p>
          <p className="mb-2 text-sm font-medium">Take photos (compliance plate, odometer, four corners)</p>
          <div className="grid grid-cols-4 gap-2">
            <PhotoBox label="Front ¾ (example)" />
            <PhotoBox label="Rear ¾ (example)" />
            <PhotoBox label="Odometer (example)" />
            <PhotoBox label="+ Add photo" />
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">Real photos only. No edited or AI-changed pictures.</p>
        </Card>
        <Card title="We found this car" right={<Pill tone="green">Rego matched</Pill>}>
          <h2 className="text-xl font-semibold">{carTitle}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Field label="Body" value={tradeIn.body} />
            <Field label="Colour" value={tradeIn.colour} />
            <Field label="Transmission" value={tradeIn.transmission} />
            <Field label="VIN" value={tradeIn.vinMasked} />
            <Field label="Plate year" value={String(tradeIn.year)} hint="The floor uses this exact year." />
            <Field label="Rego state" value={tradeIn.state} />
          </div>
          <div className="mt-4 border-t border-neutral-200 pt-4">
            <label className="block">
              <span className="text-sm font-medium">Odometer, as shown on the dash</span>
              <div className="mt-1 flex items-center gap-2">
                <input readOnly value="58,400" className="block min-h-11 w-40 border border-neutral-950 px-3 text-lg" />
                <span className="text-sm text-neutral-600">km</span>
              </div>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" checked readOnly className="mt-1 h-4 w-4 accent-neutral-950" />
              <span>I've checked the odometer on the car. It reads {km(tradeIn.odometerKm)}.</span>
            </label>
            <div className="mt-4"><Primary to="/portal/wholesale/guide">Get the Carbitrage guide</Primary></div>
          </div>
        </Card>
      </div>
    </Frame>
  );
}

function AdRow({ ad, tag }: { ad: ExampleAd; tag?: ReactNode }) {
  return (
    <tr className="border-t border-neutral-200">
      <td className="py-2 pr-3">{ad.title}{tag ? <span className="ml-2">{tag}</span> : null}</td>
      <td className="py-2 pr-3 whitespace-nowrap">{km(ad.km)}</td>
      <td className="py-2 pr-3">{ad.state}</td>
      <td className="py-2 pr-3 text-neutral-500 whitespace-nowrap">{ad.source} · {ad.ageDays === 1 ? "1 day old" : `${ad.ageDays} days old`}</td>
      <td className="py-2 text-right font-medium whitespace-nowrap">{aud(ad.priceExGov)}</td>
    </tr>
  );
}

export function GuideBlock({ forBuyer = false }: { forBuyer?: boolean }) {
  return (
    <Card title="Carbitrage guide" right={<Pill tone="plain">5 fresh {floorCar.year} cars</Pill>}>
      <div className="border-l-4 border-[#117A3A] pl-3">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Floor car</p>
        <p className="text-lg font-semibold">{floorCar.title} · {km(floorCar.km)} · {floorCar.state}</p>
        <p className="text-sm">
          <span className="text-2xl font-semibold">{aud(floorCar.priceExGov)}</span> ex government charges · km-adjusted {aud(floorKmAdjusted)}
          {" "}· <a href="#" onClick={(e) => e.preventDefault()} className="underline">listing (example)</a>
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          Cheapest genuine dealer ad, same model and badge, plate year {tradeIn.year} only, up to {km(kmCap)} ({km(tradeIn.odometerKm)} + 15,000 km).
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="border border-neutral-950 p-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Thinking</p>
          <p className="text-2xl font-semibold">{aud(thinkingBuy)}</p>
        </div>
        <div className="border border-neutral-950 p-3">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Cautious buy</p>
          <p className="text-2xl font-semibold">{aud(cautiousBuy)}</p>
          <p className="text-[11px] text-neutral-500">km-adjusted from the floor car</p>
        </div>
      </div>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide">Next comparable cars</h3>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {nextComparables.map((ad) => <AdRow key={`${ad.km}-${ad.priceExGov}`} ad={ad} />)}
        </tbody>
      </table>
      <div className="mt-4 border border-dashed border-neutral-400 bg-neutral-50 p-3 text-sm" data-testid="year-below-reference">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-600">Reference only · not the floor</p>
        <p className="mt-1">
          Cheapest {yearBelowReference.year} (year below): {yearBelowReference.title} · {km(yearBelowReference.km)} · {yearBelowReference.state} · <span className="font-medium">{aud(yearBelowReference.priceExGov)}</span> ex government charges
        </p>
      </div>
      {forBuyer ? null : (
        <p className="mt-3 text-xs text-neutral-500">Ads are fresh: dealer sites within 2 days, feeds within 7 days. With fewer than 2 fresh {tradeIn.year} cars we run a live search, and the car waits.</p>
      )}
      {credit}
    </Card>
  );
}

/* 2. Carbitrage guide */
export function WholesaleGuidePage() {
  return (
    <Frame testId="wholesale-guide" title={carTitle} lede={`${km(tradeIn.odometerKm)} · ${tradeIn.colour} · ${tradeIn.state} · rego ${tradeIn.rego}`}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
        <GuideBlock />
        <div className="space-y-4">
          <Card title="What this means">
            <p className="text-sm">The floor is what the cheapest dealer is asking for the same {tradeIn.year} car today, before government charges. Buyers price below it so they can recondition and resell.</p>
            <p className="mt-2 text-sm">The 2020 line is there so you can see the next step down. It isn't used as the floor.</p>
          </Card>
          <Primary to="/portal/wholesale/send">Send to wholesalers</Primary>
        </div>
      </div>
    </Frame>
  );
}

/* 3. Send to wholesalers */
export function WholesaleSendPage() {
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [picked, setPicked] = useState<string[]>(["macka", "cam"]);
  const chosen = mode === "all" ? approvedBuyers.map((b) => b.id) : picked;
  return (
    <Frame testId="wholesale-send" title="Send to wholesalers" lede="Each buyer sends you one private price. You see them all and pick one, or just use them as a trade figure. No fee, no countdown.">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Who gets this car">
          <div className="space-y-2" role="radiogroup" aria-label="Buyers">
            <label className={`flex cursor-pointer items-start gap-3 border p-3 ${mode === "all" ? "border-neutral-950 bg-neutral-50" : "border-neutral-200"}`}>
              <input type="radio" name="mode" checked={mode === "all"} onChange={() => setMode("all")} className="mt-1 accent-neutral-950" data-testid="mode-all" />
              <span><span className="font-medium">All four approved buyers</span> <span className="text-xs text-neutral-500">(default)</span>
                <span className="block text-sm text-neutral-600">{approvedBuyers.map((b) => b.name).join(", ")}</span></span>
            </label>
            <label className={`flex cursor-pointer items-start gap-3 border p-3 ${mode === "pick" ? "border-neutral-950 bg-neutral-50" : "border-neutral-200"}`}>
              <input type="radio" name="mode" checked={mode === "pick"} onChange={() => setMode("pick")} className="mt-1 accent-neutral-950" data-testid="mode-pick" />
              <span><span className="font-medium">Pick specific buyers</span>
                <span className="block text-sm text-neutral-600">Only the buyers you tick see the car.</span></span>
            </label>
          </div>
          {mode === "pick" ? (
            <ul className="mt-3 divide-y divide-neutral-200 border border-neutral-200" data-testid="buyer-picker">
              {approvedBuyers.map((buyer) => (
                <li key={buyer.id}>
                  <label className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-neutral-950"
                      checked={picked.includes(buyer.id)}
                      onChange={(e) => setPicked((prev) => e.target.checked ? [...prev, buyer.id] : prev.filter((id) => id !== buyer.id))}
                    />
                    <span className="flex h-8 w-8 items-center justify-center bg-neutral-950 text-xs font-semibold text-white">{buyer.name.slice(0, 2).toUpperCase()}</span>
                    <span><span className="font-medium">{buyer.name}</span> <span className="text-xs text-neutral-500">{buyer.note}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-neutral-500">Buyers see the car, the Carbitrage guide and your state ({tradeIn.state}). They never see your dealership's name or number until you pick one of them.</p>
        </Card>
        <div className="space-y-4">
          <Card title="Ready to send" right={<Pill tone="green">Has a floor</Pill>}>
            <p className="font-semibold">{carTitle}</p>
            <p className="text-sm text-neutral-600">{km(tradeIn.odometerKm)} · {tradeIn.state}</p>
            <p className="mt-2 text-sm">Floor {aud(floorCar.priceExGov)} ex government charges · thinking {aud(thinkingBuy)} · cautious {aud(cautiousBuy)}</p>
            <p className="mt-1 text-xs text-neutral-500">Reference: cheapest 2020 {aud(yearBelowReference.priceExGov)} (not the floor)</p>
            <div className="mt-4 flex items-center gap-3">
              <Primary to="/portal/wholesale/compare">Send to {chosen.length} buyer{chosen.length === 1 ? "" : "s"}</Primary>
              <span className="text-xs text-neutral-500">Preview: nothing is sent.</span>
            </div>
          </Card>
          <Card title="Your note to buyers (optional)">
            <p className="border border-neutral-200 p-2 text-sm">{tradeIn.notes}</p>
          </Card>
        </div>
      </div>
    </Frame>
  );
}

/* 3b. Held, no floor */
export function WholesaleHeldPage() {
  return (
    <Frame testId="wholesale-held" title="Held, no floor yet" lede="A car never goes to buyers without a floor. Here's what's happening with this one.">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={heldCar.title} right={<Pill tone="amber">Held</Pill>} className="border-l-8 border-l-[#F2A900]">
          <p className="text-sm text-neutral-600">{km(heldCar.odometerKm)} · {heldCar.state} · rego {heldCar.rego}</p>
          <h3 className="mt-4 font-semibold">Why it's held</h3>
          <p className="mt-1 text-sm">We found only {heldCar.freshExactYearAds} fresh 2016 Captiva LTZ AWD ad within the km range, and we need at least 2 to set a floor. Older or year-below ads don't count toward the floor.</p>
          <h3 className="mt-4 font-semibold">What we're doing</h3>
          <p className="mt-1 text-sm">A live search for 2016 Captiva LTZ AWD ads is running. This usually takes a few minutes. When it finds a floor, the car goes to your buyers and we tell you. If it doesn't, we'll tell you that too, and the car stays with you.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" disabled className="inline-flex min-h-11 cursor-not-allowed items-center bg-neutral-300 px-4 text-sm font-medium text-neutral-600">Send to wholesalers (needs a floor)</button>
            <Secondary>Check the km and badge</Secondary>
          </div>
        </Card>
        <Card title="Checking the details helps">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Wrong badge or year is the most common reason a floor isn't found.</li>
            <li>If the odometer was mistyped, the km range will be off.</li>
            <li>You'll get a plain update when anything changes. Nothing goes out blank.</li>
          </ul>
          {credit}
        </Card>
      </div>
    </Frame>
  );
}

/* 4. Compare prices */
export function WholesaleComparePage() {
  const [pick, setPick] = useState<string | null>("macka");
  const priced = prices.filter((p) => p.price != null).sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  const waiting = prices.filter((p) => p.price == null);
  const best = priced[0]?.price ?? null;
  return (
    <Frame testId="wholesale-compare" title="Compare prices" lede={`${carTitle} · ${km(tradeIn.odometerKm)}. Each buyer sent one private price. Buyers never see each other's prices. Take your time: there's no countdown and no fee.`}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <Card title={`${priced.length} prices in`} right={<Pill tone="plain">No fee · no countdown</Pill>}>
          <ul className="divide-y divide-neutral-200">
            {priced.map((row) => {
              const buyer = approvedBuyers.find((b) => b.id === row.buyerId)!;
              const selected = pick === row.buyerId;
              return (
                <li key={row.buyerId}>
                  <label className={`flex cursor-pointer items-center gap-3 px-2 py-3 ${selected ? "bg-neutral-50 outline outline-2 outline-[#117A3A]" : ""}`}>
                    <input type="radio" name="pick" checked={selected} onChange={() => setPick(row.buyerId)} className="accent-[#117A3A]" />
                    <span className="flex h-9 w-9 items-center justify-center bg-neutral-950 text-xs font-semibold text-white">{buyer.name.slice(0, 2).toUpperCase()}</span>
                    <span className="flex-1">
                      <span className="font-medium">{buyer.name}</span>
                      {row.price === best ? <span className="ml-2"><Pill tone="green">Highest</Pill></span> : null}
                      <span className="block text-xs text-neutral-500">Priced at {row.at}{row.note ? ` · "${row.note}"` : ""}</span>
                    </span>
                    <span className="text-xl font-semibold">{aud(row.price)}</span>
                  </label>
                </li>
              );
            })}
            {waiting.map((row) => {
              const buyer = approvedBuyers.find((b) => b.id === row.buyerId)!;
              return (
                <li key={row.buyerId} className="flex items-center gap-3 px-2 py-3 text-neutral-500">
                  <span className="w-4" />
                  <span className="flex h-9 w-9 items-center justify-center border border-neutral-300 text-xs font-semibold">{buyer.name.slice(0, 2).toUpperCase()}</span>
                  <span className="flex-1">{buyer.name} <span className="block text-xs">Hasn't priced yet</span></span>
                  <span>—</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="Against the guide">
            <p className="text-sm">Floor {aud(floorCar.priceExGov)} ex government charges</p>
            <p className="text-sm">Thinking {aud(thinkingBuy)} · Cautious {aud(cautiousBuy)}</p>
            <p className="mt-1 text-xs text-neutral-500">Reference: cheapest 2020 {aud(yearBelowReference.priceExGov)} (not the floor)</p>
            {credit}
          </Card>
          <Card title="Your choice">
            <p className="text-sm">{pick ? `Accept ${approvedBuyers.find((b) => b.id === pick)?.name}'s price of ${aud(prices.find((p) => p.buyerId === pick)?.price ?? null)}?` : "Pick a price, or keep the car."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Primary to="/portal/wholesale/handover">Accept this price</Primary>
              <Secondary>Keep the car</Secondary>
            </div>
            <p className="mt-2 text-xs text-neutral-500">Only the buyer you pick gets your details. The others are told the car has gone.</p>
          </Card>
        </div>
      </div>
    </Frame>
  );
}

function ContactCard({ title, c }: { title: string; c: { business: string; person: string; phone: string; email: string; address: string } }) {
  return (
    <Card title={title}>
      <p className="text-lg font-semibold">{c.business}</p>
      <div className="mt-2 grid gap-2 text-sm">
        <Field label="Contact" value={c.person} />
        <Field label="Phone" value={c.phone} />
        <Field label="Email" value={c.email} />
        <Field label="Address" value={c.address} />
      </div>
    </Card>
  );
}

/* 5. Handover */
export function WholesaleHandoverPage() {
  return (
    <Frame testId="wholesale-handover" title="Sold to Macka for $30,500" lede={`${carTitle} · ${km(tradeIn.odometerKm)} · rego ${tradeIn.rego}. You both now have each other's details. Sort out pickup and payment directly.`}>
      <div className="mb-4"><Pill tone="green">Price accepted</Pill></div>
      <div className="grid gap-5 lg:grid-cols-3">
        <ContactCard title="Your buyer" c={buyerContact} />
        <ContactCard title="What the buyer sees about you" c={dealerContact} />
        <Card title="Next steps">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Buyer calls you to arrange pickup.</li>
            <li>Agree payment (usually before the car leaves).</li>
            <li>Hand over keys, books and the rego papers.</li>
            <li>Tap "Car collected" so the buyer list stays tidy.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Primary>Car collected</Primary>
            <Secondary>Problem with this sale</Secondary>
          </div>
          <p className="mt-2 text-xs text-neutral-500">No fee to you. Carbitrage isn't part of the payment.</p>
        </Card>
      </div>
    </Frame>
  );
}

function statusPill(status: DealerUpdate["status"]) {
  switch (status) {
    case "held": return <Pill tone="amber">Held</Pill>;
    case "waiting": return <Pill tone="plain">Waiting</Pill>;
    case "prices": return <Pill tone="plain">Prices in</Pill>;
    case "picked": return <Pill tone="green">Picked</Pill>;
    case "handover": return <Pill tone="green">Handover</Pill>;
  }
}

/* 6. Plain dealer status updates */
export function WholesaleUpdatesPage() {
  return (
    <Frame testId="wholesale-updates" title="Your wholesale cars" lede="Plain updates on every car you've sent. Newest first.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <Card title="Updates">
          <ul className="divide-y divide-neutral-200">
            {dealerUpdates.map((u) => (
              <li key={`${u.at}-${u.rego}`} className="flex gap-3 py-3">
                <div className="w-24 shrink-0 text-xs text-neutral-500">{u.at}</div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{u.car}</span>
                    <span className="font-mono text-xs text-neutral-500">{u.rego}</span>
                    {statusPill(u.status)}
                  </div>
                  <p className="mt-1 text-sm">{u.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4">
          <Card title="Text message preview">
            <div className="max-w-xs bg-neutral-100 p-3 text-sm">Carbitrage: 2021 RAV4 GX Hybrid (EXA21P). 3 prices in, best $30,500. Open Carbitrage to pick one. No rush, no fee.</div>
            <div className="mt-2 max-w-xs bg-neutral-100 p-3 text-sm">Carbitrage: 2016 Captiva LTZ (EXA16H) is held, no floor yet. We need 2 fresh 2016 ads and found 1. Live search running. We'll update you.</div>
            <p className="mt-2 text-[11px] text-neutral-500">Example wording only. No texts are sent from the preview.</p>
          </Card>
        </div>
      </div>
    </Frame>
  );
}

/* 7. Buyer-side view */
export function WholesaleBuyerPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <header className="bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Ooglecars wholesale · Buyer desk</p>
            <p className="text-xs text-neutral-300">Signed in as an approved buyer (example: Alex)</p>
          </div>
          <Link to="/portal/wholesale/updates" className="text-xs text-neutral-300 underline-offset-2 hover:underline">Back to dealer preview</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <BuyerBody />
      </main>
    </div>
  );
}

function BuyerBody() {
  return (
    <Frame testId="wholesale-buyer" title="Buyer desk · franchise car" lede="What an approved buyer (for example Alex) sees. Your price is private. Other buyers never see it, and you never see theirs.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,1.55fr)]">
        <Card title="New cars">
          <div className="border-l-4 border-neutral-950 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">2021 Toyota RAV4</span><Pill tone="blue">Franchise car</Pill></div>
            <p className="text-sm">{km(tradeIn.odometerKm)} · {tradeIn.state} · not priced</p>
          </div>
          <div className="mt-2 p-3 text-sm text-neutral-500">2019 Toyota Hilux SR5 · 162,000 km · QLD · priced $24,100</div>
        </Card>
        <div className="space-y-4">
          <Card title="The car" right={<Pill tone="blue">Franchise car</Pill>}>
            <h2 className="text-xl font-semibold">{carTitle}</h2>
            <p className="text-sm text-neutral-600">{km(tradeIn.odometerKm)} · {tradeIn.colour} · {tradeIn.transmission}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Field label="Seller" value={`Franchise dealer, ${tradeIn.state}`} hint="Dealer name and number are shared only if you're picked." />
              <Field label="Dealer's note" value={tradeIn.notes} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <PhotoBox label="Front ¾ (example)" />
              <PhotoBox label="Rear ¾ (example)" />
              <PhotoBox label="Odometer (example)" />
            </div>
          </Card>
          <GuideBlock forBuyer />
          <Card title="Your private price">
            <div className="flex flex-wrap items-end gap-2">
              <label>
                <span className="text-xs text-neutral-500">Price ($)</span>
                <input readOnly placeholder="e.g. 30000" className="mt-1 block min-h-11 w-44 border border-neutral-950 px-3" />
              </label>
              <Primary>Send price</Primary>
              <Secondary>Quick price {aud(cautiousBuy)}</Secondary>
            </div>
            <p className="mt-2 text-xs text-neutral-500">One price per car. No countdown. The dealer sees every price and picks one.</p>
          </Card>
        </div>
      </div>
    </Frame>
  );
}
