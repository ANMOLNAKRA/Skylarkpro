import type { MondayItem } from "./monday";

/**
 * The source CSVs are intentionally messy: blank/duplicate header rows embedded
 * mid-file, masked codes instead of names, empty strings for missing numbers/dates,
 * inconsistent casing on sector/status labels. monday.com's own CSV importer already
 * strips the junk header rows (they become garbage items we filter out below), but
 * the remaining messiness (nulls, casing, stray whitespace, currency-like strings)
 * has to be handled here before we hand data to the LLM.
 */

export interface CleanRecord {
  id: string;
  name: string;
  fields: Record<string, string | number | null>;
  missingFields: string[];
  isJunkRow: boolean;
}

const JUNK_VALUE_MARKERS = new Set([
  "deal status",
  "close date (a)",
  "closure probability",
  "tentative close date",
  "deal stage",
  "product deal",
  "sector/service",
  "created date",
  "execution status",
]);

function normalizeSectorName(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.includes("mining")) return "Mining";
  if (cleaned.includes("power")) return "Powerline";
  if (cleaned.includes("solar")) return "Solar";
  if (cleaned.includes("telecom")) return "Telecom";
  if (cleaned.includes("wind")) return "Wind";
  if (cleaned.includes("infra")) return "Infrastructure";
  if (cleaned.includes("agriculture") || cleaned.includes("agri")) return "Agriculture";
  return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeCustomerCode(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(/\d+/);
  if (match) {
    const num = parseInt(match[0], 10);
    return `CUSTOMER-${num.toString().padStart(3, "0")}`;
  }
  return cleaned;
}

function cleanText(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "n/a" || trimmed === "-") return null;
  return trimmed;
}

function tryParseNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const cleaned = raw.replace(/,/g, "").replace(/₹|rs\.?/gi, "").trim();
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function tryParseDate(raw: string | null): string | null {
  if (raw === null) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const DATE_COLUMN_HINTS = [
  "date",
  "month",
];

const NUMBER_COLUMN_HINTS = [
  "amount",
  "value",
  "quantity",
  "qty",
];

/**
 * Converts a raw monday.com item (with column_values keyed by title) into a
 * clean, LLM-friendly record. Applies type-aware normalization based on column
 * title heuristics, since monday's "text" representation is a flat string
 * regardless of underlying column type.
 */
export function normalizeItem(item: MondayItem): CleanRecord {
  const fields: Record<string, string | number | null> = {};
  const missingFields: string[] = [];
  let junkSignals = 0;

  for (const cv of item.column_values) {
    const title = cv.column.title;
    const rawText = cleanText(cv.text);

    // Detect embedded duplicate-header junk rows (e.g. a data row where the
    // "Deal Status" cell literally contains the text "Deal Status").
    if (rawText && JUNK_VALUE_MARKERS.has(rawText.toLowerCase())) {
      junkSignals++;
    }

    const lowerTitle = title.toLowerCase();
    let value: string | number | null = rawText;

    if (rawText !== null && NUMBER_COLUMN_HINTS.some((h) => lowerTitle.includes(h))) {
      const num = tryParseNumber(rawText);
      value = num !== null ? num : rawText; // fall back to raw text if unparseable
    } else if (
      rawText !== null &&
      DATE_COLUMN_HINTS.some((h) => lowerTitle.includes(h)) &&
      !lowerTitle.includes("month of") // "Last executed month of recurring project" is a month name, not a date
    ) {
      const date = tryParseDate(rawText);
      value = date !== null ? date : rawText;
    } else if (rawText !== null) {
      // Normalize text fields: collapse casing inconsistencies on short label-like values
      if (lowerTitle.includes("sector") || lowerTitle.includes("service")) {
        value = normalizeSectorName(rawText);
      } else if (lowerTitle.includes("client") || lowerTitle.includes("customer")) {
        value = normalizeCustomerCode(rawText);
      } else {
        value = rawText;
      }
    }

    fields[title] = value;
    if (value === null) missingFields.push(title);
  }

  return {
    id: item.id,
    name: item.name,
    fields,
    missingFields,
    isJunkRow: junkSignals >= 2 || item.name.trim() === "",
  };
}

export function normalizeBoard(items: MondayItem[]): {
  records: CleanRecord[];
  junkRowsFiltered: number;
  dataQualitySummary: string;
} {
  const all = items.map(normalizeItem);
  const records = all.filter((r) => !r.isJunkRow);
  const junkRowsFiltered = all.length - records.length;

  const totalMissing = records.reduce((sum, r) => sum + r.missingFields.length, 0);
  const avgMissing = records.length ? (totalMissing / records.length).toFixed(1) : "0";

  const dataQualitySummary =
    `${records.length} usable records` +
    (junkRowsFiltered > 0 ? `, ${junkRowsFiltered} malformed/header rows filtered out` : "") +
    `, avg ${avgMissing} missing fields per record.`;

  return { records, junkRowsFiltered, dataQualitySummary };
}
