// Pure presentation helpers for the owner-only Caught tab (no imports; node-tested).
const TZ = 'Australia/Sydney';

/** "Wed 1:14pm" in Sydney time. */
export function foundLabel(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '—';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${String(p.weekday).slice(0, 3)} ${p.hour}:${p.minute}${String(p.dayPeriod).toLowerCase().replace(/\./g, '')}`;
}

/** 108000 -> "108ks". Blank when unknown. */
export const kmLabel = (km: number | null | undefined) => (km == null || !Number.isFinite(km) ? '' : `${Math.round(km / 1000)}ks`);

export const money = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `$${Math.round(n).toLocaleString('en-AU')}`);

/** Gap as returned by the feed: "$2,400 · 8.1%". Never computed here. */
export function gapLabel(dollars: number | null | undefined, pct: number | null | undefined): string {
  const parts = [dollars != null && Number.isFinite(dollars) ? money(dollars) : null, pct != null && Number.isFinite(pct) ? `${Number(pct).toFixed(1)}%` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

/** Countdown to an auction end: "2d 4h", "3h 12m", "12m", "ended". Null without an end. */
export function countdown(iso: string | null | undefined, now: number): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'ended';
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

/** YYYY-MM-DD for "today" in Sydney. */
export const sydneyDate = (now: number) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));

export type CoverageRow = { date: string; source: string; listings_scanned?: number | null; new?: number | null; errors?: number | null; catches?: number | null; quiet?: boolean | null; received_at?: string | null };
export type CoverageChip = { source: string; row: CoverageRow | null; red: boolean; reason: string | null };

/** One chip per source for today (Sydney), or the latest date present. Red when quiet, errors > 0, or a source that reported the previous day is missing. */
export function coverageStrip(rows: CoverageRow[], now: number): { date: string | null; chips: CoverageChip[] } {
  const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();
  if (!dates.length) return { date: null, chips: [] };
  const today = sydneyDate(now);
  const date = dates.includes(today) ? today : dates[0];
  const prev = dates.find((d) => d < date) ?? null;
  const day = rows.filter((r) => r.date === date);
  const chips: CoverageChip[] = day.map((r) => {
    const reason = r.quiet ? 'quiet' : (r.errors ?? 0) > 0 ? `${r.errors} errors` : null;
    return { source: r.source, row: r, red: !!reason, reason };
  });
  const have = new Set(day.map((r) => r.source));
  if (prev) for (const r of rows) if (r.date === prev && !have.has(r.source)) { have.add(r.source); chips.push({ source: r.source, row: null, red: true, reason: 'no report today' }); }
  chips.sort((a, b) => Number(b.red) - Number(a.red) || a.source.localeCompare(b.source));
  return { date, chips };
}
