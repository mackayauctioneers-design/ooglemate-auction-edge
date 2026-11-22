import { useEffect, useState } from "react";
import { portalSupabase } from "../runtime";
import { DESK_BASE_URL, dnaSchema, exampleDesk, isDeskPreview, queueSchema, type DeskDna, type QueueItem } from "./data";

export type DeskPanel<T> = { loading: boolean; data: T | null; example: boolean };
const empty = { loading: true, data: null, example: false };

export function useDeskFeed() {
  const [queue, setQueue] = useState<DeskPanel<QueueItem[]>>(empty);
  const [dna, setDna] = useState<DeskPanel<DeskDna>>(empty);
  useEffect(() => {
    let active = true;
    let generation = 0;
    let controller: AbortController | undefined;
    let unsubscribe: (() => void) | undefined;
    const preview = isDeskPreview(window.location.hostname, import.meta.env.DEV);
    const examples = exampleDesk();
    const failed = <T,>(data: T): DeskPanel<T> => ({ loading: false, data: preview ? data : null, example: preview });
    async function load() {
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      const requestController = controller;
      const signal = requestController.signal;
      setQueue(empty); setDna(empty);
      const timeout = window.setTimeout(() => requestController.abort(), 12000);
      const valid = () => active && current === generation;
      try {
        const client = await portalSupabase();
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        if (!valid()) return;
        if (!token) { setQueue(failed(examples.queue)); setDna(failed(examples.dna)); return; }
        const get = async (path: "queue" | "dna") => {
          const response = await fetch(`${DESK_BASE_URL}/${path}`, { method: "GET", credentials: "omit", headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal });
          if (!response.ok) throw new Error("Desk unavailable");
          return response.json() as Promise<unknown>;
        };
        await Promise.all([
          get("queue").then((body) => { const rows = queueSchema.parse(body); if (valid()) setQueue({ loading: false, data: rows, example: false }); }).catch(() => { if (valid()) setQueue(failed(examples.queue)); }),
          get("dna").then((body) => { const result = dnaSchema.parse(body); if (valid()) setDna({ loading: false, data: result, example: false }); }).catch(() => { if (valid()) setDna(failed(examples.dna)); }),
        ]);
      } catch { if (valid()) { setQueue(failed(examples.queue)); setDna(failed(examples.dna)); } }
      finally { window.clearTimeout(timeout); }
    }
    void portalSupabase().then((client) => {
      if (!active) return;
      const { data } = client.auth.onAuthStateChange(() => { window.setTimeout(() => { if (active) void load(); }, 0); });
      unsubscribe = () => data.subscription.unsubscribe();
      void load();
    }).catch(() => { if (active) { setQueue(failed(examples.queue)); setDna(failed(examples.dna)); } });
    return () => { active = false; generation++; controller?.abort(); unsubscribe?.(); };
  }, []);
  return { queue, dna };
}