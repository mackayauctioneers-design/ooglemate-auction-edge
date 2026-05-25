import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface UnmappedRow {
  id: string;
  source_slug: string;
  source_name: string | null;
  source_domain: string | null;
  last_seen_at: string;
  occurrences: number;
  status: string;
}

interface Account {
  id: string;
  slug: string;
  display_name: string;
}

export default function UnmappedScrapeSourcesPage() {
  const [rows, setRows] = useState<UnmappedRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [filter, setFilter] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const sb = supabase as any;
    const [u, a] = await Promise.all([
      sb
        .from("dealer_unmapped_sources")
        .select("*")
        .eq("status", "open")
        .order("last_seen_at", { ascending: false }),
      sb
        .from("accounts")
        .select("id, slug, display_name")
        .order("display_name", { ascending: true }),
    ]);
    setRows(((u.data as UnmappedRow[] | null) ?? []));
    setAccounts(((a.data as Account[] | null) ?? []));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const mapTo = async (row: UnmappedRow, accountId: string) => {
    if (!accountId) return;
    setBusyId(row.id);
    // Link the scrape target to this account
    const { error: linkErr } = await supabase
      .from("dealer_outbound_sources")
      .update({ account_id: accountId } as any)
      .eq("dealer_slug", row.source_slug);
    if (linkErr) {
      toast.error(`Link failed: ${linkErr.message}`);
      setBusyId(null);
      return;
    }
    const { error: resolveErr } = await supabase
      .from("dealer_unmapped_sources" as any)
      .update({ status: "mapped", resolved_account_id: accountId } as any)
      .eq("id", row.id);
    setBusyId(null);
    if (resolveErr) {
      toast.error(`Resolve failed: ${resolveErr.message}`);
      return;
    }
    toast.success("Mapped to dealer");
    load();
  };

  const ignore = async (row: UnmappedRow) => {
    setBusyId(row.id);
    const { error } = await supabase
      .from("dealer_unmapped_sources" as any)
      .update({ status: "ignored" } as any)
      .eq("id", row.id);
    setBusyId(null);
    if (error) toast.error(error.message);
    else load();
  };

  const filteredAccounts = (q: string) =>
    accounts.filter((a) =>
      `${a.display_name} ${a.slug}`.toLowerCase().includes(q.toLowerCase())
    );

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Unmapped Scrape Sources</span>
            <Badge variant="secondary">{rows.length} open</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Scrape targets without a canonical dealer identity. Map each one to
            an existing dealer account; never create dealers from scrape names.
          </p>
          <Input
            placeholder="Filter dealers…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-4 max-w-sm"
          />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All scrape sources are mapped. ✓
            </p>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <Card key={row.id} className="bg-muted/30">
                  <CardContent className="pt-4 space-y-2">
                    <div className="flex justify-between items-start gap-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {row.source_name ?? row.source_slug}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          slug: {row.source_slug}
                          {row.source_domain ? ` · ${row.source_domain}` : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          last seen {new Date(row.last_seen_at).toLocaleString()} ·
                          {" "}{row.occurrences}× occurrences
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => ignore(row)}
                        disabled={busyId === row.id}
                      >
                        Ignore
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-2">
                      <select
                        className="border rounded px-2 py-1 text-sm bg-background"
                        defaultValue=""
                        onChange={(e) => mapTo(row, e.target.value)}
                        disabled={busyId === row.id}
                      >
                        <option value="" disabled>
                          Map to dealer…
                        </option>
                        {filteredAccounts(filter).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.display_name} ({a.slug})
                          </option>
                        ))}
                      </select>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
