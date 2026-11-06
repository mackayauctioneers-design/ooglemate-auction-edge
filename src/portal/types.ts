export interface Entitlement {
  product: "carbitrage";
  billingEnabled: false;
  mode: "test_seam";
  note: string;
}

export interface Me {
  userId: string;
  email: string;
  displayName: string;
  yards: { id: string; name: string; role: string; ooglecarsYardId: string | null }[];
  entitlement: Entitlement;
  ooglecarsRequired: false;
}

export type SourceChannel =
  | "auction"
  | "fleet_lease"
  | "government"
  | "dealer_retail"
  | "aged_stock"
  | "wholesale_trade"
  | "private";

export type FindStatus = "new" | "watching" | "shortlisted" | "passed";

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
  variantMatch: "matched" | "unmatched" | "insufficient_evidence";
  odometerKm: number | null;
  askingPrice: number | null;
  floorExGov: number | null;
  floorSource: string | null;
  floorAsOf: string | null;
  governmentChargesExcluded: true;
  underFloorPct: number | null;
  photoUrl: string | null;
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

export interface FindDetail extends FindCard {
  photoCredit: string | null;
  evidence: { label: string; detail: string }[];
  sourceEnvelope: Record<string, unknown>;
  sourceRetained: true;
  comparables: {
    level: "make_model";
    variantNote: string;
    recent: ComparableSale[];
    older: { count: number; medianPrice: number | null; withheldReason: string | null };
  };
}

export interface Mandate {
  id: string;
  make: string;
  model: string;
  yearMin: number | null;
  yearMax: number | null;
  kmMax: number | null;
  notes: string;
  derivedFrom: string;
  synthetic: boolean;
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

export interface AlertView {
  id: string;
  yardId: string;
  opportunityId: string;
  kind: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export interface Insights {
  publicMarket: { id: string; fact: string; synthetic: boolean }[];
  yards: {
    yardId: string;
    yardName: string;
    openFinds: number;
    underFloorCount: number;
    mandateCount: number;
    recentSales: ComparableSale[];
    olderSales: { count: number; medianPrice: number | null; withheldReason: string | null };
    alerts: AlertView[];
  }[];
}

export interface ImportResult {
  adapter: string;
  yardId: string;
  inserted: number;
  deduped: number;
  errors: { row: number; message: string }[];
  warnings: string[];
  mandatesUpserted: number;
}
