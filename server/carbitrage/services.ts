import { randomUUID } from "node:crypto";
import { mintToken, sha256 } from "./auth.ts";
import {
  allowedYardIds,
  aud,
  channelLabel,
  displayedFloor,
  freshness,
  isFindStatus,
  isRecentSale,
  isSourceChannel,
  isVariantMatch,
  requireYard,
  ServiceError,
  underFloorPct,
  type AlertRecord,
  type EvidenceItem,
  type FindStatus,
  type Mandate,
  type Opportunity,
  type Principal,
  type SaleRecord,
  type Snapshot,
  type SourceChannel,
  type VariantMatch,
} from "./domain.ts";
import type { DataPort } from "./store.ts";
import { adaptPentanaSalesCsv, PENTANA_ADAPTER_ID, SYNTHETIC_PENTANA_CSV } from "./sales.ts";

export interface FindCard {
  id: string;
  yardId: string;
  yardName: string;
  synthetic: boolean;
  sourceChannel: SourceChannel;
  sourceLabel: string;
  sourceUrl: string;
  capturedAt: string;
  freshness: string;
  year: number | null;
  make: string;
  model: string;
  variant: string | null;
  variantMatch: VariantMatch;
  odometerKm: number | null;
  askingPrice: number | null;
  floorExGov: number | null;
  floorSource: string | null;
  floorAsOf: string | null;
  governmentChargesExcluded: true;
  underFloorPct: number | null;
  photoUrl: string | null;
  photoUse: "illustrative" | "listing" | "none";
  photoCaption: string | null;
  status: FindStatus;
  watchlisted: boolean;
  ingestedAt: string;
}

export interface ComparableSale {
  make: string;
  model: string;
  variant: string | null;
  price: number;
  soldAt: string;
  odometerKm: number | null;
}

export interface OlderSalesAggregate {
  count: number;
  medianPrice: number | null;
  withheldReason: string | null;
}

export interface FindDetail extends FindCard {
  photoCredit: string | null;
  evidence: EvidenceItem[];
  sourceEnvelope: Record<string, unknown>;
  sourceRetained: true;
  comparables: {
    level: "make_model";
    variantNote: string;
    recent: ComparableSale[];
    older: OlderSalesAggregate;
  };
}

export interface FindQuery {
  yardId?: string;
  source?: string;
  make?: string;
  status?: string;
  underFloor?: boolean;
  sort?: string;
}

export interface YardProfile {
  yard: {
    id: string;
    name: string;
    kind: string;
    groupId: string | null;
    ooglecarsYardId: string | null;
    ooglecarsRequired: false;
    region: string;
    franchise: string | null;
  };
  role: string;
  mandates: Mandate[];
  salesSummary: { total: number; recentCount: number; olderCount: number };
  entitlement: Entitlement;
}

export interface Entitlement {
  product: "carbitrage";
  billingEnabled: false;
  mode: "test_seam";
  note: string;
}

export interface InsightsYard {
  yardId: string;
  yardName: string;
  openFinds: number;
  underFloorCount: number;
  mandateCount: number;
  recentSales: ComparableSale[];
  olderSales: OlderSalesAggregate;
  alerts: AlertView[];
}

export interface Insights {
  publicMarket: { id: string; fact: string; synthetic: boolean }[];
  yards: InsightsYard[];
}

export interface AlertView {
  id: string;
  yardId: string;
  opportunityId: string;
  kind: AlertRecord["kind"];
  message: string;
  createdAt: string;
  read: boolean;
}

export interface Me {
  userId: string;
  email: string;
  displayName: string;
  yards: { id: string; name: string; role: string; ooglecarsYardId: string | null }[];
  entitlement: Entitlement;
  ooglecarsRequired: false;
}

export interface IngestBody {
  externalId: string;
  sourceSystem: string;
  sourceChannel: SourceChannel;
  sourceUrl: string;
  sourceLabel: string;
  capturedAt: string;
  yardId: string;
  year: number | null;
  make: string;
  model: string;
  variant: string | null;
  variantMatch: VariantMatch;
  odometerKm: number | null;
  askingPrice: number | null;
  floorExGov: number | null;
  floorSource: string | null;
  floorAsOf: string | null;
  photoUrl: string | null;
  photoCredit: string | null;
  photoUse?: "illustrative" | "listing" | "none";
  synthetic: boolean;
  envelope: Record<string, unknown>;
}

export interface IngestResult {
  opportunityId: string;
  dedupeKey: string;
  yardId: string;
  created: boolean;
  attempts: number;
  priceChangedIgnored: boolean;
}

const ENTITLEMENT: Entitlement = {
  product: "carbitrage",
  billingEnabled: false,
  mode: "test_seam",
  note: "No charge is made. Entitlement is a local test flag only.",
};

export function createServices(port: DataPort, now: () => Date) {
  function userPrincipal(userId: string): Principal {
    return { kind: "user", userId };
  }

  function presentCard(snapshot: Snapshot, opp: Opportunity, clock: Date): FindCard {
    const yard = snapshot.yards.find((y) => y.id === opp.yardId);
    const floor = displayedFloor(opp, snapshot.sales, clock);
    const photoUse = opp.photoUse ?? "none";
    return {
      id: opp.id,
      yardId: opp.yardId,
      yardName: yard?.name ?? opp.yardId,
      synthetic: opp.synthetic,
      sourceChannel: opp.sourceChannel,
      sourceLabel: opp.sourceLabel,
      sourceUrl: opp.sourceUrl,
      capturedAt: opp.capturedAt,
      freshness: freshness(opp.capturedAt, clock),
      year: opp.year,
      make: opp.make,
      model: opp.model,
      variant: opp.variant,
      variantMatch: opp.variantMatch,
      odometerKm: opp.odometerKm,
      askingPrice: opp.askingPrice,
      floorExGov: floor.floorExGov,
      floorSource: floor.floorSource,
      floorAsOf: floor.floorAsOf,
      governmentChargesExcluded: true,
      underFloorPct: underFloorPct(opp.askingPrice, floor.floorExGov),
      photoUrl: opp.photoUrl,
      photoUse,
      photoCaption: photoUse === "illustrative" ? "Illustrative photo, not the listed vehicle." : null,
      status: opp.status,
      watchlisted: opp.watchlisted,
      ingestedAt: opp.ingestedAt,
    };
  }

  function comparablesFor(snapshot: Snapshot, opp: Opportunity, clock: Date): FindDetail["comparables"] {
    const same = snapshot.sales.filter(
      (sale) =>
        sale.yardId === opp.yardId &&
        sale.make.toLowerCase() === opp.make.toLowerCase() &&
        sale.model.toLowerCase() === opp.model.toLowerCase(),
    );
    const recent = same
      .filter((sale) => isRecentSale(sale.soldAt, clock))
      .map(toComparable)
      .sort((a, b) => b.soldAt.localeCompare(a.soldAt));
    const older = aggregateOlder(same.filter((sale) => !isRecentSale(sale.soldAt, clock)));
    const variantNote =
      opp.variantMatch === "matched"
        ? "Variant was supplied on the source record. Comparisons are make and model, with no extra variant adjustment."
        : opp.variantMatch === "unmatched"
          ? "Variant did not match a known badge. Comparisons stay at make and model."
          : "Variant evidence is insufficient, so no variant price was estimated. Comparisons stay at make and model.";
    return { level: "make_model", variantNote, recent, older };
  }

  function presentDetail(snapshot: Snapshot, opp: Opportunity, clock: Date): FindDetail {
    return {
      ...presentCard(snapshot, opp, clock),
      photoCredit: opp.photoCredit,
      evidence: opp.evidence.map((item) =>
        item.label === "Floor"
          ? { label: "Floor", detail: displayedFloor(opp, snapshot.sales, clock).note }
          : item,
      ),
      sourceEnvelope: opp.sourceEnvelope,
      sourceRetained: true,
      comparables: comparablesFor(snapshot, opp, clock),
    };
  }

  function ownOpportunity(snapshot: Snapshot, principal: Principal, id: string): Opportunity {
    if (principal.kind !== "user") {
      throw new ServiceError(403, "yard_forbidden", "Ingest identities cannot read the dealer portal");
    }
    const opp = snapshot.opportunities.find((row) => row.id === id);
    if (!opp) throw new ServiceError(404, "not_found", "Find not found");
    const allowed = allowedYardIds(snapshot, principal);
    if (!allowed.includes(opp.yardId)) {
      throw new ServiceError(403, "yard_forbidden", "This account cannot access that find");
    }
    return opp;
  }

  function resolveYards(snapshot: Snapshot, principal: Principal, yardId?: string): string[] {
    if (principal.kind !== "user") {
      throw new ServiceError(403, "yard_forbidden", "Ingest identities cannot read dealer data");
    }
    const allowed = allowedYardIds(snapshot, principal);
    if (allowed.length === 0) {
      throw new ServiceError(403, "yard_forbidden", "No yard membership on this account");
    }
    if (yardId) {
      requireYard(snapshot, principal, yardId);
      return [yardId];
    }
    return allowed;
  }

  return {
    async me(principal: Principal): Promise<Me> {
      if (principal.kind !== "user") {
        throw new ServiceError(403, "yard_forbidden", "Not a dealer session");
      }
      const snapshot = await port.read(principal);
      const user = snapshot.users.find((u) => u.id === principal.userId);
      if (!user) throw new ServiceError(401, "unauthenticated", "Session user no longer exists");
      const memberships = snapshot.memberships.filter((m) => m.userId === user.id);
      return {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        yards: memberships.map((m) => {
          const yard = snapshot.yards.find((y) => y.id === m.yardId);
          return {
            id: m.yardId,
            name: yard?.name ?? m.yardId,
            role: m.role,
            ooglecarsYardId: yard?.ooglecarsYardId ?? null,
          };
        }),
        entitlement: ENTITLEMENT,
        ooglecarsRequired: false,
      };
    },

    async listFinds(principal: Principal, query: FindQuery): Promise<FindCard[]> {
      const clock = now();
      const snapshot = await port.read(principal);
      const yards = resolveYards(snapshot, principal, query.yardId);
      let rows = snapshot.opportunities.filter((opp) => yards.includes(opp.yardId));
      if (query.source) {
        if (!isSourceChannel(query.source)) {
          throw new ServiceError(400, "invalid_payload", "Unknown source channel");
        }
        rows = rows.filter((opp) => opp.sourceChannel === query.source);
      }
      if (query.make) {
        const make = query.make.toLowerCase();
        rows = rows.filter((opp) => opp.make.toLowerCase() === make);
      }
      if (query.status) {
        if (!isFindStatus(query.status)) throw new ServiceError(400, "invalid_payload", "Unknown status");
        rows = rows.filter((opp) => opp.status === query.status);
      }
      let cards = rows.map((opp) => presentCard(snapshot, opp, clock));
      if (query.underFloor) cards = cards.filter((card) => card.underFloorPct != null);
      const sort = query.sort ?? "under_floor";
      cards.sort((a, b) => compareFinds(a, b, sort));
      return cards;
    },

    async getFind(principal: Principal, id: string): Promise<FindDetail> {
      const clock = now();
      const snapshot = await port.read(principal);
      const opp = ownOpportunity(snapshot, principal, id);
      return presentDetail(snapshot, opp, clock);
    },

    async updateWorkflow(
      principal: Principal,
      id: string,
      patch: { status?: FindStatus; watchlisted?: boolean },
    ): Promise<FindDetail> {
      if (patch.status != null && !isFindStatus(patch.status)) {
        throw new ServiceError(400, "invalid_payload", "Unknown status");
      }
      const clock = now();
      let updated: Opportunity | undefined;
      await port.mutate(principal, (draft) => {
        const opp = ownOpportunity(draft, principal, id);
        const row = draft.opportunities.find((item) => item.id === opp.id);
        if (!row) throw new ServiceError(404, "not_found", "Find not found");
        if (patch.status) row.status = patch.status;
        if (typeof patch.watchlisted === "boolean") row.watchlisted = patch.watchlisted;
        updated = structuredClone(row);
      });
      if (!updated) throw new ServiceError(404, "not_found", "Find not found");
      return presentDetail(await port.read(principal), updated, clock);
    },

    async profiles(principal: Principal, yardId?: string): Promise<YardProfile[]> {
      const clock = now();
      const snapshot = await port.read(principal);
      const yards = resolveYards(snapshot, principal, yardId);
      return yards.map((id) => {
        const yard = snapshot.yards.find((y) => y.id === id);
        if (!yard) throw new ServiceError(404, "not_found", "Yard not found");
        const membership = snapshot.memberships.find((m) => m.userId === (principal.kind === "user" ? principal.userId : "") && m.yardId === id);
        const sales = snapshot.sales.filter((sale) => sale.yardId === id);
        return {
          yard: {
            id: yard.id,
            name: yard.name,
            kind: yard.kind,
            groupId: yard.groupId,
            ooglecarsYardId: yard.ooglecarsYardId,
            ooglecarsRequired: false,
            region: yard.region,
            franchise: yard.franchise,
          },
          role: membership?.role ?? "dealer",
          mandates: snapshot.mandates.filter((m) => m.yardId === id && m.active),
          salesSummary: {
            total: sales.length,
            recentCount: sales.filter((sale) => isRecentSale(sale.soldAt, clock)).length,
            olderCount: sales.filter((sale) => !isRecentSale(sale.soldAt, clock)).length,
          },
          entitlement: ENTITLEMENT,
        };
      });
    },

    async insights(principal: Principal, yardId?: string): Promise<Insights> {
      const clock = now();
      const snapshot = await port.read(principal);
      const yards = resolveYards(snapshot, principal, yardId);
      return {
        publicMarket: snapshot.publicFacts.map((fact) => ({
          id: fact.id,
          fact: fact.fact,
          synthetic: fact.synthetic,
        })),
        yards: yards.map((id) => {
          const yard = snapshot.yards.find((y) => y.id === id);
          const sales = snapshot.sales.filter((sale) => sale.yardId === id);
          const finds = snapshot.opportunities.filter((opp) => opp.yardId === id);
          return {
            yardId: id,
            yardName: yard?.name ?? id,
            openFinds: finds.filter((opp) => opp.status !== "passed").length,
            underFloorCount: finds.filter((opp) => underFloorPct(opp.askingPrice, opp.floorExGov) != null).length,
            mandateCount: snapshot.mandates.filter((m) => m.yardId === id && m.active).length,
            recentSales: sales
              .filter((sale) => isRecentSale(sale.soldAt, clock))
              .map(toComparable)
              .sort((a, b) => b.soldAt.localeCompare(a.soldAt)),
            olderSales: aggregateOlder(sales.filter((sale) => !isRecentSale(sale.soldAt, clock))),
            alerts: snapshot.alerts.filter((alert) => alert.yardId === id).map(toAlert),
          };
        }),
      };
    },

    async listAlerts(principal: Principal): Promise<AlertView[]> {
      const snapshot = await port.read(principal);
      const yards = resolveYards(snapshot, principal);
      return snapshot.alerts.filter((alert) => yards.includes(alert.yardId)).map(toAlert);
    },

    async markAlertRead(principal: Principal, id: string): Promise<AlertView> {
      let updated: AlertRecord | undefined;
      await port.mutate(principal, (draft) => {
        const yards = resolveYards(draft, principal);
        const alert = draft.alerts.find((row) => row.id === id);
        if (!alert || !yards.includes(alert.yardId)) {
          throw new ServiceError(403, "yard_forbidden", "This account cannot change that alert");
        }
        alert.read = true;
        updated = structuredClone(alert);
      });
      if (!updated) throw new ServiceError(404, "not_found", "Alert not found");
      return toAlert(updated);
    },

    async importSales(principal: Principal, csv: string, yardId?: string): Promise<{
      adapter: string;
      yardId: string;
      inserted: number;
      deduped: number;
      errors: { row: number; message: string }[];
      warnings: string[];
      mandatesUpserted: number;
    }> {
      const adapted = adaptPentanaSalesCsv(csv);
      const snapshot = await port.read(principal);
      const yards = resolveYards(snapshot, principal, yardId);
      const target = yardId ?? (yards.length === 1 ? yards[0] : undefined);
      if (!target) {
        throw new ServiceError(400, "invalid_payload", "Choose a yard you belong to before importing");
      }
      requireYard(snapshot, principal, target);
      let inserted = 0;
      let deduped = 0;
      let mandatesUpserted = 0;
      await port.mutate(principal, (draft) => {
        requireYard(draft, principal, target);
        for (const row of adapted.rows) {
          const existing = draft.sales.find((sale) => sale.yardId === target && sale.dedupeKey === row.dedupeKey);
          if (existing) {
            deduped += 1;
            continue;
          }
          const sale: SaleRecord = {
            id: `sale_${randomUUID()}`,
            yardId: target,
            dedupeKey: row.dedupeKey,
            stockNo: row.stockNo,
            soldAt: row.soldAt,
            make: row.make,
            model: row.model,
            variant: row.variant,
            year: row.year,
            odometerKm: row.odometerKm,
            price: row.price,
            priceBasis: "unknown",
            synthetic: true,
            adapter: PENTANA_ADAPTER_ID,
          };
          draft.sales.push(sale);
          inserted += 1;
        }
        mandatesUpserted = upsertMandates(draft, target);
      });
      return {
        adapter: adapted.adapter,
        yardId: target,
        inserted,
        deduped,
        errors: adapted.errors,
        warnings: adapted.warnings,
        mandatesUpserted,
      };
    },

    sampleSalesCsv(): { adapter: string; csv: string; synthetic: true; note: string } {
      return {
        adapter: PENTANA_ADAPTER_ID,
        csv: SYNTHETIC_PENTANA_CSV,
        synthetic: true,
        note: "Synthetic Pentana-shaped file. Not a live Pentana connection. The dealership column is ignored.",
      };
    },

    async ingest(principal: Principal, body: IngestBody): Promise<IngestResult> {
      if (principal.kind !== "ingest") {
        throw new ServiceError(403, "yard_forbidden", "Dealer sessions cannot ingest");
      }
      validateIngest(body);
      const dedupeKey = `${body.sourceSystem}::${body.externalId}`;
      const clock = now().toISOString();
      let result: IngestResult | undefined;
      await port.mutate(principal, (draft) => {
        const allowed = allowedYardIds(draft, principal);
        if (!allowed.includes(body.yardId)) {
          throw new ServiceError(403, "yard_forbidden", "Ingest identity is not bound to that yard");
        }
        const receipt = draft.receipts.find((row) => row.dedupeKey === dedupeKey);
        if (receipt) {
          if (receipt.yardId !== body.yardId) {
            throw new ServiceError(409, "dedupe_yard_conflict", "This source id is already stored for another yard");
          }
          receipt.attempts += 1;
          receipt.lastSeenAt = clock;
          const existing = draft.opportunities.find((opp) => opp.id === receipt.opportunityId);
          const priceChanged = existing != null && existing.askingPrice !== body.askingPrice;
          if (priceChanged) receipt.priceChangedIgnored = true;
          result = {
            opportunityId: receipt.opportunityId,
            dedupeKey,
            yardId: receipt.yardId,
            created: false,
            attempts: receipt.attempts,
            priceChangedIgnored: receipt.priceChangedIgnored,
          };
          return;
        }
        const id = `opp_${randomUUID()}`;
        const evidence = buildEvidence(draft, body);
        const opp: Opportunity = {
          id,
          yardId: body.yardId,
          synthetic: body.synthetic,
          externalId: body.externalId,
          sourceSystem: body.sourceSystem,
          sourceChannel: body.sourceChannel,
          sourceUrl: body.sourceUrl,
          sourceLabel: body.sourceLabel,
          capturedAt: body.capturedAt,
          year: body.year,
          make: body.make,
          model: body.model,
          variant: body.variant,
          variantMatch: body.variantMatch,
          odometerKm: body.odometerKm,
          askingPrice: body.askingPrice,
          floorExGov: body.floorExGov,
          floorSource: body.floorSource,
          floorAsOf: body.floorAsOf,
          governmentChargesExcluded: true,
          photoUrl: body.photoUrl,
          photoCredit: body.photoCredit,
          photoUse: body.photoUse ?? (body.photoUrl ? "listing" : "none"),
          listingPhotoUrl: body.photoUse === "illustrative" ? null : body.photoUrl,
          status: "new",
          watchlisted: false,
          sourceEnvelope: body.envelope,
          evidence,
          ingestedAt: clock,
          dedupeKey,
        };
        draft.opportunities.push(opp);
        draft.receipts.push({
          dedupeKey,
          opportunityId: id,
          yardId: body.yardId,
          attempts: 1,
          firstSeenAt: clock,
          lastSeenAt: clock,
          priceChangedIgnored: false,
        });
        pushAlerts(draft, opp, clock);
        result = {
          opportunityId: id,
          dedupeKey,
          yardId: body.yardId,
          created: true,
          attempts: 1,
          priceChangedIgnored: false,
        };
      });
      if (!result) throw new ServiceError(500, "ingest_failed", "Ingest did not record a receipt");
      return result;
    },

    async createMcpKey(principal: Principal, label = "portal"): Promise<{ token: string; label: string }> {
      if (principal.kind !== "user") {
        throw new ServiceError(403, "yard_forbidden", "Only a dealer session can mint a key");
      }
      const token = mintToken("cbk");
      await port.mutate(principal, (draft) => {
        const user = draft.users.find((u) => u.id === principal.userId);
        if (!user) throw new ServiceError(401, "unauthenticated", "Session user no longer exists");
        draft.apiKeys.push({
          id: `key_${randomUUID()}`,
          userId: user.id,
          tokenHash: sha256(token),
          label,
          createdAt: now().toISOString(),
        });
      });
      return { token, label };
    },
  };
}

export type CarbitrageServices = ReturnType<typeof createServices>;

function toComparable(sale: SaleRecord): ComparableSale {
  return {
    make: sale.make,
    model: sale.model,
    variant: sale.variant,
    price: sale.price,
    soldAt: sale.soldAt,
    odometerKm: sale.odometerKm,
  };
}

function toAlert(alert: AlertRecord): AlertView {
  return {
    id: alert.id,
    yardId: alert.yardId,
    opportunityId: alert.opportunityId,
    kind: alert.kind,
    message: alert.message,
    createdAt: alert.createdAt,
    read: alert.read,
  };
}

function aggregateOlder(sales: SaleRecord[]): OlderSalesAggregate {
  if (sales.length < 3) {
    return {
      count: sales.length,
      medianPrice: null,
      withheldReason:
        sales.length === 0
          ? null
          : "Older than 6 months. Individual prices and dates are withheld until at least 3 sales can form an aggregate.",
    };
  }
  const prices = sales.map((sale) => sale.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 1 ? prices[mid] : Math.round((prices[mid - 1] + prices[mid]) / 2);
  return {
    count: sales.length,
    medianPrice: median,
    withheldReason: "Older than 6 months. Only the count and median are shown.",
  };
}

function compareFinds(a: FindCard, b: FindCard, sort: string): number {
  switch (sort) {
    case "under_floor": {
      const av = a.underFloorPct ?? -1;
      const bv = b.underFloorPct ?? -1;
      if (bv !== av) return bv - av;
      return b.ingestedAt.localeCompare(a.ingestedAt);
    }
    case "price_asc":
      return (a.askingPrice ?? Number.MAX_SAFE_INTEGER) - (b.askingPrice ?? Number.MAX_SAFE_INTEGER);
    case "price_desc":
      return (b.askingPrice ?? -1) - (a.askingPrice ?? -1);
    case "newest":
      return b.ingestedAt.localeCompare(a.ingestedAt);
    default:
      throw new ServiceError(400, "invalid_payload", "Unknown sort");
  }
}

function validateIngest(body: IngestBody): void {
  if (!body.externalId || !body.sourceSystem || !body.make || !body.model || !body.yardId) {
    throw new ServiceError(400, "invalid_payload", "Ingest needs externalId, sourceSystem, yardId, make and model");
  }
  if (!isSourceChannel(body.sourceChannel)) {
    throw new ServiceError(400, "invalid_payload", "Unknown source channel");
  }
  if (!isVariantMatch(body.variantMatch)) {
    throw new ServiceError(400, "invalid_payload", "Unknown variant match");
  }
  if (body.variantMatch === "insufficient_evidence" && body.floorExGov != null) {
    throw new ServiceError(400, "invalid_payload", "A floor cannot be stored when variant evidence is insufficient");
  }
  try {
    const url = new URL(body.sourceUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ServiceError(400, "invalid_payload", "Source URL must be http or https");
    }
    if (url.hostname.toLowerCase().includes("autograb")) {
      throw new ServiceError(400, "autograb_blocked", "AutoGrab links are not stored");
    }
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError(400, "invalid_payload", "Source URL is not a valid URL");
  }
  if (!body.envelope || typeof body.envelope !== "object") {
    throw new ServiceError(400, "invalid_payload", "Source envelope is required");
  }
}

function buildEvidence(snapshot: Snapshot, body: IngestBody): EvidenceItem[] {
  const items: EvidenceItem[] = [
    {
      label: "Source",
      detail: `${channelLabel(body.sourceChannel)} · ${body.sourceLabel}`,
    },
  ];
  if (body.floorExGov != null && body.floorSource) {
    items.push({
      label: "Floor",
      detail: `${aud(body.floorExGov)} excluding government charges. Source: ${body.floorSource}.`,
    });
  } else {
    items.push({
      label: "Floor",
      detail: "No floor stored. Missing evidence is left blank.",
    });
  }
  const mandate = snapshot.mandates.find(
    (row) =>
      row.yardId === body.yardId &&
      row.active &&
      row.make.toLowerCase() === body.make.toLowerCase() &&
      row.model.toLowerCase() === body.model.toLowerCase(),
  );
  items.push({
    label: "DNA",
    detail: mandate
      ? `Matches an active ${mandate.make} ${mandate.model} mandate for this yard.`
      : "No active mandate for this make and model on this yard.",
  });
  return items;
}

function pushAlerts(snapshot: Snapshot, opp: Opportunity, at: string): void {
  if (underFloorPct(opp.askingPrice, opp.floorExGov) != null) {
    snapshot.alerts.push({
      id: `al_${randomUUID()}`,
      yardId: opp.yardId,
      opportunityId: opp.id,
      kind: "under_floor",
      message: `${opp.year ?? ""} ${opp.make} ${opp.model} is under the ex-gov floor.`.replace(/\s+/g, " ").trim(),
      createdAt: at,
      read: false,
    });
  }
  const matched = opp.evidence.some((item) => item.label === "DNA" && item.detail.startsWith("Matches"));
  if (matched) {
    snapshot.alerts.push({
      id: `al_${randomUUID()}`,
      yardId: opp.yardId,
      opportunityId: opp.id,
      kind: "mandate_match",
      message: `${opp.make} ${opp.model} matches this yard's DNA.`,
      createdAt: at,
      read: false,
    });
  }
}

function upsertMandates(snapshot: Snapshot, yardId: string): number {
  const groups = new Map<string, { make: string; model: string; years: number[]; kms: number[] }>();
  for (const sale of snapshot.sales.filter((row) => row.yardId === yardId)) {
    const key = `${sale.make.toLowerCase()}|${sale.model.toLowerCase()}`;
    const group = groups.get(key) ?? { make: sale.make, model: sale.model, years: [], kms: [] };
    if (sale.year != null) group.years.push(sale.year);
    if (sale.odometerKm != null) group.kms.push(sale.odometerKm);
    groups.set(key, group);
  }
  let count = 0;
  for (const group of groups.values()) {
    const salesCount = snapshot.sales.filter(
      (sale) => sale.yardId === yardId && sale.make.toLowerCase() === group.make.toLowerCase() && sale.model.toLowerCase() === group.model.toLowerCase(),
    ).length;
    if (salesCount < 2) continue;
    const yearMin = group.years.length ? Math.min(...group.years) : null;
    const yearMax = group.years.length ? Math.max(...group.years) : null;
    const kmMax = group.kms.length ? Math.max(...group.kms) : null;
    const existing = snapshot.mandates.find(
      (m) =>
        m.yardId === yardId &&
        m.derivedFrom === "sales_import" &&
        m.make.toLowerCase() === group.make.toLowerCase() &&
        m.model.toLowerCase() === group.model.toLowerCase(),
    );
    if (existing) {
      existing.yearMin = yearMin;
      existing.yearMax = yearMax;
      existing.kmMax = kmMax;
      existing.active = true;
      count += 1;
      continue;
    }
    snapshot.mandates.push({
      id: `man_${randomUUID()}`,
      yardId,
      make: group.make,
      model: group.model,
      yearMin,
      yearMax,
      kmMax,
      notes: `Derived from ${salesCount} imported sales. No buy price was invented.`,
      active: true,
      derivedFrom: "sales_import",
      synthetic: true,
    });
    count += 1;
  }
  return count;
}
