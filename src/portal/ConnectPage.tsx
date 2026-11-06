import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, portalApi } from "./api";
import { PortalError, PortalLoading } from "./states";

export default function ConnectPage() {
  const [tools, setTools] = useState<{ name: string; description: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    portalApi.tools().then((result) => setTools(result.tools)).catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : "Could not load tools");
    });
  }, []);

  async function mint() {
    setMintError(null);
    try {
      const created = await portalApi.mintKey();
      setToken(created.token);
    } catch (err) {
      setMintError(err instanceof ApiError ? err.message : "Could not create a key");
    }
  }

  return (
    <section className="max-w-3xl space-y-4" data-testid="connect-page">
      <h1 className="text-2xl font-semibold tracking-tight">Connect a model</h1>
      <p className="text-sm text-neutral-600">
        ChatGPT, Claude and Grok Bot clients can call the same finds, DNA and insights as this portal. The endpoint speaks MCP JSON-RPC. The key is bound to your memberships. A yard id in the tool arguments is not enough.
      </p>
      <div className="border border-neutral-200 p-3 text-sm">
        <p className="font-medium">What works in this draft</p>
        <p className="mt-1">POST <code>/mcp</code> with <code>Authorization: Bearer</code> and methods <code>initialize</code>, <code>tools/list</code>, <code>tools/call</code>, <code>ping</code>.</p>
        <p className="mt-2 font-medium">Not configured — unverified</p>
        <p className="mt-1">Public HTTPS, OAuth for hosted connectors, and DNS for www.carbitrage.com.au. No production URL is live from this branch.</p>
      </div>
      <div className="border border-neutral-200 p-3 text-sm">
        <p className="font-medium">Operator environment</p>
        <ul className="mt-2 list-disc pl-5 text-neutral-700">
          <li><code>CARBITRAGE_DEMO_MODE</code> — set to 1 only for this local preview.</li>
          <li><code>CARBITRAGE_SESSION_SECRET</code> — signs the httpOnly session cookie.</li>
          <li><code>CARBITRAGE_DEMO_PASSWORD</code> — password login when demo mode is on.</li>
          <li><code>CARBITRAGE_DATA_FILE</code> — local JSON store. Not the linked database.</li>
          <li><code>CARBITRAGE_PORT</code> — API port, default 8787.</li>
        </ul>
      </div>
      <div>
        <Button type="button" onClick={mint}>Create an MCP key</Button>
        <p className="mt-2 text-xs text-neutral-500">The key is shown once and is not written to browser storage.</p>
        {mintError ? <p role="alert" className="mt-2 text-sm">{mintError}</p> : null}
        {token ? (
          <p className="mt-3 break-all border border-neutral-300 bg-neutral-50 p-3 font-mono text-xs" data-testid="mcp-key">
            {token}
          </p>
        ) : null}
      </div>
      <div>
        <h2 className="font-semibold">Tools</h2>
        {error ? <PortalError message={error} /> : null}
        {!error && !tools ? <PortalLoading label="Loading tools…" /> : null}
        {tools ? (
          <ul className="mt-2 divide-y divide-neutral-200 border border-neutral-200 text-sm">
            {tools.map((tool) => (
              <li key={tool.name} className="px-3 py-2">
                <p className="font-medium">{tool.name}</p>
                <p className="text-neutral-600">{tool.description}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
