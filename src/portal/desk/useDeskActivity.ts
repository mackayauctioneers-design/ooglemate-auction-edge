import { useEffect, useState } from "react";
import { portalSupabase } from "../runtime";
import { DESK_BASE_URL, isDeskPreview } from "./data";
import { ACTIVITY_POLL_MS, activitySchema, activityUrl, exampleActivity, mergeActivity, summarySchema, type DeskSummary, type WorkerEvent } from "./activityData";
import type { DeskPanel } from "./useDeskFeed";

const empty = { loading: true, data: null, example: false };
export function useDeskActivity() {
  const [summary, setSummary] = useState<DeskPanel<DeskSummary>>(empty);
  const [activity, setActivity] = useState<DeskPanel<WorkerEvent[]>>(empty);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true;
    let generation = 0;
    let controller: AbortController | undefined;
    let unsubscribe: (() => void) | undefined;
    let cursor = new Date(Date.now() - 24 * 3600_000).toISOString();
    let rows: WorkerEvent[] = [];
    const preview = isDeskPreview(window.location.hostname, import.meta.env.DEV);
    const examples = exampleActivity();
    const failed = <T,>(data: T): DeskPanel<T> => ({ loading: false, data: preview ? data : null, example: preview });
    const failActivity = () => { rows = []; cursor = new Date(Date.now() - 24 * 3600_000).toISOString(); setActivity(failed(examples.activity)); setUpdatedAt(null); };
    async function load(reset = false) {
      if (controller && !reset) return;
      const current = ++generation;
      controller?.abort();
      if (reset) {
        rows = []; cursor = new Date(Date.now() - 24 * 3600_000).toISOString();
        setSummary(empty); setActivity(empty); setUpdatedAt(null);
      }
      const request = new AbortController();
      controller = request;
      const valid = () => active && current === generation;
      const timeout = window.setTimeout(() => request.abort(), 12000);
      try {
        const client = await portalSupabase();
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        if (!valid()) return;
        if (!token) { setSummary(failed(examples.summary)); failActivity(); return; }
        const get = async (url: string) => {
          const response = await fetch(url, { method: "GET", credentials: "omit", headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal: request.signal });
          if (!response.ok) throw new Error("Desk unavailable");
          return response.json() as Promise<unknown>;
        };
        await Promise.all([
          get(`${DESK_BASE_URL}/summary`).then((body) => {
            const result = summarySchema.parse(body);
            if (valid()) setSummary({ loading: false, data: result, example: false });
          }).catch(() => { if (valid()) setSummary(failed(examples.summary)); }),
          get(activityUrl(cursor)).then((body) => {
            const incoming = activitySchema.parse(body);
            if (!valid()) return;
            rows = mergeActivity(rows, incoming);
            const latest = incoming.reduce((value, row) => Date.parse(row.time) > Date.parse(value) ? row.time : value, cursor);
            cursor = latest;
            setActivity({ loading: false, data: rows, example: false }); setUpdatedAt(Date.now());
          }).catch(() => { if (valid()) failActivity(); }),
        ]);
      } catch { if (valid()) { setSummary(failed(examples.summary)); failActivity(); } }
      finally { window.clearTimeout(timeout); if (current === generation) controller = undefined; }
    }
    void portalSupabase().then((client) => {
      if (!active) return;
      const { data } = client.auth.onAuthStateChange((event) => { window.setTimeout(() => { if (active) void load(event !== "TOKEN_REFRESHED"); }, 0); });
      unsubscribe = () => data.subscription.unsubscribe();
      void load(true);
    }).catch(() => { if (active) { setSummary(failed(examples.summary)); failActivity(); } });
    const interval = window.setInterval(() => { setNow(Date.now()); void load(); }, ACTIVITY_POLL_MS);
    return () => { active = false; generation++; controller?.abort(); unsubscribe?.(); window.clearInterval(interval); };
  }, []);
  return { summary, activity, updatedAt, now };
}