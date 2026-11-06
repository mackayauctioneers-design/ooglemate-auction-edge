import type { SourceChannel } from "./types";

export function aud(amount: number | null): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);
}

export function km(value: number | null): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("en-AU").format(value)} km`;
}

export function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function channelLabel(channel: SourceChannel): string {
  switch (channel) {
    case "auction":
      return "Auction";
    case "fleet_lease":
      return "Fleet / lease";
    case "government":
      return "Government";
    case "dealer_retail":
      return "Dealer retail";
    case "aged_stock":
      return "Aged stock";
    case "wholesale_trade":
      return "Wholesale / trade";
    case "private":
      return "Private seller";
    default: {
      const unhandled: never = channel;
      return unhandled;
    }
  }
}

export function vehicleTitle(row: { year: number | null; make: string; model: string; variant: string | null }): string {
  return [row.year, row.make, row.model, row.variant].filter(Boolean).join(" ");
}
