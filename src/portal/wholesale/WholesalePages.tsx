import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { km } from "../format";
import { portalApi } from "../api";
import { signOutEverywhere } from "./auth";
import { RoleRefusal, Wordmark } from "./WholesaleSignIn";
import {
  useLoad,
  wholesaleApi,
  WholesaleApiError,
  type Buyer,
  type CarParams,
  type Info,
  type BuyerCar,
  type Guide,
  type GuideReply,
  type HistoryRow,
  type PriceOutcome,
  type RequestView,
  type DealerUpdate,
  type BuyerAlert,
} from "./api";

/*
 * Franchise wholesale screens, wired to the preview wholesale API (local test database that mirrors the real
 * wholesale_tenders / wholesale_bids fields). Nothing here contacts a buyer. Publishing needs Macka's own go.
 * Design: black and white, one black button per screen. Colour only for status (green picked, amber open/held,
 * blue franchise label) and the green floor accent.
 */

function aud(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}
const cents = (c: number | null) => (c == null ? null : c / 100);

const GREEN = "#117A3A";
const AMBER = "#B7791F";
const BLUE = "#1F4FD8";

const STEPS = [
  { to: "/portal/wholesale/start", label: "New car" },
  { to: "/portal/wholesale/compare", label: "Prices" },
  { to: "/portal/wholesale/updates", label: "Updates" },
  { to: "/portal/buyer-view", label: "Buyer view" },
  { to: "/portal/buyer-prices", label: "Buyer: my prices" },
];

/* ---------- building blocks ---------- */

/** Says what the page is, never where a guide's figures came from: that is printed under each guide, per car. */
function PreviewLabel() {
  return <span className="uppercase tracking-wide" data-testid="preview-label">Preview · test dealer, test database, nothing is sent</span>;
}

function useMode(): "preview" | "live" | null {
  const info = useLoad(() => wholesaleApi.info().catch(() => null), []);
  return info.data?.mode ?? null;
}

/** True when this build runs the real test sign-in: the old step bar and "Preview as" picker are gone. */
let testSignInCache: Promise<boolean> | null = null;
function useTestSignIn(): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => {
    testSignInCache ??= portalApi.health().then((h) => Boolean(h.testSignIn)).catch(() => false);
    void testSignInCache.then(setV);
  }, []);
  return v;
}

function TestEnvironmentLabel() {
  return <span className="uppercase tracking-wide" data-testid="preview-label">Test environment · test data · nothing is sent</span>;
}

function Frame({ title, sub, children, testId, wide = false }: { title: string; sub?: string; children: ReactNode; testId: string; wide?: boolean }) {
  const mode = useMode();
  const testSignIn = useTestSignIn();
  return (
    <div data-testid={testId} className={`mx-auto ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
      {testSignIn === null || mode === "live" ? <div className="mb-8" /> : testSignIn ? <div className="mb-8 text-[11px] text-neutral-400"><TestEnvironmentLabel /></div> : <div className="mb-10 flex items-center gap-3 overflow-x-auto whitespace-nowrap text-[11px] text-neutral-400">
        <PreviewLabel />
        <span aria-hidden="true">|</span>
        <nav aria-label="Preview steps" className="flex gap-3">
          {STEPS.map((step) => (
            <NavLink key={step.to} to={step.to} className={({ isActive }) => (isActive ? "text-neutral-950 underline underline-offset-4" : "hover:text-neutral-700")}>
              {step.label}
            </NavLink>
          ))}
        </nav>
      </div>}
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

function Primary({ children, to, disabled = false, testId, onClick }: { children: ReactNode; to?: string; disabled?: boolean; testId?: string; onClick?: () => void }) {
  const cls = "inline-flex min-h-12 w-full items-center justify-center px-6 text-sm font-medium sm:w-auto";
  if (disabled) return <button type="button" disabled data-testid={testId} className={`${cls} cursor-not-allowed bg-neutral-200 text-neutral-500`}>{children}</button>;
  return to
    ? <Link to={to} data-testid={testId} className={`${cls} bg-neutral-950 text-white hover:bg-neutral-800`}>{children}</Link>
    : <button type="button" data-testid={testId} onClick={onClick} className={`${cls} bg-neutral-950 text-white hover:bg-neutral-800`}>{children}</button>;
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

function ViewAd({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="view-ad"
      className="inline-flex min-h-8 items-center whitespace-nowrap text-xs text-neutral-400 underline underline-offset-4 hover:text-neutral-950"
    >
      View ad
    </a>
  );
}

const SOURCE_NOTE: Record<string, string> = {
  market_api: "live Carbitrage engine",
  recorded_fixture: "recorded engine run, not live",
  sample_fixture: "sample figures, not from the live engine",
};
function Credit({ source }: { source?: string }) {
  const note = source ? SOURCE_NOTE[source] : undefined;
  return <p className="text-xs text-neutral-400" data-testid="guide-source">Valuations by Carbitrage{note ? ` · ${note}` : ""}</p>;
}


function carTitleOf(c: { year: number; make: string; model: string; badge: string }): string {
  return `${c.year} ${c.make} ${c.model} ${c.badge}`;
}

function Refusal({ need }: { need: "dealer" | "buyer" }) {
  const navigate = useNavigate();
  const me = useLoad(() => wholesaleApi.me().catch(() => null), []);
  if (me.loading) return null;
  return <RoleRefusal need={need} who={me.data} onSignOut={() => { void signOutEverywhere().then(() => navigate("/portal/login")); }} />;
}

function LoadState<T>({ state, children }: { state: { data: T | null; error: WholesaleApiError | null; loading: boolean }; children: (data: T) => ReactNode }) {
  const location = useLocation();
  if (state.error?.status === 401) return <Navigate to={`/portal/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (state.error?.code === "not_a_dealer") return <Refusal need="dealer" />;
  if (state.error?.code === "not_a_buyer") return <Refusal need="buyer" />;
  if (state.error) return <p className="text-sm text-neutral-500" data-testid="load-error">{state.error.message}</p>;
  if (!state.data) return <p className="text-sm text-neutral-400">Loading…</p>;
  return <>{children(state.data)}</>;
}

function useCarParams(): CarParams & { ready: boolean } {
  const [params] = useSearchParams();
  const rego = (params.get("rego") ?? "").toUpperCase();
  const kmValue = Number(params.get("km") ?? "");
  const badge = params.get("badge") ?? "";
  const year = params.get("year") ?? "";
  const make = params.get("make") ?? "";
  const model = params.get("model") ?? "";
  const state = params.get("state") ?? "";
  const typed = Boolean(year && make && model && state);
  return { rego, km: Number.isFinite(kmValue) ? kmValue : NaN, badge, year, make, model, state, ready: (Boolean(rego) || typed) && Number.isFinite(kmValue) && params.get("km") !== null };
}

function carQuery(p: Partial<CarParams> & { km: number }): string {
  const q = new URLSearchParams({ km: String(p.km) });
  for (const k of ["rego", "badge", "year", "make", "model", "state"] as const) if (p[k]) q.set(k, p[k] as string);
  return q.toString();
}

/* ---------- 1. Rego and odometer ---------- */

/** Live: no rego lookup is connected yet, so the dealer types the car. The odometer still has to be confirmed. */
function ManualStart() {
  const navigate = useNavigate();
  const [f, setF] = useState({ rego: "", year: "", make: "", model: "", badge: "", state: "", odo: "" });
  const [checked, setChecked] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const kmValue = Number(f.odo.replace(/[^0-9]/g, ""));
  const ready = Boolean(f.year && f.make && f.model && f.badge && f.state && kmValue && checked);
  return (
    <Frame testId="wholesale-start" title="Value a trade-in">
      <Section testId="manual-car">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Rego (optional)" value={f.rego} readOnly={false} mono onChange={(v) => set("rego")(v.toUpperCase())} />
          <Input label="State" value={f.state} readOnly={false} onChange={(v) => set("state")(v.toUpperCase().slice(0, 3))} />
          <Input label="Year" value={f.year} readOnly={false} onChange={(v) => set("year")(v.replace(/[^0-9]/g, "").slice(0, 4))} />
          <Input label="Make" value={f.make} readOnly={false} onChange={set("make")} />
          <Input label="Model" value={f.model} readOnly={false} onChange={set("model")} />
          <Input label="Badge" value={f.badge} readOnly={false} onChange={set("badge")} />
        </div>
        <div className="mt-6 max-w-xs"><Input label="Odometer (km)" value={f.odo} readOnly={false} onChange={set("odo")} /></div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-neutral-950" data-testid="odo-checked" />
          I've checked the odometer on the car
        </label>
      </Section>
      <Actions>
        <Primary testId="get-guide" disabled={!ready} onClick={() => navigate(`/portal/wholesale/guide?${carQuery({ rego: f.rego, year: f.year, make: f.make, model: f.model, badge: f.badge, state: f.state, km: kmValue })}`)}>
          Get the guide
        </Primary>
      </Actions>
    </Frame>
  );
}

export function WholesaleStartPage() {
  const info = useLoad(() => wholesaleApi.info(), []);
  if (info.data?.manualEntry) return <ManualStart />;
  return <PreviewStart info={info} />;
}

function PreviewStart({ info }: { info: ReturnType<typeof useLoad<Info>> }) {
  const navigate = useNavigate();
  const [rego, setRego] = useState("");
  const [odo, setOdo] = useState("");
  const [checked, setChecked] = useState(false);
  const [car, setCar] = useState<Awaited<ReturnType<typeof wholesaleApi.lookup>>["car"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rego && info.data?.testCars[0]) setRego(info.data.testCars[0].rego);
  }, [info.data, rego]);

  useEffect(() => {
    let live = true;
    if (rego.trim().length < 5) { setCar(null); return; }
    wholesaleApi.lookup(rego.trim()).then((r) => {
      if (!live) return;
      setCar(r.car); setError(null); setOdo(new Intl.NumberFormat("en-AU").format(r.car.odometerKm ?? 0));
    }).catch((e: unknown) => { if (live) { setCar(null); setError(e instanceof Error ? e.message : "Not found"); } });
    return () => { live = false; };
  }, [rego]);

  const kmValue = Number(odo.replace(/[^0-9]/g, ""));
  return (
    <Frame testId="wholesale-start" title="Value a trade-in">
      <Section>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <Input label="Rego" value={rego} readOnly={false} mono onChange={(v) => setRego(v.toUpperCase())} />
          <Input label="State" value={car?.state ?? ""} />
        </div>
        {info.data ? (
          <p className="mt-3 text-xs text-neutral-400" data-testid="test-rego-hint">
            Test cars: {info.data.testCars.map((c) => c.rego).join(", ")}
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-neutral-500">{error}</p> : null}
      </Section>
      {car ? (
        <Section testId="found-car">
          <p className="text-lg font-semibold">{carTitleOf(car)}</p>
          <p className="mt-1 text-sm text-neutral-500">{[car.body, car.colour, car.transmission].filter(Boolean).join(" · ")}</p>
          <div className="mt-6 max-w-xs">
            <Input label="Odometer (km)" value={odo} readOnly={false} onChange={setOdo} />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-neutral-950" data-testid="odo-checked" />
            I've checked the odometer on the car
          </label>
        </Section>
      ) : null}
      <Actions>
        <Primary
          testId="get-guide"
          disabled={!car || !checked || !kmValue}
          onClick={() => car && navigate(`/portal/wholesale/guide?${carQuery({ rego: car.rego, km: kmValue })}`)}
        >
          Get the guide
        </Primary>
      </Actions>
    </Frame>
  );
}

/* ---------- 2. Carbitrage guide ---------- */

export function GuideBlock({ guide, car, forBuyer = false }: { guide: Guide; car: { year: number; make: string; model: string; badge: string; km: number }; forBuyer?: boolean }) {
  const [more, setMore] = useState(false);
  const comps = more ? guide.comps : guide.comps.slice(0, 3);
  const floor = guide.floor_car;
  const kmCap = car.km + 15000;
  return (
    <div className="space-y-6" data-testid="guide-block">
      <Section accent={GREEN} testId="floor">
        <p className="text-sm text-neutral-500">Floor</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">{aud(guide.floor_dollars)}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-neutral-500"><span>{floor.title} · {km(floor.km)}{floor.state ? ` · ${floor.state}` : ""}</span><ViewAd url={floor.link ?? undefined} /></p>
        {guide.provisional ? <p className="mt-2 text-xs" style={{ color: AMBER }}>Provisional, not enough evidence yet.</p> : null}
        {guide.floor_basis_note ? <p className="mt-2 text-xs" style={{ color: AMBER }} data-testid="floor-basis-note">{guide.floor_basis_note}</p> : null}
        {forBuyer ? null : <LiveCheck check={guide.live_check} />}
      </Section>
      <div className="grid grid-cols-2 gap-6">
        <Section>
          <p className="text-sm text-neutral-500">Thinking</p>
          <p className="mt-1 text-2xl font-semibold" data-testid="thinking">{aud(guide.thinking)}</p>
        </Section>
        <Section>
          <p className="text-sm text-neutral-500">Cautious buy</p>
          <p className="mt-1 text-2xl font-semibold" data-testid="cautious">{aud(guide.cautious)}</p>
        </Section>
      </div>
      <Section title="Similar cars">
        <ul className="divide-y divide-neutral-100 text-sm" data-testid="comps">
          {comps.map((ad) => (
            <li key={`${ad.link}-${ad.km}-${ad.price_ex_gov}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-1.5">
              <span className="text-neutral-500">{km(ad.km)}</span>
              <span className="w-10 text-neutral-500">{ad.state ?? ""}</span>
              <span className="w-20 text-right font-medium">{aud(ad.price_ex_gov)}</span>
              <ViewAd url={ad.link ?? undefined} />
            </li>
          ))}
        </ul>
        {guide.comps.length === 0 ? <p className="text-sm text-neutral-400">No other exact-year cars on top of the floor car.</p> : null}
        {guide.comps.length > 3 ? (
          <div className="mt-3"><Quiet onClick={() => setMore((m) => !m)}>{more ? "Show less" : "Show more"}</Quiet></div>
        ) : null}
        {forBuyer ? null : guide.outlier_ads.map((o) => (
          <p key={o.link ?? o.price_ex_gov} className="mt-3 flex items-center gap-2 text-xs text-neutral-500" data-testid="possible-buy">
            <Dot color="#0a0a0a" />
            <span className="flex-1">Possible buy: {o.year}, {km(o.km)}, {aud(o.price_ex_gov)}. Well under the rest, so not used as the floor. Check it.</span>
            <ViewAd url={o.link ?? undefined} />
          </p>
        ))}
        {guide.year_below ? (
          <p className="mt-1 flex items-center gap-3 text-xs text-neutral-400" data-testid="year-below-reference">
            <span className="flex-1">{guide.year_below.year} cheapest {aud(guide.year_below.price_ex_gov)} · {km(guide.year_below.km)} · reference only, not the floor</span>
            <ViewAd url={guide.year_below.link ?? undefined} />
          </p>
        ) : null}
      </Section>
      <div className="flex items-center justify-between gap-4">
        <HowWeGotThis>
          <p>The floor is the cheapest genuine dealer ad for the same model and badge on plate year {car.year}, up to {km(kmCap)} ({km(car.km)} + 15,000 km), before government charges. If there are fewer than 2 fresh cars on that year, the engine may use a neighbouring year and says so under the floor.</p>
          <p>Ads must be fresh: dealer sites within 2 days, feeds within 7. We need at least 2 fresh cars, or we run a live search.</p>
          <p>One cheap ad well under the rest doesn't set the floor on its own unless another ad backs it up. We show it to you as a possible buy instead.</p>
          {floor.km_adjusted_price ? <p>Cautious buy is adjusted for km from the floor car (km-adjusted floor {aud(floor.km_adjusted_price)}).</p> : null}
          <p>The year-below price is shown for reference only. It's never the floor.</p>
          {forBuyer ? null : <p>Prices are all {car.year} {car.make} {car.model} {car.badge}, excluding government charges.</p>}
        </HowWeGotThis>
        <Credit source={guide.source} />
      </div>
    </div>
  );
}

function LiveCheck({ check }: { check: Guide["live_check"] }) {
  if (!check) return null;
  if (check.state === "checking") {
    const mins = check.eta_seconds ? Math.max(1, Math.round(check.eta_seconds / 60)) : null;
    return (
      <p className="mt-2 flex items-center gap-2 text-xs" style={{ color: AMBER }} data-testid="live-checking">
        <Dot color={AMBER} />Checking Carsales live. These figures are from our own market data and may change{mins ? ` in about ${mins} min` : " shortly"}.
      </p>
    );
  }
  if (check.state === "gave_up") return <p className="mt-2 text-xs text-neutral-400" data-testid="live-gave-up">The live Carsales check did not finish. These figures are from our own market data.</p>;
  return <p className="mt-2 text-xs text-neutral-400" data-testid="live-done">Checked against live Carsales.</p>;
}

function useGuide() {
  const p = useCarParams();
  const state = useLoad<GuideReply | null>(() => (p.ready ? wholesaleApi.guide(p) : Promise.resolve(null)), [p.rego, p.km, p.badge, p.year, p.make, p.model, p.state, p.ready]);
  // While Carsales is being checked live, ask again after the engine's own wait (never faster than 20 s). The server decides
  // whether a call goes out, so this cannot burn the key's hourly limit.
  const check = state.data?.guide?.live_check;
  const wait = check?.state === "checking" ? (Math.max(check.poll_after_s, 20) + 1) * 1000 : null;
  const reload = state.reload;
  useEffect(() => {
    if (!wait) return;
    const id = setTimeout(reload, wait);
    return () => clearTimeout(id);
  }, [wait, reload, state.data]);
  return { p, state };
}

export function WholesaleGuidePage() {
  const { p, state } = useGuide();
  if (!p.ready) return <Navigate to="/portal/wholesale/start" replace />;
  if (state.data?.held) return <Navigate to={`/portal/wholesale/held?${carQuery(p)}`} replace />;
  return (
    <LoadState state={state}>
      {(g) => g && g.guide ? (
        <Frame testId="wholesale-guide" title={carTitleOf(g.car)} sub={`${km(g.car.km)} · ${g.car.state}`}>
          <GuideBlock guide={g.guide} car={g.car} />
          <Actions>
            <Primary to={`/portal/wholesale/send?${carQuery(p)}`} testId="to-send">Send to wholesalers</Primary>
          </Actions>
        </Frame>
      ) : null}
    </LoadState>
  );
}

/* ---------- 3. Send to wholesalers ---------- */

export function WholesaleSendPage() {
  const navigate = useNavigate();
  const { p, state } = useGuide();
  const buyers = useLoad(() => wholesaleApi.buyers(), []);
  const [mode, setMode] = useState<"all" | "pick">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!p.ready) return <Navigate to="/portal/wholesale/start" replace />;
  if (state.data?.held) return <Navigate to={`/portal/wholesale/held?${carQuery(p)}`} replace />;
  const list: Buyer[] = buyers.data?.buyers ?? [];
  const count = mode === "all" ? list.length : picked.length;
  const g = state.data;

  async function send() {
    if (!g) return;
    setBusy(true); setError(null);
    try {
      const out = await wholesaleApi.send({ ...p, badge: p.badge || undefined, buyerIds: mode === "all" ? "all" : picked, note: note ?? g.car.notes ?? "" });
      navigate(`/portal/wholesale/compare?code=${out.code}`);
    } catch (e) {
      if (e instanceof WholesaleApiError && e.code === "floor_held") navigate(`/portal/wholesale/held?${carQuery(p)}`);
      else setError(e instanceof Error ? e.message : "Could not send");
      setBusy(false);
    }
  }

  return (
    <LoadState state={state}>
      {(r) => r && r.guide ? (
        <Frame testId="wholesale-send" title="Send to wholesalers" sub={`${carTitleOf(r.car)} · floor ${aud(r.guide.floor_dollars)}`}>
          <Section title="Who gets it">
            <div className="space-y-3 text-sm">
              <label className="flex items-center gap-3">
                <input type="radio" name="mode" checked={mode === "all"} onChange={() => setMode("all")} className="h-4 w-4 accent-neutral-950" data-testid="mode-all" />
                All {list.length} buyers <span className="text-neutral-400">{list.map((b) => b.name).join(", ")}</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="radio" name="mode" checked={mode === "pick"} onChange={() => setMode("pick")} className="h-4 w-4 accent-neutral-950" data-testid="mode-pick" />
                Choose buyers
              </label>
            </div>
            {mode === "pick" ? (
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-4 text-sm" data-testid="buyer-picker">
                {list.map((buyer) => (
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
            <textarea rows={2} value={note ?? r.car.notes ?? ""} onChange={(e) => setNote(e.target.value)} className="block w-full border border-neutral-300 p-3 text-sm" data-testid="buyer-note" />
            <p className="mt-2 text-xs text-neutral-400" data-testid="buyer-note-hint">Buyers see this note and "Franchise dealer, {r.car.state}". Don't include your name or number.</p>
          </Section>
          {error ? <p className="text-sm text-neutral-600" data-testid="send-error">{error}</p> : null}
          {r.guide.live_check?.state === "checking" ? <div data-testid="send-waiting"><LiveCheck check={r.guide.live_check} /><p className="mt-1 text-xs text-neutral-500">This can go to buyers as soon as the live check finishes. The page updates by itself.</p></div> : null}
          <Actions>
            <Primary testId="send-button" disabled={busy || count === 0 || r.guide.live_check?.state === "checking"} onClick={() => void send()}>Send to {count} buyer{count === 1 ? "" : "s"}</Primary>
            <span className="text-xs text-neutral-400">No fee. No countdown.</span>
          </Actions>
        </Frame>
      ) : null}
    </LoadState>
  );
}

/* ---------- 3b. Held, no floor ---------- */

export function WholesaleHeldPage() {
  const navigate = useNavigate();
  const { p, state } = useGuide();
  const [kmValue, setKmValue] = useState<string | null>(null);
  const [badge, setBadge] = useState<string | null>(null);
  if (!p.ready) return <Navigate to="/portal/wholesale/start" replace />;
  if (state.data && !state.data.held) return <Navigate to={`/portal/wholesale/guide?${carQuery(p)}`} replace />;
  return (
    <LoadState state={state}>
      {(r) => r ? (
        <Frame testId="wholesale-held" title={carTitleOf({ ...r.car })} sub={`${km(r.car.km)} · ${r.car.state}`}>
          <Section accent={AMBER}>
            <Status color={AMBER}>Held, no floor yet</Status>
            <p className="mt-3 text-sm">
              {r.freshExactYearAds != null ? `We found ${r.freshExactYearAds} fresh ${r.car.year} ad and need 2. ` : ""}
              {r.reason ? `${r.reason} ` : ""}A live search usually takes a few minutes. It won't go to buyers without a floor.
            </p>
            {r.source === "sample_fixture" ? <p className="mt-2 text-xs text-neutral-400" data-testid="guide-source">Sample result, not from the live engine</p> : null}
          </Section>
          <Section title="Check the details" testId="held-edit">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Odometer (km)" value={kmValue ?? new Intl.NumberFormat("en-AU").format(r.car.km)} readOnly={false} onChange={setKmValue} />
              <Input label="Badge" value={badge ?? r.car.badge} readOnly={false} onChange={setBadge} />
            </div>
          </Section>
          <Actions>
            <Primary
              testId="recheck"
              onClick={() => {
                const next = Number((kmValue ?? String(r.car.km)).replace(/[^0-9]/g, "")) || r.car.km;
                const nextBadge = (badge ?? r.car.badge).trim();
                navigate(`/portal/wholesale/held?${carQuery({ ...p, km: next, badge: nextBadge === r.car.badge && !p.badge ? undefined : nextBadge })}`, { replace: true });
              }}
            >
              Re-check
            </Primary>
            <span className="text-xs text-neutral-400">Nothing was sent. We'll let you know when it's ready.</span>
          </Actions>
        </Frame>
      ) : null}
    </LoadState>
  );
}

/* ---------- 4. Compare prices ---------- */

function useRequest(code: string | null) {
  const latest = useLoad(() => (code ? Promise.resolve(null) : wholesaleApi.requests()), [code]);
  const resolved = code ?? latest.data?.requests.find((r) => r.status === "live" || r.status === "accepted")?.code ?? latest.data?.requests[0]?.code ?? null;
  const state = useLoad<RequestView | null>(() => (resolved ? wholesaleApi.request(resolved) : Promise.resolve(null)), [resolved]);
  const reload = state.reload;
  useEffect(() => {
    if (!resolved) return;
    const t = window.setInterval(reload, 4000);
    return () => window.clearInterval(t);
  }, [resolved, reload]);
  return { state, resolved, searching: !code && latest.loading };
}

export function WholesaleComparePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state, resolved, searching } = useRequest(params.get("code"));
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = state.data;
  const priced = r?.prices ?? [];
  const chosen = priced.find((x) => x.bidId === pick) ?? priced[0];

  if (r && r.status === "accepted") return <Navigate to={`/portal/wholesale/handover?code=${r.code}`} replace />;
  if (!resolved && !searching) {
    return <Frame testId="wholesale-compare" title="No cars out to buyers"><Actions><Primary to="/portal/wholesale/start">Value a trade-in</Primary></Actions></Frame>;
  }

  async function accept() {
    if (!r || !chosen) return;
    setBusy(true); setError(null);
    try { await wholesaleApi.pick(r.code, chosen.bidId); navigate(`/portal/wholesale/handover?code=${r.code}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not pick"); setBusy(false); }
  }
  async function keep() {
    if (!r) return;
    await wholesaleApi.keep(r.code).catch(() => undefined);
    navigate("/portal/wholesale/updates");
  }

  return (
    <LoadState state={state}>
      {(req) => req ? (
        <Frame testId="wholesale-compare" title={priced.length ? `${priced.length} price${priced.length === 1 ? "" : "s"} in` : "Sent. Waiting for prices"} sub={`${carTitleOf(req.car)} · floor ${aud(cents(req.floorCents))}`}>
          <Section>
            <ul className="divide-y divide-neutral-100">
              {priced.map((row) => (
                <li key={row.bidId}>
                  <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-4 py-4">
                    <input type="radio" name="pick" checked={(chosen?.bidId ?? "") === row.bidId} onChange={() => setPick(row.bidId)} className="h-4 w-4 accent-neutral-950" />
                    <span className="text-sm">
                      {row.name}
                      {row.note ? <span className="block text-xs text-neutral-400">{row.note}</span> : null}
                    </span>
                    <span className="text-2xl font-semibold tabular-nums">{aud(cents(row.amountCents))}</span>
                  </label>
                </li>
              ))}
              {req.waiting.map((b) => (
                <li key={b.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4 text-sm text-neutral-400">
                  <span className="h-4 w-4" />
                  <span>{b.name}</span>
                  <span>Waiting</span>
                </li>
              ))}
            </ul>
          </Section>
          {error ? <p className="text-sm text-neutral-600">{error}</p> : null}
          <Actions>
            <Primary testId="accept" disabled={busy || !chosen || req.status !== "live"} onClick={() => void accept()}>
              {chosen ? `Accept ${aud(cents(chosen.amountCents))} from ${chosen.name}` : "Accept a price"}
            </Primary>
            {req.status === "live" ? <Quiet onClick={() => void keep()}>Keep the car</Quiet> : <span className="text-sm text-neutral-500">You kept this car.</span>}
          </Actions>
          <p className="text-center text-xs text-neutral-400 sm:text-left">No fee. No countdown. Take your time.</p>
        </Frame>
      ) : null}
    </LoadState>
  );
}

/* ---------- 5. Handover ---------- */

function Contact({ title, c }: { title: string; c: { business: string; person: string; phone: string | null; email: string } }) {
  return (
    <Section title={title}>
      <p className="text-base font-semibold">{c.business}</p>
      <div className="mt-2 space-y-1 text-sm text-neutral-500">
        <p>{c.person}</p>
        {c.phone ? <p>{c.phone}</p> : null}
        <p>{c.email}</p>
      </div>
    </Section>
  );
}

export function WholesaleHandoverPage() {
  const [params] = useSearchParams();
  const { state, resolved } = useRequest(params.get("code"));
  const [done, setDone] = useState(false);
  if (!resolved) return <Navigate to="/portal/wholesale/start" replace />;
  return (
    <LoadState state={state}>
      {(r) => {
        if (!r) return null;
        if (r.status !== "accepted" || !r.buyer || !r.dealer) return <Navigate to={`/portal/wholesale/compare?code=${r.code}`} replace />;
        const name = r.prices.find((x) => x.bidId === r.acceptedBidId)?.name ?? r.buyer.person;
        const collected = done || r.outcome === "completed";
        return (
          <Frame testId="wholesale-handover" title={`Sold to ${name} for ${aud(cents(r.finalSaleCents))}`} sub="You've both got each other's details. Sort out pickup and payment directly.">
            <div className="grid gap-6 sm:grid-cols-2">
              <Contact title="Buyer" c={r.buyer} />
              <Contact title="Your details (shared with the buyer)" c={r.dealer} />
            </div>
            <Actions>
              {collected
                ? <Status color={GREEN}>Marked as collected</Status>
                : <Primary testId="collected" onClick={() => void wholesaleApi.collected(r.code).then(() => setDone(true))}>Mark as collected</Primary>}
              <Quiet>Report a problem</Quiet>
            </Actions>
          </Frame>
        );
      }}
    </LoadState>
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

const SYDNEY_TIME = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

export function WholesaleUpdatesPage() {
  const state = useLoad(() => wholesaleApi.updates(), []);
  return (
    <Frame testId="wholesale-updates" title="Updates">
      <LoadState state={state}>
        {(d) => d.updates.length === 0 ? <p className="text-sm text-neutral-400">Nothing yet.</p> : (
          <ol className="relative border-l border-neutral-200 pl-6" data-testid="timeline">
            {d.updates.map((u) => (
              <li key={`${u.at}-${u.rego}-${u.text}`} className="relative py-3 text-sm">
                <span className="absolute -left-[29px] top-[18px] block h-2.5 w-2.5 rounded-full" style={{ background: updateColor(u.status) }} />
                <span className="grid gap-1 sm:grid-cols-[8rem_12rem_1fr] sm:gap-4">
                  <span className="text-xs text-neutral-400 sm:text-sm">{SYDNEY_TIME.format(new Date(u.at)).replace(" am", "am").replace(" pm", "pm")}</span>
                  <span className="font-medium">{u.car}</span>
                  <span className="text-neutral-600">{u.text}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </LoadState>
    </Frame>
  );
}

/* ---------- 7. Buyer view ---------- */

function useBuyerId() {
  const [params, setParams] = useSearchParams();
  const list = useLoad(() => wholesaleApi.buyerList(), []);
  const asParam = params.get("as");
  const current = asParam ?? list.data?.buyers[0]?.id ?? "";
  // In production the list route does not exist (404) and `as` stays empty: the buyer is whoever signed in.
  return { current, ready: !list.loading, buyers: list.data?.buyers ?? [], set: (id: string) => setParams({ as: id }, { replace: true }) };
}

function BuyerChrome({ children, as, buyers, onAs }: { children: ReactNode; as: string; buyers: Buyer[]; onAs: (id: string) => void }) {
  const navigate = useNavigate();
  const q = as ? `?as=${as}` : "";
  const testSignIn = useTestSignIn();
  // Who is signed in comes from the server. A buyer sees their own name and nothing about any dealer.
  const me = useLoad(() => wholesaleApi.me().catch(() => null), []);
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "text-neutral-950" : "text-neutral-400 hover:text-neutral-950");
  return (
    <div className="min-h-screen bg-white text-neutral-950">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3"><Wordmark /><span className="text-sm text-neutral-400">Buyer desk</span></div>
          <nav aria-label="Buyer" className="flex items-center gap-5 text-sm">
            <NavLink to={`/portal/buyer-view${q}`} className={link}>Cars</NavLink>
            <NavLink to={`/portal/buyer-prices${q}`} className={link} data-testid="link-my-prices">My prices</NavLink>
            {testSignIn ? <NavLink to="/portal/buyer-alerts" className={link} data-testid="link-alerts">Messages</NavLink> : null}
            {buyers.length === 0 ? null : <label className="flex items-center gap-1.5 text-xs text-neutral-400">
              Preview as
              <select value={as} onChange={(e) => onAs(e.target.value)} className="border border-neutral-200 bg-white px-1.5 py-1 text-xs text-neutral-700" data-testid="preview-as">
                {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>}
            {me.data?.buyer ? <span className="text-xs text-neutral-400" data-testid="buyer-name">{me.data.buyer.name}</span> : null}
            {buyers.length === 0 ? <button type="button" className="text-xs text-neutral-400 hover:text-neutral-950" data-testid="sign-out" onClick={() => { void signOutEverywhere().then(() => navigate("/portal/login")); }}>Sign out</button> : null}
          </nav>
        </div>
      </header>
      <main className="px-4 py-8">{children}</main>
    </div>
  );
}

function BuyerGate({ error, children }: { error: WholesaleApiError | null; children: ReactNode }) {
  const location = useLocation();
  if (error?.status === 401) return <Navigate to={`/portal/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (error?.code === "not_a_buyer") return <div className="min-h-screen bg-white px-4 text-neutral-950"><Refusal need="buyer" /></div>;
  return <>{children}</>;
}

export function WholesaleBuyerPage() {
  const b = useBuyerId();
  const [params] = useSearchParams();
  const state = useLoad(() => (b.ready ? wholesaleApi.buyerCars(b.current) : Promise.resolve(null)), [b.current, b.ready]);
  // A buyer alert links straight to its car: /portal/buyer-view?car=WT-XXXXXX
  const [selected, setSelected] = useState<string | null>(params.get("car"));
  return (
    <BuyerGate error={state.error}>
    <BuyerChrome as={b.current} buyers={b.buyers} onAs={b.set}>
      <Frame testId="wholesale-buyer" title="Cars to price" wide>
        <LoadState state={state}>
          {(d) => {
            if (!d) return null;
            if (d.cars.length === 0) return <p className="text-sm text-neutral-400" data-testid="no-cars">No cars to price right now.</p>;
            const car = d.cars.find((c) => c.code === selected) ?? d.cars[0];
            return <BuyerBody cars={d.cars} car={car} onSelect={setSelected} as={b.current} onSaved={state.reload} />;
          }}
        </LoadState>
      </Frame>
    </BuyerChrome>
    </BuyerGate>
  );
}

function BuyerBody({ cars, car, onSelect, as, onSaved }: { cars: BuyerCar[]; car: BuyerCar; onSelect: (code: string) => void; as: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = (c: BuyerCar) => `${c.year} ${c.model} ${c.badge}`;
  async function submit() {
    const dollars = Number(value.replace(/[^0-9]/g, ""));
    if (!dollars) { setError("Enter a price"); return; }
    setBusy(true); setError(null);
    try { await wholesaleApi.buyerPrice(as, car.code, dollars); setValue(""); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    setBusy(false);
  }
  const my = cents(car.myPriceCents);
  return (
    <div className="grid gap-8 md:grid-cols-[16rem_1fr]">
      <ul className="divide-y divide-neutral-100 border-y border-neutral-200 md:self-start" data-testid="buyer-car-list">
        {cars.map((c) => (
          <li key={c.code}>
            <button
              type="button"
              onClick={() => onSelect(c.code)}
              data-testid={`buyer-car-${c.code}`}
              className={`block w-full px-3 py-3 text-left ${car.code === c.code ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">{short(c)}{c.franchise ? <Franchise /> : null}</span>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                {c.locked ? <><LockIcon /> Locked · {aud(cents(c.myPriceCents))}</> : c.myPriceCents ? `Your price ${aud(cents(c.myPriceCents))}` : "Not priced"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{carTitleOf(car)}</h2>
            {car.franchise ? <Franchise /> : null}
          </div>
          <p className="mt-1 text-sm text-neutral-500" data-testid="seller-label">{km(car.km)} · {car.sellerLabel}</p>
          {car.note ? <p className="mt-3 text-sm" data-testid="buyer-dealer-note">“{car.note}”</p> : null}
        </div>
        {car.guide ? <GuideBlock forBuyer guide={car.guide} car={car} /> : null}
        <Section title="Your price">
          {car.locked ? (
            <div data-testid="locked-price-box">
              <input disabled value={new Intl.NumberFormat("en-AU").format(my ?? 0)} aria-label="Your price (locked)" className="block min-h-12 w-full max-w-xs cursor-not-allowed border border-neutral-200 bg-neutral-50 px-3 text-base text-neutral-400" />
              <p className="mt-3 flex items-center gap-1.5 text-sm font-medium"><LockIcon /> Price locked, dealer has picked a buyer</p>
            </div>
          ) : (
            <div data-testid="editable-price-box">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={my ? new Intl.NumberFormat("en-AU").format(my) : "e.g. 30,000"} aria-label="Your price" data-testid="price-input" className="block min-h-12 w-full max-w-xs border border-neutral-300 px-3 text-base" />
                <Primary testId="send-price" disabled={busy} onClick={() => void submit()}>{my ? "Update price" : "Send price"}</Primary>
              </div>
              {error ? <p className="mt-3 text-xs text-neutral-600">{error}</p> : null}
              <p className="mt-3 text-xs text-neutral-400">Private. You can change it until the dealer picks.</p>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------- 8. My prices ---------- */

const SYDNEY = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

function sydney(iso: string): string {
  return SYDNEY.format(new Date(iso)).replace(" am", "am").replace(" pm", "pm");
}

function sydneyDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const OUTCOME_LABEL: Record<PriceOutcome, string> = { open: "Open", picked: "Picked", not_picked: "Not picked", dealer_kept: "Dealer kept it" };

function OutcomeText({ outcome }: { outcome: PriceOutcome }) {
  if (outcome === "picked") return <Status color={GREEN}>Picked</Status>;
  if (outcome === "open") return <Status color={AMBER}>Open</Status>;
  return <span className="text-xs text-neutral-500">{OUTCOME_LABEL[outcome]}</span>;
}

function HistoryItem({ row, as, onSaved }: { row: HistoryRow; as: string; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = row.events[row.events.length - 1];
  const earlier = row.events.slice(0, -1).reverse();
  const locked = row.outcome !== "open";
  async function save() {
    const dollars = Number(value.replace(/[^0-9]/g, ""));
    if (!dollars) return;
    try { await wholesaleApi.buyerPrice(as, row.ref, dollars); setEditing(false); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
  }
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
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={new Intl.NumberFormat("en-AU").format(latest.amount)} aria-label="New price" className="min-h-9 w-24 border border-neutral-300 px-2 text-sm" />
            <button type="button" onClick={() => void save()} className="min-h-9 bg-neutral-950 px-3 text-white">Save</button>
            {error ? <span className="text-neutral-500">{error}</span> : null}
          </span>
        ) : (
          <span data-testid="editable-price-box"><Quiet onClick={() => setEditing(true)}>Change price</Quiet></span>
        )}
      </div>
    </li>
  );
}

export function BuyerPriceHistoryPage() {
  const b = useBuyerId();
  const state = useLoad(() => (b.ready ? wholesaleApi.buyerHistory(b.current) : Promise.resolve(null)), [b.current, b.ready]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [outcome, setOutcome] = useState<"all" | PriceOutcome>("all");
  const rows = useMemo(() => (state.data?.rows ?? []).filter((row) => {
    const first = sydneyDay(row.events[0].at);
    const last = sydneyDay(row.events[row.events.length - 1].at);
    if (from && last < from) return false;
    if (to && first > to) return false;
    if (outcome !== "all" && row.outcome !== outcome) return false;
    return true;
  }), [state.data, from, to, outcome]);
  const field = "mt-1 block min-h-10 w-full border border-neutral-300 bg-white px-2 text-sm";
  return (
    <BuyerGate error={state.error}>
    <BuyerChrome as={b.current} buyers={b.buyers} onAs={b.set}>
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
          {rows.map((row) => <HistoryItem key={row.ref} row={row} as={b.current} onSaved={state.reload} />)}
        </ul>
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-neutral-400">No prices match.</p> : null}
      </Frame>
    </BuyerChrome>
    </BuyerGate>
  );
}

/* ---------- 9. Messages (test inbox) ---------- */

/** Test environment only. Shows the alert exactly as the buyer's own bot would deliver it. Nothing is sent from here. */
export function BuyerMessagesPage() {
  const b = useBuyerId();
  const state = useLoad(() => (b.ready ? wholesaleApi.buyerAlerts(b.current) : Promise.resolve(null)), [b.current, b.ready]);
  return (
    <BuyerGate error={state.error}>
      <BuyerChrome as={b.current} buyers={b.buyers} onAs={b.set}>
        <Frame testId="buyer-messages" title="Messages" sub="What your Carbitrage bot sends you, newest first. This is a test inbox: nothing here was sent to a phone." wide>
          <LoadState state={state}>
            {(d) => !d ? null : d.alerts.length === 0
              ? <p className="text-sm text-neutral-400" data-testid="no-alerts">No messages yet.</p>
              : <ul className="space-y-4" data-testid="alert-list">{d.alerts.map((a) => <AlertBubble key={a.id} alert={a} />)}</ul>}
          </LoadState>
        </Frame>
      </BuyerChrome>
    </BuyerGate>
  );
}

function AlertBubble({ alert }: { alert: BuyerAlert }) {
  // The text is shown exactly as sent. The trailing link is made clickable but the words are not changed.
  const m = alert.text.match(/^(.*?)(https?:\/\/\S+)$/s);
  return (
    <li className="max-w-xl" data-testid="alert-message">
      <p className="mb-1 text-[11px] text-neutral-400">Your Carbitrage bot · {sydney(alert.at)}</p>
      <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-4 py-3 text-sm leading-relaxed text-neutral-900" data-testid="alert-text">
        {m ? <>{m[1]}<a href={m[2]} className="break-all underline underline-offset-2" data-testid="alert-link">{m[2]}</a></> : alert.text}
      </div>
    </li>
  );
}
