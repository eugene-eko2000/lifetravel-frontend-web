/**
 * Flight segment / endpoint formatting (no React).
 */
import type { TripLocationMaps, UnknownRecord } from "./tripShared";
import {
  formatDurationMinutesAsHoursMinutes,
  formatIsoDateLabel,
  isObject,
  pickArray,
  pickNumber,
  pickRecord,
  pickScalar,
  pickString,
} from "./tripShared";


export function looksLikeDatetimeString(s: string): boolean {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return t.includes("T") || /\d{1,2}:\d{2}/.test(t) || t.length > 10;
}

/** Formats ISO date or datetime for flight UI; shows time when the value includes it (or is a Unix ms timestamp). */
export function formatFlightDateTime(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const s = value.trim();
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (isoDateOnly) {
    const parts = s.split("-").map(Number);
    const y = parts[0];
    const m = parts[1];
    const day = parts[2];
    if (y == null || m == null || day == null) return s;
    const local = new Date(y, m - 1, day);
    return local.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return s.length > 48 ? `${s.slice(0, 45)}…` : s;
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Same inputs as {@link formatFlightDateTime} but omits times (flight row headers). */
export function formatFlightDateOnly(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    }
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return formatIsoDateLabel(s);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

type FlightEndpointFormatter = (value: unknown) => string | undefined;

export function collectStringFields(record: UnknownRecord, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

export function pickBestDateField(record: UnknownRecord, keys: string[]): string | undefined {
  const vals = collectStringFields(record, keys);
  return vals.find(looksLikeDatetimeString) ?? vals[0];
}

export function normalizeTimeForCombine(t: string): string {
  const x = t.trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(x)) {
    return x.length === 5 ? `${x}:00` : x;
  }
  return x;
}

/** Reads nested Amadeus/GDS-style { departure: { at } } / { arrival: { at } }. */
export function formatFlightEndpointFromNestedEndpoint(
  record: UnknownRecord,
  side: "departure" | "arrival",
  fmt: FlightEndpointFormatter = formatFlightDateTime
): string | undefined {
  const key = side === "departure" ? "departure" : "arrival";
  const v = record[key];
  if (!isObject(v)) return undefined;
  const nested = pickString(v, [
    "at",
    "dateTime",
    "datetime",
    "time",
    "localDateTime",
    "local_date_time",
    "iataDateTime",
  ]);
  if (nested) return fmt(nested);
  return undefined;
}

/** Amadeus flight-offer: all segments in order, then first segment departure / last segment arrival. */
export function collectAmadeusSegmentsInOrder(record: UnknownRecord): UnknownRecord[] {
  const itineraries = pickArray(record, ["itineraries"]) ?? [];
  const out: UnknownRecord[] = [];
  for (const it of itineraries) {
    if (!isObject(it)) continue;
    const segs = pickArray(it, ["segments"]) ?? [];
    for (const s of segs) {
      if (isObject(s)) out.push(s as UnknownRecord);
    }
  }
  return out;
}

/** Uses Amadeus-style nested `itineraries[].segments[]` when present. */
export function formatFlightEndpointFromAmadeusStyleTree(
  record: UnknownRecord,
  side: "departure" | "arrival",
  fmt: FlightEndpointFormatter = formatFlightDateTime
): string | undefined {
  const segments = collectAmadeusSegmentsInOrder(record);
  if (segments.length === 0) return undefined;
  const seg = side === "departure" ? segments[0] : segments[segments.length - 1];
  return formatFlightEndpointFromNestedEndpoint(seg, side, fmt);
}

/** Departure or arrival line for a flight or segment option (prefers full datetimes, else date+time fields). */
export function formatFlightEndpointDisplay(
  record: UnknownRecord,
  side: "departure" | "arrival",
  omitTime?: boolean
): string | undefined {
  const fmt = omitTime ? formatFlightDateOnly : formatFlightDateTime;
  const nested = formatFlightEndpointFromNestedEndpoint(record, side, fmt);
  if (nested) return nested;

  const fromAmadeus = formatFlightEndpointFromAmadeusStyleTree(record, side, fmt);
  if (fromAmadeus) return fromAmadeus;

  const options = pickArray(record, ["options"]);
  if (options?.length) {
    const candidates = options.filter(isObject) as UnknownRecord[];
    const first = candidates.length > 0 ? candidates[0] : undefined;
    if (first) {
      const fromOption = formatFlightEndpointFromAmadeusStyleTree(first, side, fmt);
      if (fromOption) return fromOption;
    }
  }

  const atKeys =
    side === "departure"
      ? [
          "depart_at",
          "departure_at",
          "departure_datetime",
          "depart_datetime",
          "departureDateTime",
          "departure_datetime_utc",
          "departure_date_time",
        ]
      : [
          "arrive_at",
          "arrival_at",
          "arrival_datetime",
          "arrive_datetime",
          "arrivalDateTime",
          "arrival_datetime_utc",
          "arrival_date_time",
        ];
  const dateKeys =
    side === "departure"
      ? ["depart_date", "departure_date", "departureDate"]
      : ["arrive_date", "arrival_date", "arrivalDate"];
  const timeKeys =
    side === "departure"
      ? ["depart_time", "departure_time", "departureTime"]
      : ["arrive_time", "arrival_time", "arrivalTime"];

  const flatAt = collectStringFields(record, atKeys);
  const bestAt = flatAt.find(looksLikeDatetimeString) ?? flatAt[0];
  if (bestAt) return fmt(bestAt);

  const datePart = pickBestDateField(record, dateKeys);
  const timeCandidates = collectStringFields(record, timeKeys);
  const timePart = timeCandidates[0];

  if (datePart && timePart) {
    const datePartIso = datePart.split("T")[0] ?? datePart;
    const combined = `${datePartIso}T${normalizeTimeForCombine(timePart)}`;
    return fmt(combined);
  }
  if (datePart) return fmt(datePart);

  const ts =
    side === "departure"
      ? pickNumber(record, ["departure_timestamp", "depart_timestamp", "departure_unix"])
      : pickNumber(record, ["arrival_timestamp", "arrive_timestamp", "arrival_unix"]);
  if (ts != null) return fmt(ts);

  const segmentsOnly = pickArray(record, ["segments"]);
  if (segmentsOnly?.length) {
    const wrapped = { itineraries: [{ segments: segmentsOnly }] } as UnknownRecord;
    const fromSegList = formatFlightEndpointFromAmadeusStyleTree(wrapped, side, fmt);
    if (fromSegList) return fromSegList;
  }

  return undefined;
}

/** Segments from Amadeus `itineraries` or a top-level `segments` array. */
export function collectSegmentsFromRecord(record: UnknownRecord): UnknownRecord[] {
  const fromAmadeusTree = collectAmadeusSegmentsInOrder(record);
  if (fromAmadeusTree.length > 0) return fromAmadeusTree;
  const direct = pickArray(record, ["segments"]) ?? [];
  return direct.filter(isObject) as UnknownRecord[];
}

/**
 * When `itineraries` has multiple entries (e.g. outbound + return), one group per itinerary.
 * Otherwise a single group of all segments (connecting flights within the same trip direction).
 */
export function collectSegmentGroupsFromRecord(record: UnknownRecord): UnknownRecord[][] {
  const itineraries = pickArray(record, ["itineraries"]) ?? [];
  const objs = itineraries.filter(isObject) as UnknownRecord[];
  if (objs.length > 1) {
    const groups = objs
      .map((itin) => {
        const segs = pickArray(itin, ["segments"]) ?? [];
        return segs.filter(isObject) as UnknownRecord[];
      })
      .filter((g) => g.length > 0);
    if (groups.length > 0) return groups;
  }
  const flat = collectSegmentsFromRecord(record);
  return flat.length > 0 ? [flat] : [];
}

/** Prefer first fare option when present; else the parent flight record. */
export function gatherFlightOfferSourceRecord(flight: UnknownRecord): UnknownRecord {
  const options = pickArray(flight, ["options"]) ?? [];
  const objs = options.filter(isObject) as UnknownRecord[];
  if (objs.length > 0) return objs[0];
  return flight;
}

/** Prefer first option when it carries segment data; else the flight record. */
export function gatherSegmentsForFlight(flight: UnknownRecord): UnknownRecord[] {
  const candidates: UnknownRecord[] = [gatherFlightOfferSourceRecord(flight), flight];
  for (const c of candidates) {
    const segs = collectSegmentsFromRecord(c);
    if (segs.length > 0) return segs;
  }
  return [];
}

export function getSegmentEndpoint(seg: UnknownRecord, side: "departure" | "arrival"): UnknownRecord | undefined {
  const v = seg[side];
  return isObject(v) ? v : undefined;
}

export function getSegmentEndpointIata(seg: UnknownRecord, side: "departure" | "arrival"): string | undefined {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return undefined;
  return pickString(ep, ["iataCode", "iata"]);
}

/** `from` / `to` on flight records: resolve to a single city name for headers. */
export function resolveFlightHeaderPlaceLabel(code: string | undefined, maps: TripLocationMaps): string | undefined {
  if (!code?.trim()) return undefined;
  const c = code.trim();
  const byCity = maps.cityCodeToName[c];
  if (byCity) return byCity;
  const meta = maps.airportToCityMeta[c];
  if (meta?.cityCode) {
    const name = maps.cityCodeToName[meta.cityCode];
    if (name) return name;
    return meta.cityCode;
  }
  return c;
}

/** City name only for itinerary summary (segment endpoints); dictionaries first, then inline `cityName`. */
export function getCityNameForSegmentEndpoint(
  airportIata: string | undefined,
  maps: TripLocationMaps,
  seg: UnknownRecord,
  side: "departure" | "arrival"
): string {
  if (airportIata) {
    const meta = maps.airportToCityMeta[airportIata];
    const cityIata = meta?.cityCode;
    if (cityIata) {
      const name = maps.cityCodeToName[cityIata];
      if (name) return name;
    }
  }
  const ep = getSegmentEndpoint(seg, side);
  if (ep) {
    const inline = pickString(ep, ["cityName", "city"]);
    if (inline) return inline;
  }
  return airportIata ?? "";
}

/**
 * One summary line per Amadeus-style itinerary (first → last segment).
 * `city`: overall flight headers — city names only.
 * `airport`: individual fare-option headers — airport IATA codes.
 */
export function formatSingleItinerarySummaryLine(
  itin: UnknownRecord,
  maps: TripLocationMaps,
  placeStyle: "city" | "airport" = "city"
): string | undefined {
  const segs = (pickArray(itin, ["segments"]) ?? []).filter(isObject) as UnknownRecord[];
  if (segs.length === 0) return undefined;
  const first = segs[0];
  const last = segs[segs.length - 1];
  const o = getSegmentEndpointIata(first, "departure");
  const d = getSegmentEndpointIata(last, "arrival");
  if (!o || !d) return undefined;
  const dep = formatFlightEndpointFromNestedEndpoint(first, "departure", formatFlightDateOnly);
  const arr = formatFlightEndpointFromNestedEndpoint(last, "arrival", formatFlightDateOnly);
  if (!dep || !arr) return undefined;
  const origin =
    placeStyle === "airport"
      ? o
      : getCityNameForSegmentEndpoint(o, maps, first, "departure");
  const dest =
    placeStyle === "airport" ? d : getCityNameForSegmentEndpoint(d, maps, last, "arrival");
  return `${origin} - ${dest} ${dep} - ${arr}`;
}

/** Non-empty only when `record.itineraries` has 2+ items (round-trip / multi-city in one offer). */
export function getMultiItinerarySummaryLines(
  record: UnknownRecord,
  maps: TripLocationMaps,
  placeStyle: "city" | "airport" = "city"
): string[] | undefined {
  const itins = (pickArray(record, ["itineraries"]) ?? []).filter(isObject) as UnknownRecord[];
  if (itins.length <= 1) return undefined;
  const lines = itins
    .map((itin) => formatSingleItinerarySummaryLine(itin, maps, placeStyle))
    .filter((x): x is string => Boolean(x));
  return lines.length > 0 ? lines : undefined;
}

/** Airport IATA codes for a fare option route line (first departure → last arrival in flattened segments). */
export function pickFlightOptionRouteAirportCodes(opt: UnknownRecord, parentFlight: UnknownRecord): { from?: string; to?: string } {
  const flat = collectSegmentsFromRecord(opt);
  if (flat.length >= 1) {
    return {
      from: getSegmentEndpointIata(flat[0], "departure"),
      to: getSegmentEndpointIata(flat[flat.length - 1], "arrival"),
    };
  }
  const from =
    pickString(opt, ["from", "origin", "departure_city"]) ?? pickString(parentFlight, ["from", "origin"]);
  const to =
    pickString(opt, ["to", "destination", "arrival_city"]) ?? pickString(parentFlight, ["to", "destination"]);
  return { from, to };
}

export function itineraryGroupLabel(groupIndex: number, groupCount: number): string {
  if (groupCount === 2) return groupIndex === 0 ? "Outbound" : "Return";
  return `Leg ${groupIndex + 1}`;
}

export function formatAirportLineWithMaps(seg: UnknownRecord, side: "departure" | "arrival", maps: TripLocationMaps): string {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return "—";
  const iata = pickString(ep, ["iataCode", "iata"]);
  const terminal = pickString(ep, ["terminal"]);
  const inlineCity = pickString(ep, ["cityName", "city"]);

  let cityName: string | undefined;
  if (iata && maps.airportToCityMeta[iata]) {
    const cityIata = maps.airportToCityMeta[iata].cityCode;
    if (cityIata) cityName = maps.cityCodeToName[cityIata];
  }
  if (!cityName) cityName = inlineCity;

  const parts: string[] = [];
  if (iata) parts.push(iata);
  if (cityName) parts.push(cityName);
  if (terminal) parts.push(`Terminal ${terminal}`);
  return parts.join(" · ") || "—";
}

/** Carrier + flight number line for a segment. */
export function formatSegmentCarrier(seg: UnknownRecord): string {
  const carrier = pickString(seg, ["carrierCode", "carrier"]);
  const n = seg.number ?? seg.flight_number;
  const num =
    typeof n === "number" && Number.isFinite(n)
      ? String(n)
      : typeof n === "string" && n.trim()
        ? n.trim()
        : pickString(seg, ["number", "flight_number"]);
  if (carrier && num) return `${carrier} ${num}`;
  const airline = pickString(seg, ["airline", "operatingCarrier"]);
  if (airline) return num ? `${airline} ${num}` : airline;
  return pickString(seg, ["flightNumber"]) ?? "Flight";
}

/** Amadeus segment id for matching `fareDetailsBySegment.segmentId`. */
function getSegmentIdForFareMatching(seg: UnknownRecord): string | undefined {
  return pickString(seg, ["id", "segmentId"]);
}

export function toTitleCaseWords(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatCabinClassLabel(cabin: unknown): string | undefined {
  if (typeof cabin !== "string" || !cabin.trim()) return undefined;
  return toTitleCaseWords(cabin);
}

function pickNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return undefined;
}

/**
 * Checked/cabin bags: when weight (+ unit) is present → `{n} x {weight}{unit}` (per-bag weight).
 * Quantity defaults to 1 if omitted. Without weight → `{n} bag(s)` from quantity only.
 */
export function formatFareBagsLine(bags: unknown): string | undefined {
  if (bags == null) return undefined;
  if (!isObject(bags)) return undefined;
  const w = bags.weight ?? bags.maximumWeight ?? bags.maxWeight;
  const weightStr =
    typeof w === "number" && Number.isFinite(w)
      ? String(w)
      : typeof w === "string" && w.trim()
        ? w.trim()
        : pickScalar(bags, ["weight", "maximumWeight", "maxWeight"]);
  if (weightStr) {
    const unit = (pickString(bags, ["weightUnit", "unit"]) ?? "kg").toLowerCase();
    const qty = pickNonNegativeInt(bags.quantity) ?? 1;
    return `${qty} x ${weightStr}${unit}`;
  }
  const qty = pickNonNegativeInt(bags.quantity);
  if (qty != null) return `${qty} bag${qty === 1 ? "" : "s"}`;
  return undefined;
}

/** First traveler with non-empty fareDetailsBySegment (typical: ADULT). */
export function getFirstTravelerFareDetailsBySegment(offerLike: UnknownRecord): UnknownRecord[] {
  const tps = pickArray(offerLike, ["travelerPricings"]) ?? [];
  for (const tp of tps) {
    if (!isObject(tp)) continue;
    const fds = pickArray(tp, ["fareDetailsBySegment"]) ?? [];
    const objs = fds.filter(isObject) as UnknownRecord[];
    if (objs.length > 0) return objs;
  }
  return [];
}

export function buildFareDetailBySegmentId(fareDetails: UnknownRecord[]): Map<string, UnknownRecord> {
  const map = new Map<string, UnknownRecord>();
  for (const fd of fareDetails) {
    const sid = pickString(fd, ["segmentId", "segment_id"]);
    if (sid) map.set(sid, fd);
  }
  return map;
}

export function resolveFareDetailForSegment(
  seg: UnknownRecord,
  segmentIndex: number,
  fareDetailsInOrder: UnknownRecord[],
  byId: Map<string, UnknownRecord>
): UnknownRecord | undefined {
  const segId = getSegmentIdForFareMatching(seg);
  if (segId) {
    const hit = byId.get(segId);
    if (hit) return hit;
  }
  if (segmentIndex >= 0 && segmentIndex < fareDetailsInOrder.length) {
    return fareDetailsInOrder[segmentIndex];
  }
  return undefined;
}

/** Amadeus-style fare detail: checked/cabin bags field names vary slightly across payloads. */
export function pickFareBagsField(fd: UnknownRecord, kind: "checked" | "cabin"): unknown {
  if (kind === "checked") {
    return fd.includedCheckedBags ?? fd.checkedBags;
  }
  return fd.includedCabinBags ?? fd.cabinBags;
}

function parseAtFromSegment(seg: UnknownRecord, side: "departure" | "arrival"): Date | null {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return null;
  const at = pickString(ep, ["at", "dateTime", "localDateTime", "datetime"]);
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatConnectionLayover(prev: UnknownRecord, next: UnknownRecord): string | null {
  const arr = parseAtFromSegment(prev, "arrival");
  const dep = parseAtFromSegment(next, "departure");
  if (!arr || !dep || dep.getTime() <= arr.getTime()) return null;
  const mins = Math.round((dep.getTime() - arr.getTime()) / 60000);
  return formatDurationMinutesAsHoursMinutes(mins);
}
