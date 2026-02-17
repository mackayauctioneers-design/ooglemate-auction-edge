import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAccounts } from "@/hooks/useAccounts";
import { useBuyAgainTargets, WinnerFingerprint, LiveMatch } from "@/hooks/useBuyAgainTargets";
import { AccountSelector } from "@/components/carbitrage/AccountSelector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Crosshair, ExternalLink, TrendingUp, AlertTriangle, MapPin } from "lucide-react";

function cleanVariant(v: string | null): string | null {
  if (!v) return null;
  let c = v
    .replace(/\b[A-Z]{2,5}\d{2,4}[A-Z]?\b/g, "")
    .replace(/\bMY\d{2,4}\b/gi, "")
    .replace(/\b(cab\s*chassis|double\s*cab|dual\s*cab|crew\s*cab|single\s*cab|super\s*cab|extra\s*cab|king\s*cab|wagon|utility|ute|sedan|hatch(?:back)?|coupe|van|bus|troopcarrier|wellside|wellbody|tray|flatbed|suv|pick-?up)\b/gi, "")
    .replace(/\b\d{1,2}sp\b/gi, "")
    .replace(/\b(4x4|4x2|4wd|2wd|awd|rwd|fwd)\b/gi, "")
    .replace(/\b\d+dr\b/gi, "")
    .replace(/\b\d+st\b/gi, "")
    .replace(/\b(auto|manual|spts\s*auto|cvt|dsg|amt)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return c || null;
}

function FingerprintHeader({ fp }: { fp: WinnerFingerprint }) {
  const label = [fp.make, fp.model, cleanVariant(fp.variant)]
    .filter(Boolean)
    .join(" ");
  const driveLabel = fp.drivetrain?.toUpperCase();
  const show4wd = driveLabel && ["4WD", "AWD", "4X4"].includes(driveLabel);
  const refKm = fp.median_km || fp.avg_km;

  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div>
        <h3 className="font-semibold text-base">{label}</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
          <span>Sold <strong className="text-foreground">{fp.times_sold}×</strong></span>
          {fp.avg_profit != null && (
            <span>Avg profit <strong className="text-foreground">${fp.avg_profit.toLocaleString()}</strong></span>
          )}
          {fp.last_sale_price != null && (
            <span>Last sale <strong className="text-foreground">${fp.last_sale_price.toLocaleString()}</strong></span>
          )}
          {refKm != null && (
            <span>KM <strong className="text-foreground">{Math.round(refKm / 1000)}k</strong> <span className="text-[10px]">(±10k)</span></span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {show4wd && (
          <Badge variant="outline" className="text-xs bg-sky-500/10 text-sky-700 border-sky-300">{driveLabel}</Badge>
        )}
        {driveLabel && ["2WD", "FWD", "RWD"].includes(driveLabel) && (
          <Badge variant="outline" className="text-xs">{driveLabel}</Badge>
        )}
        {fp.rank != null && (
          <Badge variant="outline" className="text-xs">#{fp.rank}</Badge>
        )}
      </div>
    </div>
  );
}

function MatchCard({ match, fingerprint }: { match: LiveMatch; fingerprint: WinnerFingerprint }) {
  const variant = cleanVariant(match.variant);
  const label = [match.year, match.make, match.model, variant].filter(Boolean).join(" ");
  const daysListed = match.first_seen_at
    ? Math.floor((Date.now() - new Date(match.first_seen_at).getTime()) / 86400000)
    : null;

  const source = match.source?.replace("dealer_site:", "").replace("_crawl", "").replace(/_/g, " ") || "Unknown";

  return (
    <div className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors">
      <div className="space-y-0.5 min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{label}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {match.km != null && (
            <span>
              {Math.round(match.km / 1000)}k km
              {match.km_diff != null && (
                <span className={match.km_score >= 0.7 ? "text-green-600" : "text-amber-600"}>
                  {" "}({match.km_diff > 0 ? "+" : ""}{Math.round(match.km_diff / 1000)}k)
                </span>
              )}
            </span>
          )}
          {match.drivetrain && (
            <Badge variant="outline" className="text-[10px] px-1 py-0">{match.drivetrain.toUpperCase()}</Badge>
          )}
          <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{source}</span>
          {daysListed != null && <span>{daysListed}d listed</span>}
        </div>
        {match.km_score < 0.7 && match.km_score > 0 && (
          <p className="text-[10px] text-amber-600 flex items-center gap-0.5 mt-0.5">
            <AlertTriangle className="h-3 w-3" />KM outside sweet spot — verify condition
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          <p className="text-sm font-bold">
            {match.price ? `$${match.price.toLocaleString()}` : "N/A"}
          </p>
          {match.est_profit != null && match.est_profit > 0 && (
            <p className="text-xs text-green-600 flex items-center gap-0.5 justify-end">
              <TrendingUp className="h-3 w-3" />
              ~${match.est_profit.toLocaleString()} est. margin
            </p>
          )}
        </div>
        {match.url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={match.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function BuyAgainTargetsPage() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState("");

  if (!accountId && accounts?.length) {
    const mackay = accounts.find((a) => a.slug === "mackay_traders");
    setAccountId(mackay?.id || accounts[0].id);
  }

  const { groups, isLoading } = useBuyAgainTargets(accountId);

  const withMatches = groups.filter((g) => g.matches.length > 0);
  const withoutMatches = groups.filter((g) => g.matches.length === 0);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Crosshair className="h-6 w-6" />
              Buy Again Targets
            </h1>
            <p className="text-sm text-muted-foreground">
              Top 3 cheapest current listings for each of your proven winners.
            </p>
          </div>
          <AccountSelector value={accountId} onChange={setAccountId} />
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Crosshair className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No winners found</p>
            <p className="text-sm mt-1">
              Upload sales data and run the winners watchlist to generate fingerprints.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Fingerprints with live matches */}
            {withMatches.map((g) => (
              <Card key={g.fingerprint.id} className="border-primary/20">
                <CardHeader className="pb-2">
                  <FingerprintHeader fp={g.fingerprint} />
                </CardHeader>
                <CardContent className="space-y-2">
                  {g.matches.map((m) => (
                    <MatchCard key={m.id} match={m} fingerprint={g.fingerprint} />
                  ))}
                </CardContent>
              </Card>
            ))}

            {/* Fingerprints without matches */}
            {withoutMatches.length > 0 && (
              <div className="space-y-2 pt-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  No Current Matches ({withoutMatches.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {withoutMatches.map((g) => {
                    const fp = g.fingerprint;
                    const label = [fp.make, fp.model, cleanVariant(fp.variant)].filter(Boolean).join(" ");
                    return (
                      <div key={fp.id} className="p-3 rounded-lg border bg-muted/30 text-sm">
                        <span className="font-medium">{label}</span>
                        <span className="text-muted-foreground ml-2">
                          (sold {fp.times_sold}× · avg ${fp.avg_profit?.toLocaleString() || "?"})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
