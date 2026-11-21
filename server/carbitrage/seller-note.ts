/**
 * The note on a wholesale request is shown to buyers as typed. Refuse anything that would
 * tell them who the selling dealer is. The reason is plain text for the dealer screen.
 */

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com\.au|net\.au|org\.au|com|net|org|au)\b/i;
const PHONE_SPAN = /(?:\+\s*)?(?:\(?\d[\d\s().-]{6,}\d)/g;
const STOCK = /\b([A-Za-z]{2,4})[\s-]?(\d{3,6})\b/g;

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function englishList(items: string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function hasPhone(text: string): boolean {
  for (const match of text.matchAll(new RegExp(PHONE_SPAN.source, "g"))) {
    const raw = match[0];
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10 && (/^04\d{8}$/.test(digits) || /^0[2378]\d{8}$/.test(digits) || /^1[38]00\d{6}$/.test(digits))) return true;
    if (digits.length === 11 && /^61[23478]\d{8}$/.test(digits)) return true;
    if (raw.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return true;
  }
  return false;
}

/** 11 digits, with the usual ABN spaces or none. A 10-digit phone is not an ABN. */
function hasAbn(text: string): boolean {
  const compact = text.replace(/(\d)[\s-](?=\d)/g, "$1");
  for (const match of compact.matchAll(/(?:^|\D)(\d{11})(?:\D|$)/g)) {
    // +61 4xx xxx xxx is 11 digits and is a phone, not an ABN.
    if (!/^61[23478]\d{8}$/.test(match[1])) return true;
  }
  return false;
}

function hasStockNumber(text: string): boolean {
  const withoutContacts = text.replace(new RegExp(EMAIL.source, "gi"), " ").replace(new RegExp(PHONE_SPAN.source, "g"), " ");
  for (const match of withoutContacts.matchAll(new RegExp(STOCK.source, "g"))) {
    if (/^kms?$/i.test(match[1])) continue;
    return true;
  }
  return false;
}

/** The dealership's own name, ignoring case and punctuation. Under 4 characters is left alone. */
export function dealerNameInNote(note: string, dealerName: string): boolean {
  const hay = fold(note);
  const full = fold(dealerName);
  if (!hay || full.length < 4) return false;
  if (hay.includes(full)) return true;
  const withoutParen = fold(dealerName.replace(/\([^)]*\)/g, " "));
  return withoutParen.length >= 4 && withoutParen !== full && hay.includes(withoutParen);
}

/** Null when the note can be shown to buyers. Otherwise one sentence saying what to take out. */
export function sellerNoteRefusal(note: string, dealerName: string): string | null {
  const text = note.trim();
  if (!text) return null;
  const found: string[] = [];
  if (hasPhone(text)) found.push("a phone number");
  if (EMAIL.test(text)) found.push("an email address");
  const withoutEmails = text.replace(new RegExp(EMAIL.source, "gi"), " ");
  if (URL.test(withoutEmails)) found.push("a web address");
  if (hasAbn(text)) found.push("an ABN");
  if (dealerNameInNote(text, dealerName)) found.push("your dealership name");
  if (hasStockNumber(text)) found.push("a stock number");
  if (found.length === 0) return null;
  return `Buyers must not be able to tell who you are. Take ${englishList(found)} out of the note.`;
}
