/** Normalise AU date formats (DD/MM/YYYY, D/M/YYYY, DD/MM/YY) → YYYY-MM-DD for Postgres.
 *  Returns null for values that are clearly not dates (e.g. "0", empty, garbage). */
export function normaliseDateValue(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  if (!trimmed || /^0+$/.test(trimmed) || trimmed.length < 4) return null;

  // Already ISO: YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) return trimmed;

  // DD/MM/YYYY or D/M/YYYY (Australian format, 4-digit year)
  const slash4 = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (slash4) {
    const day = slash4[1].padStart(2, "0");
    const month = slash4[2].padStart(2, "0");
    const year = slash4[3];
    return `${year}-${month}-${day}`;
  }

  // DD/MM/YY or D/M/YY (2-digit year)
  const slash2 = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/);
  if (slash2) {
    const day = slash2[1].padStart(2, "0");
    const month = slash2[2].padStart(2, "0");
    const shortYear = parseInt(slash2[3]);
    const year = shortYear >= 50 ? `19${slash2[3]}` : `20${slash2[3]}`;
    return `${year}-${month}-${day}`;
  }

  return null;
}
