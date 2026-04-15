/**
 * Shared types and pure helpers for trip / ranked payloads.
 */

export type UnknownRecord = Record<string, unknown>;

export type TripLocationMaps = {
  airportToCityMeta: Record<string, { cityCode?: string; countryCode?: string }>;
  cityCodeToName: Record<string, string>;
};

export function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function pickString(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

export function pickArray(obj: UnknownRecord, keys: string[]): unknown[] | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

export function pickNumber(obj: UnknownRecord, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** String or number amounts (Amadeus often uses string decimals). */
export function pickScalar(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function formatDurationMinutesAsHoursMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "";
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function pickRecord(obj: UnknownRecord, keys: string[]): UnknownRecord | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (isObject(v)) return v;
  }
  return undefined;
}

/** Reads `locations_dictionary` and airport→city meta from `flight_dictionaries.locations` or `airport_dictionaries`. */
export function extractTripLocationMaps(ranked: UnknownRecord): TripLocationMaps {
  const cityCodeToName: Record<string, string> = {};
  const locDict = pickRecord(ranked, ["locations_dictionary"]);
  if (locDict) {
    for (const [k, v] of Object.entries(locDict)) {
      if (typeof v === "string" && v.trim()) cityCodeToName[k] = v.trim();
    }
  }

  const airportToCityMeta: Record<string, { cityCode?: string; countryCode?: string }> = {};
  const mergeAirportMap = (m: UnknownRecord | undefined) => {
    if (!m) return;
    for (const [code, v] of Object.entries(m)) {
      if (!isObject(v)) continue;
      const o = v as UnknownRecord;
      airportToCityMeta[code] = {
        cityCode: pickString(o, ["cityCode", "city_code"]),
        countryCode: pickString(o, ["countryCode", "country_code"]),
      };
    }
  };

  const fd = pickRecord(ranked, ["flight_dictionaries"]);
  const locFromFlight = fd ? pickRecord(fd, ["locations"]) : undefined;
  mergeAirportMap(locFromFlight);
  if (Object.keys(airportToCityMeta).length === 0) {
    mergeAirportMap(pickRecord(ranked, ["airport_dictionaries"]));
  }

  return { airportToCityMeta, cityCodeToName };
}

/** IATA carrier code → airline name from `flight_dictionaries.carriers` (Amadeus-style). */
export function extractFlightCarriersMap(ranked: UnknownRecord): Record<string, string> {
  const out: Record<string, string> = {};
  const fd = pickRecord(ranked, ["flight_dictionaries"]);
  const carriers = fd ? pickRecord(fd, ["carriers"]) : undefined;
  if (!carriers) return out;
  for (const [k, v] of Object.entries(carriers)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const code = k.trim().toUpperCase();
    if (code) out[code] = v.trim();
  }
  return out;
}

export function asIsoDate(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : undefined;
}

/** Formats YYYY-MM-DD for trip summary (matches flight date-only display style). */
export function formatIsoDateLabel(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const day = parts[2];
  if (y == null || m == null || day == null) return isoDate;
  const local = new Date(y, m - 1, day);
  return local.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Start/end from summary when present; otherwise falls back to total duration days. */
export function formatTripSummaryDates(
  startIso: string | undefined,
  endIso: string | undefined,
  totalDurationDays: number | undefined
): string {
  if (startIso && endIso) {
    return `${formatIsoDateLabel(startIso)} → ${formatIsoDateLabel(endIso)}`;
  }
  if (startIso) return `${formatIsoDateLabel(startIso)} → —`;
  if (endIso) return `— → ${formatIsoDateLabel(endIso)}`;
  if (totalDurationDays != null) return `${totalDurationDays} days`;
  return "—";
}

/** Resolved city name for hotel stays (`locations_dictionary` is keyed by city code); falls back to code. */
export function formatHotelCityLine(cityCode: string | undefined, maps: TripLocationMaps): string {
  if (!cityCode?.trim()) return "";
  const code = cityCode.trim();
  const name = maps.cityCodeToName[code];
  if (name) return name;
  return code;
}

/** Default shell for a single fare/hotel option card. */
export const DEFAULT_OPTION_CARD_CLASS = "border-border/70 bg-background/70";

/** First option in a ranked list (green border + tint), surfaces at 70% opacity. */
export const TOP_OPTION_CARD_CLASS =
  "border-emerald-500/70 bg-emerald-950/70 ring-1 ring-inset ring-emerald-400/25";

/** Inset for expanded flight/hotel option lists under a leg row. */
export const LEG_OPTION_PANEL_CLASS =
  "border-t border-border/70 bg-background/70 px-2.5 py-2 space-y-2 rounded-b-lg sm:px-3 sm:py-2.5";

export function randomSortableSuffix(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `opt-${Math.random().toString(36).slice(2)}`;
}

/** Stable id per option object so SortableContext `items` order changes when data reorders (index-only ids break dnd-kit). */
const flightOptionSortableSuffix = new WeakMap<UnknownRecord, string>();
const hotelOptionSortableSuffix = new WeakMap<UnknownRecord, string>();

export function getFlightOptionSortableId(opt: UnknownRecord, legIndex: number, flightIndex: number): string {
  let suffix = flightOptionSortableSuffix.get(opt);
  if (!suffix) {
    const explicit = pickString(opt, ["id", "offer_id", "offerId", "option_id"]);
    suffix = explicit ? `${explicit}::${randomSortableSuffix()}` : randomSortableSuffix();
    flightOptionSortableSuffix.set(opt, suffix);
  }
  return `flight-${legIndex}-${flightIndex}-${suffix}`;
}

export function getHotelOptionSortableId(opt: UnknownRecord, legIndex: number, hotelIndex: number): string {
  let suffix = hotelOptionSortableSuffix.get(opt);
  if (!suffix) {
    const h = isObject(opt.hotel) ? (opt.hotel as UnknownRecord) : undefined;
    const explicit =
      pickString(opt, ["id", "option_id"]) ?? (h ? pickString(h, ["hotel_id"]) : undefined);
    suffix = explicit ? `${explicit}::${randomSortableSuffix()}` : randomSortableSuffix();
    hotelOptionSortableSuffix.set(opt, suffix);
  }
  return `hotel-${legIndex}-${hotelIndex}-${suffix}`;
}
