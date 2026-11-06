import { randomUUID } from "node:crypto";
import { hashPassword, mintToken, sha256 } from "./auth.ts";
import {
  DEMO_NOW,
  type AlertRecord,
  type Mandate,
  type Membership,
  type Opportunity,
  type SaleRecord,
  type Snapshot,
  type SourceChannel,
  type Store,
  type UserAccount,
  type VariantMatch,
  type Yard,
} from "./domain.ts";

export const PERSONAS = ["patrick", "north", "group", "titled", "outsider", "addon"] as const;
export type Persona = (typeof PERSONAS)[number];

export interface SeedSecrets {
  password: string;
  users: Record<Persona, { email: string; userId: string; mcpKey: string; displayName: string }>;
  ingestToken: string;
  markers: {
    otherYard: "SECRET_OTHER_YARD_MARKER";
    north: "NORTH_ONLY_FIND";
    south: "SOUTH_ONLY_FIND";
    otherSalePrice: 7777771;
    southSalePrice: 6543210;
    patrickRecentPrices: [52000, 48000];
  };
}

const MARKER_OTHER = "SECRET_OTHER_YARD_MARKER";
const MARKER_NORTH = "NORTH_ONLY_FIND";
const MARKER_SOUTH = "SOUTH_ONLY_FIND";

export function seedDemo(store: Store, password: string, now = DEMO_NOW): SeedSecrets {
  const secrets = buildSecrets(password);
  store.mutate((draft) => {
    draft.yards.push(
      yard("yard_patrick", "Patrick Auto", "standalone_franchise", null, null, "QLD", "Patrick Auto"),
      yard("yard_ktmg_north", "KTMG North", "group_store", "group_ktmg", null, "NSW", "KTMG"),
      yard("yard_ktmg_south", "KTMG South", "group_store", "group_ktmg", null, "NSW", "KTMG"),
      yard("yard_other", "Other Motors", "standalone_franchise", null, null, "VIC", null),
      yard("yard_addon", "Addon Motors", "ooglecars_addon", null, "oc-yard-synthetic-1", "QLD", null),
    );
    for (const persona of PERSONAS) {
      const cred = secrets.users[persona];
      const hashed = hashPassword(password);
      const user: UserAccount = {
        id: cred.userId,
        email: cred.email,
        displayName: cred.displayName,
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
      };
      draft.users.push(user);
      draft.apiKeys.push({
        id: `key_${persona}`,
        userId: user.id,
        tokenHash: sha256(cred.mcpKey),
        label: `${persona} demo`,
        createdAt: now.toISOString(),
      });
    }
    memberships(secrets).forEach((row) => draft.memberships.push(row));
    draft.ingestPrincipals.push({
      id: "ingest_vps_demo",
      name: "Synthetic VPS ingest",
      tokenHash: sha256(secrets.ingestToken),
      yardIds: ["yard_patrick", "yard_ktmg_north", "yard_ktmg_south"],
    });
    draft.publicFacts.push({
      id: "fact_ute_index",
      fact: "Synthetic public market fact: national ute listing count is an index only. It is not a yard's stock, margin or sale.",
      synthetic: true,
    });
    seedPatrick(draft, now);
    seedGroup(draft, now);
    seedOther(draft, now);
    seedAddon(draft, now);
    seedSales(draft, now);
  });
  return secrets;
}

function buildSecrets(password: string): SeedSecrets {
  const users = {
    patrick: user("user_patrick", "patrick@demo.carbitrage.test", "Patrick Auto buyer"),
    north: user("user_north", "north@demo.carbitrage.test", "KTMG North buyer"),
    group: user("user_group", "group@demo.carbitrage.test", "KTMG group principal"),
    titled: user("user_titled", "titled@demo.carbitrage.test", "KTMG titled admin"),
    outsider: user("user_outsider", "outsider@demo.carbitrage.test", "Other Motors buyer"),
    addon: user("user_addon", "addon@demo.carbitrage.test", "Addon Motors buyer"),
  };
  return {
    password,
    users,
    ingestToken: mintToken("cbi"),
    markers: {
      otherYard: MARKER_OTHER,
      north: MARKER_NORTH,
      south: MARKER_SOUTH,
      otherSalePrice: 7777771,
      southSalePrice: 6543210,
      patrickRecentPrices: [52000, 48000],
    },
  };
}

function user(userId: string, email: string, displayName: string) {
  return { email, userId, mcpKey: mintToken("cbk"), displayName };
}

function yard(
  id: string,
  name: string,
  kind: Yard["kind"],
  groupId: string | null,
  ooglecarsYardId: string | null,
  region: string,
  franchise: string | null,
): Yard {
  return { id, name, kind, groupId, ooglecarsYardId, region, franchise };
}

function memberships(secrets: SeedSecrets): Membership[] {
  const id = (persona: Persona) => secrets.users[persona].userId;
  return [
    { userId: id("patrick"), yardId: "yard_patrick", role: "dealer" },
    { userId: id("north"), yardId: "yard_ktmg_north", role: "dealer" },
    { userId: id("group"), yardId: "yard_ktmg_north", role: "group_admin" },
    { userId: id("group"), yardId: "yard_ktmg_south", role: "group_admin" },
    { userId: id("titled"), yardId: "yard_ktmg_north", role: "group_admin" },
    { userId: id("outsider"), yardId: "yard_other", role: "dealer" },
    { userId: id("addon"), yardId: "yard_addon", role: "dealer" },
  ];
}

function seedPatrick(draft: Snapshot, now: Date): void {
  draft.mandates.push(
    mandate("yard_patrick", "Toyota", "Hilux", "manual", "Buys Hilux work utes. Synthetic mandate."),
    mandate("yard_patrick", "Ford", "Ranger", "manual", "Buys Ranger dual cabs. Synthetic mandate."),
  );
  const rows: Array<Parameters<typeof opportunity>[0]> = [
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-auction-hilux",
      sourceChannel: "auction",
      sourceLabel: "Synthetic auction catalogue",
      year: 2020,
      make: "Toyota",
      model: "Hilux",
      variant: "E",
      variantMatch: "matched",
      odometerKm: 86000,
      askingPrice: 46990,
      floorExGov: 52400,
      floorSource: "Patrick Auto own sales, last 6 months",
      photoUrl: "/portal-demo/hilux.jpg",
      photoCredit: "Wikimedia Commons: 2020 Toyota Hilux E",
      hoursAgo: 5,
    },
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-fleet-camry",
      sourceChannel: "fleet_lease",
      sourceLabel: "Synthetic fleet disposal",
      year: 2021,
      make: "Toyota",
      model: "Camry",
      variant: "GLI",
      variantMatch: "matched",
      odometerKm: 54000,
      askingPrice: 28990,
      floorExGov: 31200,
      floorSource: "Patrick Auto own sales, last 6 months",
      photoUrl: "/portal-demo/camry.jpg",
      photoCredit: "Wikimedia Commons: Toyota Camry GLI",
      hoursAgo: 20,
    },
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-gov-cruiser",
      sourceChannel: "government",
      sourceLabel: "Synthetic government disposal",
      year: 2018,
      make: "Toyota",
      model: "LandCruiser",
      variant: null,
      variantMatch: "insufficient_evidence",
      odometerKm: 141000,
      askingPrice: 62900,
      floorExGov: null,
      floorSource: null,
      photoUrl: "/portal-demo/landcruiser.jpg",
      photoCredit: "Wikimedia Commons: 2018 Toyota Land Cruiser 200",
      hoursAgo: 30,
    },
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-retail-ranger",
      sourceChannel: "dealer_retail",
      sourceLabel: "Synthetic dealer retail advert",
      year: 2021,
      make: "Ford",
      model: "Ranger",
      variant: "XL SuperCab",
      variantMatch: "matched",
      odometerKm: 72000,
      askingPrice: 58990,
      floorExGov: 54000,
      floorSource: "Patrick Auto own sales, last 6 months",
      photoUrl: "/portal-demo/ranger.jpg",
      photoCredit: "Wikimedia Commons: 2021 Ford Ranger XL SuperCab",
      hoursAgo: 12,
    },
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-aged-triton",
      sourceChannel: "aged_stock",
      sourceLabel: "Synthetic aged dealer stock",
      year: 2019,
      make: "Mitsubishi",
      model: "Triton",
      variant: "Athlete",
      variantMatch: "unmatched",
      odometerKm: 110000,
      askingPrice: 27900,
      floorExGov: 32500,
      floorSource: "Patrick Auto own sales, last 6 months",
      photoUrl: "/portal-demo/triton.jpg",
      photoCredit: "Wikimedia Commons: Mitsubishi Triton Athlete",
      hoursAgo: 48,
    },
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-wholesale-hilux",
      sourceChannel: "wholesale_trade",
      sourceLabel: "Synthetic wholesale tender",
      year: 2018,
      make: "Toyota",
      model: "Hilux",
      variant: "Workmate",
      variantMatch: "matched",
      odometerKm: 162000,
      askingPrice: 24800,
      floorExGov: 28600,
      floorSource: "Patrick Auto own sales, last 6 months",
      photoUrl: "/portal-demo/hilux.jpg",
      photoCredit: "Wikimedia Commons: 2020 Toyota Hilux E",
      hoursAgo: 8,
    },
    {
      yardId: "yard_patrick",
      externalId: "syn-patrick-private-corolla",
      sourceChannel: "private",
      sourceLabel: "Synthetic private seller",
      year: 1991,
      make: "Toyota",
      model: "Corolla",
      variant: "Sedan",
      variantMatch: "matched",
      odometerKm: 98000,
      askingPrice: 16990,
      floorExGov: 15800,
      floorSource: "Patrick Auto own sales, last 6 months",
      photoUrl: "/portal-demo/corolla.jpg",
      photoCredit: "Wikimedia Commons: 1991 Toyota Corolla E100",
      hoursAgo: 70,
    },
  ];
  for (const row of rows) draft.opportunities.push(opportunity(row, now));
  for (const opp of draft.opportunities.filter((item) => item.yardId === "yard_patrick")) {
    alertsFor(draft, opp);
  }
}

function seedGroup(draft: Snapshot, now: Date): void {
  draft.opportunities.push(
    opportunity(
      {
        yardId: "yard_ktmg_north",
        externalId: "syn-north-1",
        sourceChannel: "auction",
        sourceLabel: MARKER_NORTH,
        year: 2020,
        make: "Toyota",
        model: "Hilux",
        variant: "SR",
        variantMatch: "matched",
        odometerKm: 90000,
        askingPrice: 41000,
        floorExGov: 45000,
        floorSource: "KTMG North own sales",
        photoUrl: "/portal-demo/hilux.jpg",
        photoCredit: "Wikimedia Commons: 2020 Toyota Hilux E",
        hoursAgo: 6,
      },
      now,
    ),
    opportunity(
      {
        yardId: "yard_ktmg_south",
        externalId: "syn-south-1",
        sourceChannel: "dealer_retail",
        sourceLabel: MARKER_SOUTH,
        year: 2019,
        make: "Ford",
        model: "Ranger",
        variant: "XLT",
        variantMatch: "matched",
        odometerKm: 100000,
        askingPrice: 39000,
        floorExGov: 43000,
        floorSource: "KTMG South own sales",
        photoUrl: "/portal-demo/ranger.jpg",
        photoCredit: "Wikimedia Commons: 2021 Ford Ranger XL SuperCab",
        hoursAgo: 9,
      },
      now,
    ),
  );
}

function seedOther(draft: Snapshot, now: Date): void {
  draft.opportunities.push(
    opportunity(
      {
        yardId: "yard_other",
        externalId: "syn-other-1",
        sourceChannel: "private",
        sourceLabel: MARKER_OTHER,
        year: 2022,
        make: "Sample",
        model: "Record",
        variant: null,
        variantMatch: "insufficient_evidence",
        odometerKm: 1000,
        askingPrice: 8123456,
        floorExGov: null,
        floorSource: null,
        photoUrl: null,
        photoCredit: null,
        hoursAgo: 2,
      },
      now,
    ),
  );
}

function seedAddon(draft: Snapshot, now: Date): void {
  draft.opportunities.push(
    opportunity(
      {
        yardId: "yard_addon",
        externalId: "syn-addon-1",
        sourceChannel: "auction",
        sourceLabel: "Synthetic addon yard",
        year: 2019,
        make: "Mazda",
        model: "CX-5",
        variant: null,
        variantMatch: "insufficient_evidence",
        odometerKm: 70000,
        askingPrice: 25000,
        floorExGov: null,
        floorSource: null,
        photoUrl: null,
        photoCredit: null,
        hoursAgo: 15,
      },
      now,
    ),
  );
}

function seedSales(draft: Snapshot, now: Date): void {
  const add = (yardId: string, daysAgo: number, make: string, model: string, price: number) => {
    const soldAt = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    const sale: SaleRecord = {
      id: `sale_${randomUUID()}`,
      yardId,
      dedupeKey: `seed:${yardId}:${daysAgo}:${make}:${price}`,
      stockNo: null,
      soldAt,
      make,
      model,
      variant: null,
      year: 2020,
      odometerKm: 80000,
      price,
      synthetic: true,
      adapter: "seed",
    };
    draft.sales.push(sale);
  };
  add("yard_patrick", 40, "Toyota", "Hilux", 52000);
  add("yard_patrick", 100, "Ford", "Ranger", 48000);
  add("yard_patrick", 400, "Toyota", "Hilux", 40000);
  add("yard_patrick", 500, "Ford", "Ranger", 41000);
  add("yard_patrick", 600, "Toyota", "Camry", 27000);
  add("yard_ktmg_south", 12, "Ford", "Ranger", 6543210);
  add("yard_other", 8, "Hidden", MARKER_OTHER, 7777771);
}

function mandate(yardId: string, make: string, model: string, derivedFrom: Mandate["derivedFrom"], notes: string): Mandate {
  return {
    id: `man_${yardId}_${make}_${model}`.toLowerCase(),
    yardId,
    make,
    model,
    yearMin: 2016,
    yearMax: 2022,
    kmMax: 180000,
    notes,
    active: true,
    derivedFrom,
    synthetic: true,
  };
}

interface OppInput {
  yardId: string;
  externalId: string;
  sourceChannel: SourceChannel;
  sourceLabel: string;
  year: number | null;
  make: string;
  model: string;
  variant: string | null;
  variantMatch: VariantMatch;
  odometerKm: number | null;
  askingPrice: number | null;
  floorExGov: number | null;
  floorSource: string | null;
  photoUrl: string | null;
  photoCredit: string | null;
  hoursAgo: number;
}

function opportunity(input: OppInput, now: Date): Opportunity {
  const capturedAt = new Date(now.getTime() - input.hoursAgo * 3_600_000).toISOString();
  const hasMandate =
    input.yardId === "yard_patrick" &&
    ((input.make === "Toyota" && input.model === "Hilux") || (input.make === "Ford" && input.model === "Ranger"));
  return {
    id: `opp_${input.externalId}`,
    yardId: input.yardId,
    synthetic: true,
    externalId: input.externalId,
    sourceSystem: "synthetic_fixture",
    sourceChannel: input.sourceChannel,
    sourceUrl: `https://example.invalid/synthetic/${input.sourceChannel}/${input.externalId}`,
    sourceLabel: input.sourceLabel,
    capturedAt,
    year: input.year,
    make: input.make,
    model: input.model,
    variant: input.variant,
    variantMatch: input.variantMatch,
    odometerKm: input.odometerKm,
    askingPrice: input.askingPrice,
    floorExGov: input.floorExGov,
    floorSource: input.floorSource,
    floorAsOf: input.floorExGov != null ? "2026-11-01" : null,
    governmentChargesExcluded: true,
    photoUrl: input.photoUrl,
    photoCredit: input.photoCredit,
    status: "new",
    watchlisted: false,
    sourceEnvelope: {
      fixture: "synthetic",
      externalId: input.externalId,
      listingRef: input.externalId,
      note: "Original synthetic source payload retained for this yard only.",
    },
    evidence: [
      { label: "Source", detail: `${input.sourceChannel} · ${input.sourceLabel}` },
      {
        label: "Floor",
        detail:
          input.floorExGov != null && input.floorSource
            ? `Floor stored from ${input.floorSource}. Government charges are excluded.`
            : "No floor stored. Missing evidence is left blank.",
      },
      {
        label: "DNA",
        detail: hasMandate
          ? `Matches an active ${input.make} ${input.model} mandate for this yard.`
          : "No active mandate for this make and model on this yard.",
      },
    ],
    ingestedAt: capturedAt,
    dedupeKey: `synthetic_fixture::${input.externalId}`,
  };
}

function alertsFor(draft: Snapshot, opp: Opportunity): void {
  const alerts: AlertRecord[] = [];
  if (opp.askingPrice != null && opp.floorExGov != null && opp.askingPrice < opp.floorExGov) {
    alerts.push({
      id: `al_${opp.id}_floor`,
      yardId: opp.yardId,
      opportunityId: opp.id,
      kind: "under_floor",
      message: `${opp.year ?? ""} ${opp.make} ${opp.model} is under the ex-gov floor.`.replace(/\s+/g, " ").trim(),
      createdAt: opp.ingestedAt,
      read: false,
    });
  }
  if (opp.evidence.some((item) => item.detail.startsWith("Matches"))) {
    alerts.push({
      id: `al_${opp.id}_dna`,
      yardId: opp.yardId,
      opportunityId: opp.id,
      kind: "mandate_match",
      message: `${opp.make} ${opp.model} matches this yard's DNA.`,
      createdAt: opp.ingestedAt,
      read: false,
    });
  }
  draft.alerts.push(...alerts);
}
