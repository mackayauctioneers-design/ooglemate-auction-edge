import { useEffect } from 'react';

export default function ArchitectureOverviewPage() {
  useEffect(() => {
    document.title = 'OogleMate — Architecture Overview';
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-12 space-y-12">
        {/* Header */}
        <header className="space-y-2 border-b border-border pb-8">
          <h1 className="text-3xl font-bold tracking-tight">OogleMate — System Architecture</h1>
          <p className="text-muted-foreground text-lg">
            Vehicle sourcing intelligence platform for wholesale operators. Current state as of February 2026.
          </p>
        </header>

        {/* 1. What It Does */}
        <Section title="1. What OogleMate Does">
          <p>
            OogleMate is a <strong>dealer replication engine</strong>. It ingests vehicle listings from auction houses and retail platforms across Australia,
            normalizes them to a canonical identity taxonomy, scores them against a dealer's proven sales fingerprints,
            and surfaces arbitrage opportunities — vehicles a dealer has <em>profitably sold before</em> that are now available below their historical margin window.
          </p>
          <p className="mt-2">
            The system serves wholesale used-vehicle operators who buy at auction and resell via their yard. 
            It replaces manual auction catalogue scanning with automated, fingerprint-driven sourcing.
          </p>
        </Section>

        {/* 2. Ingestion Pipeline */}
        <Section title="2. Ingestion Pipeline">
          <SubSection title="Sources (Current)">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Pickles Auctions</strong> — Primary. Firecrawl-based structured extraction across 10 category pages. Nightly batch + on-demand URL intake.</li>
              <li><strong>Grays Online</strong> — Stub-based ingestion. Scrapes listing anchors, deep-fetches detail pages for enrichment.</li>
              <li><strong>Manheim</strong> — HTML scraping across Passenger, LCV, and 4WD/SUV categories. Parallel normalization (batches of 20), batch upserts (chunks of 50). ~600 listings in 18s.</li>
              <li><strong>Toyota Used Vehicles</strong> — Structured API via Caroogle backend. 2-hour cycle. OEM dealer inventory with explicit variant, price, odometer.</li>
              <li><strong>Secondary Auctions</strong> — Auto-Auctions, Valley Motor Auctions, F3 Motor Auctions, United Auctions NSW, Slattery. Daily 7am AEST harvest, Slattery adds evening run. 2016+ year floor enforced.</li>
              <li><strong>Dealer Outbound Sites</strong> — Long-tail dealer websites scraped via Firecrawl on-demand for high-priority fingerprints only.</li>
              <li><strong>AutoTrader</strong> — Paginated crawl with cursor tracking per make/state.</li>
            </ul>
          </SubSection>

          <SubSection title="Ingestion Strategy">
            <p>
              <strong>Hybrid model:</strong> Major structured sources (80% of volume — Pickles, Grays, Manheim) are batch-ingested nightly 
              and matched locally against fingerprints. Fragmented long-tail sources (20%) are searched on-demand for high-priority 
              fingerprints only, where potential margins justify API/scraping costs.
            </p>
          </SubSection>

          <SubSection title="Pre-Insert Validation Guards">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Provenance Gate</strong> — Every upsert stamped with <code>last_ingest_run_id</code> for full traceability back to the exact cron run.</li>
              <li><strong>Price Gate</strong> — New listings with missing/zero price are rejected. Updates still proceed to maintain freshness.</li>
              <li><strong>Lemon-Check Gate</strong> — HTTP HEAD validates detail URL before insert. 404/410 or redirect = rejected. 5xx = allowed through to avoid false rejections.</li>
            </ul>
          </SubSection>

          <SubSection title="Lifecycle Management">
            <p>
              Listings are marked <strong>STALE</strong> after 7 days unseen, <strong>DEAD</strong> after 14 days. 
              Revived if seen again. Lifecycle sweep runs as a CrossSafe job.
            </p>
          </SubSection>
        </Section>

        {/* 3. CrossSafe Engine */}
        <Section title="3. CrossSafe — Unified Job Queue">
          <p>
            CrossSafe replaces fragmented cron-based scraping with a centralized job queue architecture.
          </p>
          <SubSection title="Components">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>crosssafe_jobs</strong> — Unified job table. Types: <code>source_refresh</code>, <code>url_ingest</code>, <code>lifecycle_sweep</code>, <code>score_batch</code>. Claims use <code>FOR UPDATE SKIP LOCKED</code> via RPC.</li>
              <li><strong>crosssafe-scheduler</strong> — Dumb cron (nightly 1:30am AEST). Only enqueues jobs, never crawls. Deduplicates against existing queued jobs.</li>
              <li><strong>crosssafe-worker</strong> — Runs every 5 minutes. Claims up to 5 jobs per run. Delegates to existing ingest functions via HTTP. 3 retries then parks.</li>
              <li><strong>crosssafe_audit_log</strong> — Step-level audit per job (claimed, succeeded, retryable_error, parked).</li>
            </ul>
          </SubSection>
          <SubSection title="Known Limitation">
            <p>Edge functions have ~60s timeout. Long-running source_refresh jobs (Pickles with 10 Firecrawl pages) can timeout. Worker marks these as failed/retry. Needs breaking into smaller page-batch jobs.</p>
          </SubSection>
        </Section>

        {/* 4. Identity Normalization */}
        <Section title="4. Identity Normalization (Taxonomy Engine)">
          <p>
            ALL ingestion paths resolve through a <strong>single canonical normalizer</strong>: <code>normalizeVehicleIdentity()</code>.
            No inline model/variant maps exist anywhere in the codebase.
          </p>
          <SubSection title="Architecture">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>taxonomy_models</strong> — 58 canonical make/model entries with aliases and family_key.</li>
              <li><strong>taxonomy_variant_rank</strong> — Hierarchical variant/trim ranking per make/model (40+ variants seeded).</li>
              <li><strong>dealer_sales_fingerprints</strong> — Aggregated dealer sales truth for assist-based override.</li>
              <li><strong>MULTI_WORD_MODELS</strong> — Shared constant from <code>_shared/taxonomy/parseSlug.ts</code> used by all slug-based parsing.</li>
            </ul>
          </SubSection>
          <SubSection title="Scoring (0–100)">
            <ul className="list-disc pl-6 space-y-1">
              <li>Rule-based: Make/Model canon hit (+60), URL slug hit (+50), Alias hit (+45)</li>
              <li>Variant rank hierarchy ensures grade parity</li>
              <li>Dealer Sales-Truth Assist: overrides ambiguous models (e.g., Prado vs LandCruiser) based on dealer's historical sales frequency</li>
              <li>All resolutions include forensic <code>explain[]</code> reason codes</li>
            </ul>
          </SubSection>
          <SubSection title="Integration Points">
            <p>Normalizer enforced at 4 chokepoints: <code>nsw-regional-ingest</code> (covering F3, AAV, Valley, UAA NSW, BidsOnline), <code>caroogle-shadow-cron</code> (Pickles), <code>listing-normalizer</code>, and <code>outward-scrape-worker</code>.</p>
          </SubSection>
        </Section>

        {/* 5. Fingerprint System */}
        <Section title="5. Fingerprint System (Dual-Type)">
          <SubSection title="Type A — Core Fingerprints">
            <ul className="list-disc pl-6 space-y-1">
              <li>Built from 3+ sales of the same vehicle shape</li>
              <li>Confidence: medium or high (based on sales_count)</li>
              <li>Full scoring (0–110): repeatability + velocity + profitability + consistency + bonus/penalty</li>
              <li>Always-on scanning, primary hunting targets</li>
            </ul>
          </SubSection>
          <SubSection title="Type B — Outcome Fingerprints">
            <ul className="list-disc pl-6 space-y-1">
              <li>Built from 1–2 PROFITABLE sales</li>
              <li>Confidence: low</li>
              <li>Simplified scoring (0–50): outcome signal + velocity + margin quality</li>
              <li>Purpose: remember what worked, watch for repeats, catch forgotten winners</li>
              <li>Must NOT be auto-retired or filtered by volume gates</li>
            </ul>
          </SubSection>
          <SubSection title="Platform Integrity">
            <p>
              <code>derive_platform()</code> enforces platform identity. Prado NEVER matches LandCruiser. 
              LandCruiser splits: LC300 (2022+), LC200 (2008–2021), LC_OTHER. 
              Platform check is the FIRST gate in candidate filtering.
            </p>
          </SubSection>
        </Section>

        {/* 6. Scoring Engine */}
        <Section title="6. Scoring Engine (v2)">
          <SubSection title="Hard Anchor Match Gates (recently enforced)">
            <ul className="list-disc pl-6 space-y-1">
              <li>Same <code>trim_class</code> — no BASE wildcard leaking</li>
              <li>KM within ±20%</li>
              <li>Year within ±1</li>
              <li>Same drivetrain (4x4 never matches 2WD)</li>
              <li>If none qualify → <code>margin = null</code></li>
            </ul>
          </SubSection>
          <SubSection title="Anchor Selection">
            <p>
              Sorted by <strong>70% KM proximity / 30% historical profit</strong>. Closest comparable wins. 
              Profit only breaks ties. Previously was 60% profit-weighted (cherry-picking best historical win) — corrected to prevent inflated margins.
            </p>
          </SubSection>
          <SubSection title="Margin Definition">
            <p>
              <code>expected_margin = anchor_sale_profit</code> (actual historical profit on the comparable sale). 
              NOT <code>anchor_sell_price - listing_asking_price</code> (which assumes full retail replication). 
              Margins &gt;$15k flagged <code>high_variance</code> server-side.
            </p>
          </SubSection>
          <SubSection title="Hard Caps per Run">
            <ul className="list-disc pl-6 space-y-1">
              <li>MAX_LISTINGS_PER_RUN = 3,000</li>
              <li>MAX_OPPORTUNITIES_CREATED = 300 (priced)</li>
              <li>MAX_AUCTION_WATCH_CREATED = 150 (priceless)</li>
              <li>TOP_K_PER_FINGERPRINT = 3 (priced), 2 (auction watch)</li>
            </ul>
          </SubSection>
          <SubSection title="Delta Fetch">
            <p>
              <code>scorer_cursors</code> table tracks <code>last_seen_cutoff</code>. Each run only processes listings 
              with <code>last_seen_at &gt; cutoff</code>. After success, cursor advances to <code>now() - 10min</code> (safety buffer).
            </p>
          </SubSection>
          <SubSection title="Terminal State Protection">
            <p>
              <code>upsert_operator_opportunity_guarded()</code> enforces at the database level. Terminal states 
              (ignored, expired, lost, won, archived) are NEVER revived by the scorer.
            </p>
          </SubSection>
        </Section>

        {/* 7. Liquidity Replication */}
        <Section title="7. Liquidity Replication Engine">
          <p>
            Flow: <code>dealer_sales → v_sales_truth_normalized → dealer_liquidity_profiles → pickles-buy-now-scan → pickles_buy_now_listings → Slack alerts</code>
          </p>
          <SubSection title="Confidence Tiers & Profit Floors">
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>HIGH</strong>: flip_count ≥ 5, last sale within 365d → floor $1,000</li>
              <li><strong>MED</strong>: flip_count 2–4, last sale within 730d → floor $2,000</li>
              <li><strong>LOW</strong>: everything else → floor $3,000</li>
              <li>"Market-obvious" override: if profit gap ≥ $7,000, alert regardless</li>
            </ul>
          </SubSection>
          <SubSection title="Buy Now Scan">
            <p>
              <code>pickles-buy-now-scan</code> runs every 30 minutes (AEST 8am–6pm business hours gate). 
              Content hash change detection skips parse if unchanged, still runs matching. 
              Slack alerts for expected_margin ≥ $4,000.
            </p>
          </SubSection>
        </Section>

        {/* 8. Bob AI */}
        <Section title="8. Bob — AI Reasoning Layer">
          <p>
            Server-side reasoning service implementing: Intent Classification → Evidence Builder → Reasoning Engine → Structured Response.
          </p>
          <SubSection title="Constitution v3.0">
            <ul className="list-disc pl-6 space-y-1">
              <li>Core job: Replicate proven sales fingerprints, intelligently surface deviations</li>
              <li>Speaks decisively when confidence is MEDIUM+</li>
              <li>Tone: head buyer talking to a mate — short, direct, confident, commercial</li>
              <li>No disclaimers, hedging, or over-qualifying</li>
            </ul>
          </SubSection>
          <SubSection title="Non-Negotiable Structural Match">
            <p>Must always match: Same make, model, engine family, body type, transmission, fuel. If ANY differ → Reject.</p>
          </SubSection>
          <SubSection title="Grounded Comparisons (recently enforced)">
            <ul className="list-disc pl-6 space-y-1">
              <li>"Value gap" language removed entirely</li>
              <li>Shows: "Last comparable sold at $X. This unit asking $Y. Spread: $Z."</li>
              <li>Exposes anchor context: anchor_sold_at, anchor_km, anchor_trim</li>
              <li>Large margins qualified against anchor context, never presented as black-box numbers</li>
            </ul>
          </SubSection>
        </Section>

        {/* 9. Target Conduit */}
        <Section title="9. Target Conduit System">
          <p>
            Bridges sales uploads to daily operational work:
          </p>
          <p className="font-mono text-sm mt-1">
            Sales Upload → build-sales-targets → sales_target_candidates → generate-daily-targets → josh_daily_targets
          </p>
          <SubSection title="Scoring (v1)">
            <ul className="list-disc pl-6 space-y-1">
              <li>Repeatability (0–40): 3 sales=15, 5=25, 10+=40</li>
              <li>Velocity (0–25): median DTC ≤21d=25, ≤45d=15</li>
              <li>Profitability (0–20): median_profit &gt; 0 = 20</li>
              <li>Consistency (0–15): low DTC variance=15</li>
              <li>Gate: sales_count ≥ 3 required</li>
            </ul>
          </SubSection>
          <SubSection title="Daily Selection">
            <p>Top candidates by score, avoids repeating within 7 days. Core targets get ~80% of daily slots, Outcome targets get 2–3 discovery slots.</p>
          </SubSection>
        </Section>

        {/* 10. Monitoring */}
        <Section title="10. Monitoring & Health">
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Ingestion Health Check</strong> — Edge function monitoring all sources. Detects: STALE, ERROR, NEVER_RUN, LOW_VOLUME, ZERO_OUTPUT (successful runs with 0 rows), SILENT_FAIL (job "succeeded" but found=0, new=0). Slack alerts with deduplication (same alerts within 60min suppressed).</li>
            <li><strong>Ingestion Audit Dashboard</strong> — Server-side PostgreSQL RPC for per-source metrics: total/active counts, 24h update rates, staleness percentages (7d+, 14d+). Tracks Firecrawl credit burn.</li>
            <li><strong>CrossSafe Monitor</strong> — Job queue summary (24h), lifecycle breakdown, heartbeats, recent jobs table, manual run buttons, URL ingest test box.</li>
            <li><strong>Cron Heartbeat</strong> — All ingestion functions report to <code>cron_heartbeat</code> table with <code>last_ok</code> status and notes.</li>
          </ul>
        </Section>

        {/* 11. Tech Stack */}
        <Section title="11. Tech Stack">
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Frontend</strong> — React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Recharts</li>
            <li><strong>Backend</strong> — Supabase (PostgreSQL, Edge Functions via Deno, RLS, RPC)</li>
            <li><strong>Scraping</strong> — Firecrawl (structured extraction with JSON schemas), direct HTML parsing</li>
            <li><strong>AI</strong> — CaroogleAI (multi-model reasoning layer for discovery, valuation, and market insight)</li>
            <li><strong>Notifications</strong> — Slack webhooks for real-time alerts</li>
            <li><strong>Job Queue</strong> — Custom CrossSafe engine (PostgreSQL-based, FOR UPDATE SKIP LOCKED)</li>
          </ul>
        </Section>

        {/* 12. Known Gaps */}
        <Section title="12. Known Gaps & Opportunities">
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Edge function timeout (60s)</strong> — Long-running source_refresh jobs can timeout. Need page-batch decomposition.</li>
            <li><strong>Taxonomy coverage</strong> — 58 models seeded, 40+ variants. Expanding coverage as new makes enter the pipeline.</li>
            <li><strong>Anchor density</strong> — After hard gates enforced, some make/model combinations have 0 qualifying anchors. Need more sales data ingested per dealer to increase density.</li>
            <li><strong>Search</strong> — Currently no full-text or semantic search across listings. Operators use fingerprint-driven matching only.</li>
            <li><strong>Multi-dealer scaling</strong> — Architecture supports multi-tenant (account_id-based), but currently serving 2 active dealer accounts.</li>
            <li><strong>Market drift detection</strong> — No temporal pricing adjustment. Anchor comparisons don't account for market movement between sale date and current listing.</li>
          </ul>
        </Section>

        {/* Footer */}
        <footer className="border-t border-border pt-6 text-sm text-muted-foreground">
          <p>Generated from live system architecture — February 2026</p>
          <p>OogleMate by Carbitrage</p>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
      <div>{children}</div>
    </div>
  );
}
