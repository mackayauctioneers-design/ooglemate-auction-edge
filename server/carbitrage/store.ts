import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Snapshot, Store } from "./domain.ts";

export function emptySnapshot(): Snapshot {
  return {
    yards: [],
    users: [],
    memberships: [],
    opportunities: [],
    sales: [],
    mandates: [],
    alerts: [],
    receipts: [],
    apiKeys: [],
    ingestPrincipals: [],
    publicFacts: [],
  };
}

export class MemoryStore implements Store {
  private data: Snapshot;

  constructor(initial?: Snapshot) {
    this.data = structuredClone(initial ?? emptySnapshot());
  }

  snapshot(): Snapshot {
    return structuredClone(this.data);
  }

  mutate(fn: (draft: Snapshot) => void): void {
    const draft = structuredClone(this.data);
    fn(draft);
    this.data = draft;
  }
}

export class JsonFileStore implements Store {
  private memory: MemoryStore;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.memory = new MemoryStore(readSnapshot(filePath));
  }

  snapshot(): Snapshot {
    return this.memory.snapshot();
  }

  mutate(fn: (draft: Snapshot) => void): void {
    this.memory.mutate(fn);
    writeSnapshot(this.filePath, this.memory.snapshot());
  }
}

function readSnapshot(filePath: string): Snapshot {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Snapshot;
    return { ...emptySnapshot(), ...parsed };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptySnapshot();
    throw err;
  }
}

function writeSnapshot(filePath: string, snapshot: Snapshot): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  renameSync(tmp, filePath);
}
