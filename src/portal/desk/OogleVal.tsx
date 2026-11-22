import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { portalSupabase } from "../runtime";
import { wholesaleApi, WholesaleApiError, type GuideAd, type GuideReply } from "../wholesale/api";
import recordedGuide from "../../../server/carbitrage/fixtures/wholesale-macan-expected-guide.json";
import { isDeskPreview, queueSchema, safeAdUrl, type QueueItem } from "./data";
import { yardMoney } from "./yardData";
import { canSendValuation, guidePollDelay, relatedCars, shapeQueueUrl, valuationParams, valuationStartLink, type ValuationInput } from "./valuationData";

function Ad({ ad, floor = false }: { ad: GuideAd; floor?: boolean }) {
  const url = safeAdUrl(ad.link);
  return <div className="border-b border-border py-3 text-sm"><p className="break-words font-medium">{ad.title}</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><span className="text-muted-foreground">{ad.km == null ? "" : `${ad.km.toLocaleString("en-AU")} km`}{ad.state ? ` · ${ad.state}` : ""}</span><span className={floor ? "text-lg font-semibold tabular-nums" : "font-semibold tabular-nums"}>{yardMoney(ad.price_ex_gov)}</span></div>{url ? <Button asChild variant="link" size="sm" className="mt-1 px-0"><a href={url} target="_blank" rel="noopener noreferrer">View ad<ArrowUpRight /></a></Button> : null}</div>;
}

export function OogleVal({ renderCar }: { renderCar: (item: QueueItem, rank: number) => ReactNode }) {
  const [mode, setMode] = useState<"rego" | "details">("rego");
  const [input, setInput] = useState<ValuationInput>({ rego: "", state: "", year: "", make: "", model: "", badge: "", km: "" });
  const [submitted, setSubmitted] = useState<ReturnType<typeof valuationParams>>(null);
  const [reply, setReply] = useState<GuideReply | null>(null);
  const [rows, setRows] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [more, setMore] = useState(false);
  const preview = isDeskPreview(window.location.hostname, import.meta.env.DEV);
  const example = reply?.source === "sample_fixture" || reply?.source === "recorded_fixture" || reply?.guide?.source === "sample_fixture" || reply?.guide?.source === "recorded_fixture";
  const params = valuationParams(input, mode);
  const set = (key: keyof ValuationInput, value: string) => { setInput(current => ({ ...current, [key]: value })); setSubmitted(null); setReply(null); setRows([]); setError(null); setBusy(false); };

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void portalSupabase().then(client => {
      if (!active) return;
      const { data } = client.auth.onAuthStateChange(event => {
        if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
        setSubmitted(null); setReply(null); setRows([]); setError(null); setBusy(false); setSessionVersion(value => value + 1);
      });
      unsubscribe = () => data.subscription.unsubscribe();
    }).catch(() => undefined);
    return () => { active = false; unsubscribe?.(); };
  }, []);

  useEffect(() => {
    if (!submitted) return;
    let active = true;
    setBusy(true); setError(null);
    void wholesaleApi.guide(submitted).then(result => {
      if (!active) return;
      const sample = result.source === "sample_fixture" || result.source === "recorded_fixture" || result.guide?.source === "sample_fixture" || result.guide?.source === "recorded_fixture";
      if (sample && !preview) { setReply(null); setError("Your desk is being set up"); return; }
      setReply(result);
    }).catch((e: unknown) => {
      if (!active) return;
      setReply(null); setRows([]);
      // Only a recorded API result is used in preview; denied access never falls back.
      if (preview && e instanceof WholesaleApiError && (e.status === 0 || e.status >= 500)) {
        setReply({ held: false, reason: null, source: "recorded_fixture", engine: null, route: null, freshExactYearAds: null,
          car: { rego: "", state: "", year: 2022, make: "Porsche", model: "Macan", badge: "S", km: 94273, notes: null },
          guide: { ...recordedGuide, source: "recorded_fixture", floor_basis_note: null, outlier_ads: [] } });
        return;
      }
      setError(e instanceof WholesaleApiError && e.status === 401 ? "Sign in to value a car" : e instanceof WholesaleApiError && e.status === 403 ? "Valuation is not available for this account" : "Your desk is being set up");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [submitted, tick, sessionVersion, preview]);

  useEffect(() => {
    const delay = guidePollDelay(reply);
    if (!delay || !submitted || example) return;
    const timer = window.setTimeout(() => setTick(value => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [reply, submitted, example]);

  useEffect(() => {
    setRows([]);
    if (!reply || example || !reply.car.make || !reply.car.model) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const load = async () => {
      const client = await portalSupabase();
      const { data } = await client.auth.getSession();
      const token = data.session?.access_token;
      if (!token || controller.signal.aborted) return;
      const response = await fetch(shapeQueueUrl(reply.car), { method: "GET", credentials: "omit", headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!response.ok) return;
      const items = queueSchema.parse(await response.json());
      if (!controller.signal.aborted) setRows(relatedCars(items));
    };
    void load().catch(() => undefined).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [reply, example, sessionVersion]);

  const guide = reply?.guide;
  const pending = guidePollDelay(reply) != null;
  const field = (key: keyof ValuationInput, label: string, numeric = false) => <div className="min-w-0 space-y-1.5"><Label htmlFor={`oogleval-${key}`} className="text-xs">{label}</Label><Input id={`oogleval-${key}`} value={input[key]} inputMode={numeric ? "numeric" : "text"} onChange={event => set(key, key === "rego" ? event.target.value.toUpperCase() : event.target.value)} /></div>;
  return <section aria-labelledby="oogleval-title" className="min-w-0 border-b border-border pb-6">
    <h2 id="oogleval-title" className="text-xl font-semibold">Value a car <span className="text-sm font-normal text-muted-foreground">(OogleVal)</span></h2>
    <form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); if (!params || busy) return; setReply(null); setRows([]); setMore(false); setSubmitted(params); }}>
      <Tabs value={mode} onValueChange={value => { setMode(value === "details" ? "details" : "rego"); setSubmitted(null); setReply(null); setRows([]); setError(null); setBusy(false); }}><TabsList className="w-full"><TabsTrigger value="rego" className="flex-1">Rego</TabsTrigger><TabsTrigger value="details" className="flex-1">Car details</TabsTrigger></TabsList></Tabs>
      <div className="grid grid-cols-2 gap-3">{mode === "rego" ? field("rego", "Rego") : <>{field("year", "Year", true)}{field("make", "Make")}{field("model", "Model")}{field("badge", "Badge")}</>}
        <div className="space-y-1.5"><Label htmlFor="oogleval-state" className="text-xs">State</Label><Select value={input.state} onValueChange={value => set("state", value)}><SelectTrigger id="oogleval-state"><SelectValue placeholder="State" /></SelectTrigger><SelectContent>{["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"].map(state => <SelectItem key={state} value={state}>{state}</SelectItem>)}</SelectContent></Select></div>{field("km", "Km", true)}</div>
      <Button type="submit" className="w-full" disabled={!params || busy}>{busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Value</Button>
    </form>
    {error ? <p role="alert" className="mt-4 text-sm text-muted-foreground">{error}</p> : null}
    {reply ? <div className="mt-5 space-y-4">{example ? <p role="status" className="border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">Example data: not your yard</p> : null}<p className="break-words text-sm font-semibold">{[reply.car.year, reply.car.make, reply.car.model, reply.car.badge].filter(Boolean).join(" ")}</p>
      {pending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Searching live ads…</p> : null}
      {guide ? <><div><h3 className="text-sm font-semibold">Floor car</h3><p className="mt-1 text-2xl font-semibold tabular-nums">{yardMoney(guide.floor_dollars)}</p><Ad ad={guide.floor_car} />{guide.provisional ? <p className="mt-2 text-xs text-muted-foreground">Provisional, not enough evidence yet.</p> : null}{guide.floor_basis_note ? <p className="mt-2 text-xs text-muted-foreground">{guide.floor_basis_note}</p> : null}</div>
        <dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-muted-foreground">Thinking</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{yardMoney(guide.thinking)}</dd></div><div><dt className="text-xs text-muted-foreground">Cautious buy</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{yardMoney(guide.cautious)}</dd></div></dl>
        <div><h3 className="text-sm font-semibold">Next comparable cars</h3>{(more ? guide.comps : guide.comps.slice(0, 3)).map((ad, index) => <Ad key={`${ad.link}:${index}`} ad={ad} />)}{guide.comps.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">No other exact-year cars on top of the floor car.</p> : null}{guide.comps.length > 3 ? <Button variant="link" size="sm" className="px-0" onClick={() => setMore(value => !value)}>{more ? "Show less" : "Show more"}</Button> : null}</div>
        {guide.live_check?.state === "gave_up" ? <p className="text-xs text-muted-foreground">The live check did not finish. These figures are from our own market data.</p> : guide.live_check?.state === "done" ? <p className="text-xs text-muted-foreground">Checked against live Carsales.</p> : null}
      </> : <p className="text-sm text-muted-foreground">No reliable floor yet{reply.reason ? ` · ${reply.reason}` : ""}</p>}
      <div className="space-y-2">{canSendValuation(reply, Boolean(example)) && !busy ? <Button asChild className="w-full"><Link to={valuationStartLink(reply)}>Send to wholesalers<ArrowUpRight /></Link></Button> : <Button disabled className="w-full">Send to wholesalers<ArrowUpRight /></Button>}<div title="Coming soon"><Button disabled variant="outline" className="w-full">Save as a buying target</Button><p className="mt-1 text-center text-xs text-muted-foreground">Coming soon</p></div></div>
      {rows.length > 0 ? <section className="border-t border-border pt-4"><h3 className="mb-3 text-sm font-semibold">Ready to buy now: cars like this</h3><ol className="space-y-4">{rows.map((item, index) => renderCar(item, index + 1))}</ol></section> : null}
    </div> : null}
  </section>;
}