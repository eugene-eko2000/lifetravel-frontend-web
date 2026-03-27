"use client";

import { Fragment, createContext, useContext, useState } from "react";

const ItineraryCurrencyContext = createContext<string | undefined>(undefined);

function useItineraryCurrency(): string | undefined {
  return useContext(ItineraryCurrencyContext);
}

type UnknownRecord = Record<string, unknown>;
/** Inset for expanded options so card text lines up with row header (p-3 + chevron w-4 + gap-2). */
const LEG_OPTION_PANEL_CLASS = "border-t border-border bg-background/25 pl-6 pr-3 py-2 space-y-2 rounded-b-lg";

function isObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function pickArray(obj: UnknownRecord, keys: string[]): unknown[] | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

export function looksLikeItinerary(data: unknown): boolean {
  if (!isObject(data)) return false;

  // common shapes: { itinerary: {...} } or { ranked_itinerary: {...} } or { ranked: {...} }
  if ("itinerary" in data && isObject(data.itinerary)) return true;
  if ("ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) return true;
  if ("ranked" in data && isObject((data as UnknownRecord).ranked)) return true;
  if (Array.isArray((data as UnknownRecord).days)) return true;
  if (Array.isArray((data as UnknownRecord).day_plans)) return true;
  if (Array.isArray((data as UnknownRecord).dayPlans)) return true;

  // sometimes nested under "data"
  if ("data" in data && isObject(data.data)) {
    const inner = data.data;
    if ("itinerary" in inner && isObject(inner.itinerary)) return true;
    if ("ranked_itinerary" in inner && isObject((inner as UnknownRecord).ranked_itinerary)) return true;
    if ("ranked" in inner && isObject((inner as UnknownRecord).ranked)) return true;
    if (Array.isArray((inner as UnknownRecord).days)) return true;
    if (Array.isArray((inner as UnknownRecord).day_plans)) return true;
    if (Array.isArray((inner as UnknownRecord).dayPlans)) return true;
  }

  return false;
}

function pickNumber(obj: UnknownRecord, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** String or number amounts (Amadeus often uses string decimals). */
function pickScalar(obj: UnknownRecord, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** Primary = itinerary; optional original = billing currency from `price.currency`. */
type DualPriceParts = { primary: string; original?: string };

function DualPriceDisplay({ parts }: { parts: DualPriceParts | undefined }) {
  if (!parts) return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span>{parts.primary}</span>
      {parts.original ? (
        <span className="text-[0.82em] text-muted"> ({parts.original})</span>
      ) : null}
    </span>
  );
}

/**
 * Amadeus flight/offer price: itinerary amount first (`704.13 CHF`), then original (`767.01 EUR`) when it differs.
 */
function formatAmadeusDualPriceParts(price: UnknownRecord, itineraryCurrency?: string): DualPriceParts | undefined {
  const origCur = pickString(price, ["currency"]);
  const origAmt = pickScalar(price, ["grandTotal", "total"]);
  const originalLine = origCur && origAmt ? `${origAmt} ${origCur}` : undefined;

  if (itineraryCurrency) {
    const itinAmt = pickScalar(price, [
      "grandTotal_itinerary_currency",
      "total_itinerary_currency",
      "base_itinerary_currency",
    ]);
    if (itinAmt) {
      const primary = `${itinAmt} ${itineraryCurrency}`;
      if (originalLine && origCur && origCur !== itineraryCurrency) {
        return { primary, original: originalLine };
      }
      return { primary };
    }
  }
  if (originalLine) return { primary: originalLine };
  return undefined;
}

function formatHotelDualPriceParts(opt: UnknownRecord, itineraryCurrency?: string): DualPriceParts | undefined {
  const r = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  const offers = pickArray(opt, ["offers"]) ?? [];
  const first = offers.find(isObject) as UnknownRecord | undefined;
  const price = first ? pickRecord(first, ["price"]) : undefined;
  const variations = price ? pickRecord(price, ["variations"]) : undefined;
  const average = variations ? pickRecord(variations, ["average"]) : undefined;
  const origCur = price ? pickString(price, ["currency"]) : undefined;

  if (itineraryCurrency) {
    const fromRanking = r ? pickScalar(r, ["price_per_night_itinerary_currency"]) : undefined;
    if (fromRanking && r) {
      const primary = `${fromRanking} ${itineraryCurrency}/night`;
      const origPn = pickNumber(r, ["price_per_night"]);
      if (origPn != null && origCur && origCur !== itineraryCurrency) {
        return { primary, original: `${origPn} ${origCur}/night` };
      }
      return { primary };
    }
    if (average) {
      const itinPerNight = pickScalar(average, ["total_itinerary_currency", "base_itinerary_currency"]);
      const origPerNight = pickScalar(average, ["total", "base"]);
      if (itinPerNight) {
        const primary = `${itinPerNight} ${itineraryCurrency}/night`;
        if (origPerNight && origCur && origCur !== itineraryCurrency) {
          return { primary, original: `${origPerNight} ${origCur}/night` };
        }
        return { primary };
      }
    }
  }
  const num = r ? pickNumber(r, ["price_per_night"]) : undefined;
  if (num == null) return undefined;
  return { primary: `${num}/night` };
}

function flightSummaryParts(summary: UnknownRecord, itineraryCurrency?: string): DualPriceParts | undefined {
  const itinCur = itineraryCurrency;
  const flightsCur = pickString(summary, ["flights_currency"]);
  const itinOnly = pickScalar(summary, ["total_flights_cost_itinerary_currency"]);
  const raw = pickScalar(summary, ["total_flights_cost"]);

  if (itinOnly && itinCur) {
    const primary = `${itinOnly} ${itinCur}`;
    if (raw && flightsCur && flightsCur !== itinCur) {
      return { primary, original: `${raw} ${flightsCur}` };
    }
    return { primary };
  }
  if (raw && (itinCur ?? flightsCur)) {
    return { primary: `${raw} ${itinCur ?? flightsCur}` };
  }
  return undefined;
}

function hotelSummaryParts(summary: UnknownRecord, itineraryCurrency?: string): DualPriceParts | undefined {
  const itinCur = itineraryCurrency;
  const hotelsCur = pickString(summary, ["hotels_currency"]);
  const itinOnly = pickScalar(summary, ["total_hotels_cost_itinerary_currency"]);
  const raw = pickScalar(summary, ["total_hotels_cost"]);

  if (itinOnly && itinCur) {
    const primary = `${itinOnly} ${itinCur}`;
    if (raw && hotelsCur && hotelsCur !== itinCur) {
      return { primary, original: `${raw} ${hotelsCur}` };
    }
    return { primary };
  }
  if (raw && (itinCur ?? hotelsCur)) {
    return { primary: `${raw} ${itinCur ?? hotelsCur}` };
  }
  return undefined;
}

/** Rounds total minutes and formats as hours + minutes (e.g. 1030 → "17h 10m", 45 → "45m"). */
function formatDurationMinutesAsHoursMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "";
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function pickRecord(obj: UnknownRecord, keys: string[]): UnknownRecord | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (isObject(v)) return v;
  }
  return undefined;
}

function asIsoDate(value: unknown): string | undefined {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : undefined;
}

function looksLikeDatetimeString(s: string): boolean {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  return t.includes("T") || /\d{1,2}:\d{2}/.test(t) || t.length > 10;
}

/** Formats ISO date or datetime for flight UI; shows time when the value includes it (or is a Unix ms timestamp). */
function formatFlightDateTime(value: unknown): string | undefined {
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

function collectStringFields(record: UnknownRecord, keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  return out;
}

function pickBestDateField(record: UnknownRecord, keys: string[]): string | undefined {
  const vals = collectStringFields(record, keys);
  return vals.find(looksLikeDatetimeString) ?? vals[0];
}

function normalizeTimeForCombine(t: string): string {
  const x = t.trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(x)) {
    return x.length === 5 ? `${x}:00` : x;
  }
  return x;
}

/** Reads nested Amadeus/GDS-style { departure: { at } } / { arrival: { at } }. */
function formatFlightEndpointFromNestedEndpoint(record: UnknownRecord, side: "departure" | "arrival"): string | undefined {
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
  if (nested) return formatFlightDateTime(nested);
  return undefined;
}

/** Amadeus flight-offer: all segments in order, then first segment departure / last segment arrival. */
function collectAmadeusSegmentsInOrder(record: UnknownRecord): UnknownRecord[] {
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

function formatFlightEndpointFromAmadeusItineraries(record: UnknownRecord, side: "departure" | "arrival"): string | undefined {
  const segments = collectAmadeusSegmentsInOrder(record);
  if (segments.length === 0) return undefined;
  const seg = side === "departure" ? segments[0] : segments[segments.length - 1];
  return formatFlightEndpointFromNestedEndpoint(seg, side);
}

/** Departure or arrival line for a flight or segment option (prefers full datetimes, else date+time fields). */
function formatFlightEndpointDisplay(record: UnknownRecord, side: "departure" | "arrival"): string | undefined {
  const nested = formatFlightEndpointFromNestedEndpoint(record, side);
  if (nested) return nested;

  const fromAmadeus = formatFlightEndpointFromAmadeusItineraries(record, side);
  if (fromAmadeus) return fromAmadeus;

  const options = pickArray(record, ["options"]);
  if (options?.length) {
    const candidates = options.filter(isObject) as UnknownRecord[];
    const ranked =
      bestByRankingScore(candidates) ?? (candidates.length > 0 ? candidates[0] : undefined);
    if (ranked) {
      const fromOption = formatFlightEndpointFromAmadeusItineraries(ranked, side);
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
  if (bestAt) return formatFlightDateTime(bestAt);

  const datePart = pickBestDateField(record, dateKeys);
  const timeCandidates = collectStringFields(record, timeKeys);
  const timePart = timeCandidates[0];

  if (datePart && timePart) {
    const dateOnly = datePart.split("T")[0] ?? datePart;
    const combined = `${dateOnly}T${normalizeTimeForCombine(timePart)}`;
    return formatFlightDateTime(combined);
  }
  if (datePart) return formatFlightDateTime(datePart);

  const ts =
    side === "departure"
      ? pickNumber(record, ["departure_timestamp", "depart_timestamp", "departure_unix"])
      : pickNumber(record, ["arrival_timestamp", "arrive_timestamp", "arrival_unix"]);
  if (ts != null) return formatFlightDateTime(ts);

  const segmentsOnly = pickArray(record, ["segments"]);
  if (segmentsOnly?.length) {
    const wrapped = { itineraries: [{ segments: segmentsOnly }] } as UnknownRecord;
    const fromSegList = formatFlightEndpointFromAmadeusItineraries(wrapped, side);
    if (fromSegList) return fromSegList;
  }

  return undefined;
}

function bestByRankingScore(options: unknown[]): UnknownRecord | undefined {
  const candidates = options.filter(isObject);
  if (candidates.length === 0) return undefined;
  return candidates
    .map((o) => {
      const ranking = isObject(o._ranking) ? (o._ranking as UnknownRecord) : undefined;
      const score = ranking ? pickNumber(ranking, ["score"]) ?? -Infinity : -Infinity;
      return { o, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.o;
}

/** Segments from Amadeus itineraries or a top-level `segments` array. */
function collectSegmentsFromRecord(record: UnknownRecord): UnknownRecord[] {
  const fromItin = collectAmadeusSegmentsInOrder(record);
  if (fromItin.length > 0) return fromItin;
  const direct = pickArray(record, ["segments"]) ?? [];
  return direct.filter(isObject) as UnknownRecord[];
}

/** Prefer best-ranked option when it carries segment data; else the flight record. */
function gatherSegmentsForFlight(flight: UnknownRecord): UnknownRecord[] {
  const options = pickArray(flight, ["options"]) ?? [];
  const best = bestByRankingScore(options);
  const candidates: UnknownRecord[] = [];
  if (best) candidates.push(best);
  candidates.push(flight);
  for (const c of candidates) {
    const segs = collectSegmentsFromRecord(c);
    if (segs.length > 0) return segs;
  }
  return [];
}

function getSegmentEndpoint(seg: UnknownRecord, side: "departure" | "arrival"): UnknownRecord | undefined {
  const v = seg[side];
  return isObject(v) ? v : undefined;
}

function formatAirportLine(seg: UnknownRecord, side: "departure" | "arrival"): string {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return "—";
  const iata = pickString(ep, ["iataCode", "iata"]);
  const city = pickString(ep, ["cityName", "city"]);
  const terminal = pickString(ep, ["terminal"]);
  const parts = [iata, city].filter(Boolean);
  if (terminal) parts.push(`Terminal ${terminal}`);
  return parts.join(" · ") || "—";
}

function formatSegmentCarrier(seg: UnknownRecord): string {
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

function parseAtFromSegment(seg: UnknownRecord, side: "departure" | "arrival"): Date | null {
  const ep = getSegmentEndpoint(seg, side);
  if (!ep) return null;
  const at = pickString(ep, ["at", "dateTime", "localDateTime", "datetime"]);
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatConnectionLayover(prev: UnknownRecord, next: UnknownRecord): string | null {
  const arr = parseAtFromSegment(prev, "arrival");
  const dep = parseAtFromSegment(next, "departure");
  if (!arr || !dep || dep.getTime() <= arr.getTime()) return null;
  const mins = Math.round((dep.getTime() - arr.getTime()) / 60000);
  return formatDurationMinutesAsHoursMinutes(mins);
}

function getLegPriceParts(
  flight: UnknownRecord,
  best: UnknownRecord | undefined,
  itineraryCurrency?: string,
): DualPriceParts | undefined {
  const fromRecord = (rec: UnknownRecord | undefined) => {
    if (!rec) return undefined;
    const p = pickRecord(rec, ["price"]);
    if (!p) return undefined;
    return formatAmadeusDualPriceParts(p, itineraryCurrency);
  };
  return fromRecord(best) ?? fromRecord(flight);
}

/** Prefer explicit `legs`; otherwise one synthetic leg from top-level flights + hotels. */
function getLegsFromRanked(ranked: UnknownRecord): UnknownRecord[] {
  const legs = pickArray(ranked, ["legs", "itinerary_legs", "segments", "trip_segments"]);
  if (legs && legs.length > 0) {
    return legs.filter(isObject);
  }
  const flights = pickArray(ranked, ["flights"]) ?? [];
  const hotels = pickArray(ranked, ["hotels"]) ?? [];
  if (flights.length === 0 && hotels.length === 0) return [];
  return [{ flights, hotels } as UnknownRecord];
}

function FlightOptionMetaLine({ opt }: { opt: UnknownRecord }) {
  const itineraryCurrency = useItineraryCurrency();
  const price = isObject(opt.price) ? (opt.price as UnknownRecord) : undefined;
  const parts = price ? formatAmadeusDualPriceParts(price, itineraryCurrency) : undefined;
  const ranking = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  const durationMinutes = ranking ? pickNumber(ranking, ["duration_minutes"]) : undefined;
  const stops = ranking ? pickNumber(ranking, ["stops"]) : undefined;
  if (parts == null && durationMinutes == null && stops == null) return null;
  return (
    <p className="mt-1 text-xs text-muted flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {parts ? <DualPriceDisplay parts={parts} /> : null}
      {durationMinutes != null ? (
        <>
          {parts ? <span className="text-muted">·</span> : null}
          <span>{formatDurationMinutesAsHoursMinutes(durationMinutes)}</span>
        </>
      ) : null}
      {stops != null ? (
        <>
          {(parts || durationMinutes != null) ? <span className="text-muted">·</span> : null}
          <span>{stops} stops</span>
        </>
      ) : null}
    </p>
  );
}

/** First line matches parent flight row: route (from → to) | dates; falls back to parent segment when option omits fields. */
function FlightOptionBox({
  opt,
  optionIndex,
  parentFlight,
  parentFlightIndex,
}: {
  opt: UnknownRecord;
  optionIndex: number;
  parentFlight: UnknownRecord;
  parentFlightIndex: number;
}) {
  const itineraryCurrency = useItineraryCurrency();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const from =
    pickString(opt, ["from", "origin", "departure_city"]) ?? pickString(parentFlight, ["from", "origin"]);
  const to =
    pickString(opt, ["to", "destination", "arrival_city"]) ?? pickString(parentFlight, ["to", "destination"]);
  const routeTitle = [from, to].filter(Boolean).join(" → ");
  const airline = pickString(opt, ["airline", "carrier", "validating_airline", "marketing_airline"]);
  const flightNo = pickString(opt, ["flight_number", "number", "flight"]);
  const title =
    routeTitle ||
    [airline, flightNo].filter(Boolean).join(" ") ||
    airline ||
    `Flight ${optionIndex + 1}`;

  const depart =
    formatFlightEndpointDisplay(opt, "departure") ?? formatFlightEndpointDisplay(parentFlight, "departure");
  const arrive =
    formatFlightEndpointDisplay(opt, "arrival") ?? formatFlightEndpointDisplay(parentFlight, "arrival");
  const dateRight = [depart, arrive].filter(Boolean).join(" → ");
  const legPriceParts = getLegPriceParts(opt, undefined, itineraryCurrency);
  const detailId = `flight-${parentFlightIndex}-opt-${optionIndex}`;

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={detailId}
        id={`${detailId}-summary`}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {detailsOpen ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{title}</p>
            {dateRight ? <p className="text-xs text-muted shrink-0">{dateRight}</p> : null}
          </div>
          <FlightOptionMetaLine opt={opt} />
        </div>
      </button>
      {detailsOpen && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-3 py-3"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Leg price</p>
              <p className="text-sm font-semibold text-foreground">
                {legPriceParts ? <DualPriceDisplay parts={legPriceParts} /> : "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(false);
              }}
              className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              Collapse
            </button>
          </div>
          <FlightSegmentDetailList flight={parentFlight} segmentsFrom={opt} />
        </div>
      )}
    </div>
  );
}

/** First line matches parent hotel row: hotel name | stay dates; uses parent stay when option omits fields. */
function HotelOptionBox({
  opt,
  optionIndex,
  parentStay,
}: {
  opt: UnknownRecord;
  optionIndex: number;
  parentStay: UnknownRecord;
}) {
  const itineraryCurrency = useItineraryCurrency();
  const h = isObject(opt.hotel) ? (opt.hotel as UnknownRecord) : undefined;
  const name = h ? pickString(h, ["name", "chain", "brand"]) : undefined;
  const parentCity = pickString(parentStay, ["city_code", "city"]);
  const title = name ?? parentCity ?? `Hotel ${optionIndex + 1}`;

  const cityCode = h ? pickString(h, ["city_code", "city"]) : undefined;
  const hotelParts = formatHotelDualPriceParts(opt, itineraryCurrency);

  const checkInOpt = h ? asIsoDate(pickString(h, ["check_in", "checkIn"])) : undefined;
  const checkOutOpt = h ? asIsoDate(pickString(h, ["check_out", "checkOut"])) : undefined;
  const checkInParent = asIsoDate(parentStay.check_in);
  const checkOutParent = asIsoDate(parentStay.check_out);
  const dateRight = [checkInOpt ?? checkInParent, checkOutOpt ?? checkOutParent].filter(Boolean).join(" → ");

  const secondLineCity = cityCode ?? parentCity;
  const hasSecondLine = secondLineCity || hotelParts;

  return (
    <div className="rounded-lg border border-border/80 bg-background/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {dateRight ? <p className="text-xs text-muted shrink-0">{dateRight}</p> : null}
      </div>
      {hasSecondLine ? (
        <p className="mt-1 text-xs text-muted flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {secondLineCity ? <span>{secondLineCity}</span> : null}
          {secondLineCity && hotelParts ? <span className="text-muted">·</span> : null}
          {hotelParts ? <DualPriceDisplay parts={hotelParts} /> : null}
        </p>
      ) : null}
    </div>
  );
}

function FlightSegmentFallback({ flight }: { flight: UnknownRecord }) {
  const dep = formatFlightEndpointDisplay(flight, "departure");
  const arr = formatFlightEndpointDisplay(flight, "arrival");
  const from = pickString(flight, ["from", "origin"]);
  const to = pickString(flight, ["to", "destination"]);
  return (
    <div className="rounded-md border border-border/50 bg-background/30 p-3">
      <p className="text-sm font-medium text-foreground">{[from, to].filter(Boolean).join(" → ") || "Route"}</p>
      <p className="mt-1 text-xs text-muted">{[dep, arr].filter(Boolean).join(" → ") || "—"}</p>
      <p className="mt-2 text-[10px] leading-snug text-muted">
        Per-segment breakdown is not available for this itinerary.
      </p>
    </div>
  );
}

function FlightSegmentConnectionRow({ prev, next }: { prev: UnknownRecord; next: UnknownRecord }) {
  const layover = formatConnectionLayover(prev, next);
  const hub = formatAirportLine(next, "departure");
  if (!layover) return null;
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-background/20 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">Connection</span>
      <span className="text-muted"> at {hub}</span>
      <span className="text-muted"> · {layover}</span>
    </div>
  );
}

function FlightSegmentCard({ seg, index, total }: { seg: UnknownRecord; index: number; total: number }) {
  const dep = formatFlightEndpointFromNestedEndpoint(seg, "departure");
  const arr = formatFlightEndpointFromNestedEndpoint(seg, "arrival");
  const carrier = formatSegmentCarrier(seg);
  const depLoc = formatAirportLine(seg, "departure");
  const arrLoc = formatAirportLine(seg, "arrival");
  return (
    <div className="rounded-md border border-border/50 bg-background/30 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
        Segment {index + 1}
        {total > 1 ? ` of ${total}` : ""}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{carrier}</p>
      <dl className="mt-2 space-y-2 text-xs">
        <div>
          <dt className="text-[10px] font-medium uppercase text-muted">Departure</dt>
          <dd className="mt-0.5 text-foreground">{depLoc}</dd>
          <dd className="text-muted">{dep ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase text-muted">Arrival</dt>
          <dd className="mt-0.5 text-foreground">{arrLoc}</dd>
          <dd className="text-muted">{arr ?? "—"}</dd>
        </div>
      </dl>
    </div>
  );
}

function FlightSegmentDetailList({
  flight,
  segmentsFrom,
}: {
  flight: UnknownRecord;
  /** When set (e.g. a fare option), segments are read from this record only. */
  segmentsFrom?: UnknownRecord;
}) {
  const segments =
    segmentsFrom !== undefined ? collectSegmentsFromRecord(segmentsFrom) : gatherSegmentsForFlight(flight);
  const fallbackRecord = segmentsFrom ?? flight;
  if (segments.length === 0) {
    return <FlightSegmentFallback flight={fallbackRecord} />;
  }
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          <FlightSegmentCard seg={seg} index={i} total={segments.length} />
          {i < segments.length - 1 ? <FlightSegmentConnectionRow prev={segments[i]} next={segments[i + 1]} /> : null}
        </Fragment>
      ))}
    </div>
  );
}

function FlightRow({ flight, labelIndex }: { flight: UnknownRecord; labelIndex: number }) {
  const itineraryCurrency = useItineraryCurrency();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const from = pickString(flight, ["from"]);
  const to = pickString(flight, ["to"]);
  const depart = formatFlightEndpointDisplay(flight, "departure");
  const arrive = formatFlightEndpointDisplay(flight, "arrival");
  const options = pickArray(flight, ["options"]) ?? [];
  const best = bestByRankingScore(options);
  const legPriceParts = getLegPriceParts(flight, best, itineraryCurrency);
  const durationMinutes =
    best && isObject(best._ranking) ? pickNumber(best._ranking as UnknownRecord, ["duration_minutes"]) : undefined;
  const stops =
    best && isObject(best._ranking) ? pickNumber(best._ranking as UnknownRecord, ["stops"]) : undefined;

  const title = [from, to].filter(Boolean).join(" → ") || `Flight ${labelIndex + 1}`;

  const moreFlightOptions = options
    .map((raw, i) => ({ raw, i }))
    .filter(({ raw }) => isObject(raw))
    .filter(({ raw }) => !best || (raw as UnknownRecord) !== best);

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setDetailsOpen((v) => !v)}
        aria-expanded={detailsOpen}
        aria-controls={`flight-detail-${labelIndex}`}
        id={`flight-summary-${labelIndex}`}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          detailsOpen ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {detailsOpen ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted shrink-0">{[depart, arrive].filter(Boolean).join(" → ")}</p>
          </div>
          {(legPriceParts || durationMinutes != null || stops != null) && (
            <p className="mt-1 text-xs text-muted flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {legPriceParts ? <DualPriceDisplay parts={legPriceParts} /> : null}
              {durationMinutes != null ? (
                <>
                  {legPriceParts ? <span className="text-muted">·</span> : null}
                  <span>{formatDurationMinutesAsHoursMinutes(durationMinutes)}</span>
                </>
              ) : null}
              {stops != null ? (
                <>
                  {(legPriceParts || durationMinutes != null) ? <span className="text-muted">·</span> : null}
                  <span>{stops} stops</span>
                </>
              ) : null}
            </p>
          )}
        </div>
      </button>
      {detailsOpen && (
        <div
          id={`flight-detail-${labelIndex}`}
          role="region"
          aria-labelledby={`flight-summary-${labelIndex}`}
          className={LEG_OPTION_PANEL_CLASS}
        >
          <div className="mb-3 flex items-start justify-between gap-2 pl-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Leg price</p>
              <p className="text-sm font-semibold text-foreground">
                {legPriceParts ? <DualPriceDisplay parts={legPriceParts} /> : "—"}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDetailsOpen(false);
              }}
              className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-hover hover:text-foreground transition-colors"
            >
              Collapse
            </button>
          </div>
          <FlightSegmentDetailList flight={flight} />
          {options.length > 0 &&
            (moreFlightOptions.length > 0 ? (
              <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                <p className="pl-3 text-[10px] font-medium uppercase tracking-wide text-muted">Other fare options</p>
                <div className="space-y-2">
                  {moreFlightOptions.map(({ raw, i }) => (
                    <FlightOptionBox
                      key={i}
                      opt={raw as UnknownRecord}
                      optionIndex={i}
                      parentFlight={flight}
                      parentFlightIndex={labelIndex}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 border-t border-border/60 pt-3 pl-3 text-xs text-muted">
                {options.filter(isObject).length <= 1
                  ? "No other fare options."
                  : "No additional fare options to show."}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

function HotelRow({ stay, labelIndex }: { stay: UnknownRecord; labelIndex: number }) {
  const itineraryCurrency = useItineraryCurrency();
  const [open, setOpen] = useState(false);
  const checkIn = asIsoDate(stay.check_in);
  const checkOut = asIsoDate(stay.check_out);
  const cityCode = pickString(stay, ["city_code"]);
  const options = pickArray(stay, ["options"]) ?? [];
  const best = bestByRankingScore(options) ?? (options.find(isObject) as UnknownRecord | undefined);
  const hotel = best && isObject(best.hotel) ? (best.hotel as UnknownRecord) : undefined;
  const hotelName = hotel ? pickString(hotel, ["name"]) : undefined;
  const hotelParts = best ? formatHotelDualPriceParts(best, itineraryCurrency) : undefined;

  const title = hotelName ?? `Hotel ${labelIndex + 1}`;

  const moreHotelOptions = options
    .map((raw, i) => ({ raw, i }))
    .filter(({ raw }) => isObject(raw))
    .filter(({ raw }) => !best || (raw as UnknownRecord) !== best);

  return (
    <div className="w-full min-w-0 rounded-lg border border-border/80 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`w-full flex items-start gap-2 p-3 text-left hover:bg-surface-hover/50 transition-colors ${
          open ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        <span className="shrink-0 text-xs text-muted mt-0.5 w-4 text-center" aria-hidden>
          {open ? "▼" : "▶"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted shrink-0">{[checkIn, checkOut].filter(Boolean).join(" → ")}</p>
          </div>
          {(cityCode || hotelParts) ? (
            <p className="mt-1 text-xs text-muted flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              {cityCode ? <span>{cityCode}</span> : null}
              {cityCode && hotelParts ? <span className="text-muted">·</span> : null}
              {hotelParts ? <DualPriceDisplay parts={hotelParts} /> : null}
            </p>
          ) : null}
        </div>
      </button>
      {open && (
        <div className={LEG_OPTION_PANEL_CLASS}>
          {options.length > 0 ? (
            moreHotelOptions.length > 0 ? (
              <div className="space-y-2">
                {moreHotelOptions.map(({ raw, i }) => (
                  <HotelOptionBox key={i} opt={raw as UnknownRecord} optionIndex={i} parentStay={stay} />
                ))}
              </div>
            ) : (
              <p className="pl-3 text-xs text-muted">
                {options.filter(isObject).length <= 1
                  ? "No other hotel options."
                  : "No additional hotel options to show."}
              </p>
            )
          ) : (
            <p className="pl-3 text-xs text-muted">No hotel options listed.</p>
          )}
        </div>
      )}
    </div>
  );
}

function LegFlightsBlock({ flights }: { flights: unknown[] }) {
  const list = flights.filter(isObject) as UnknownRecord[];
  if (list.length === 0) return null;

  const listClass = "mt-2 flex w-full min-w-0 flex-col gap-2";

  return (
    <div>
      <p className="text-xs font-medium text-muted">Flights</p>
      <div className={listClass}>
        {list.map((flight, idx) => (
          <FlightRow key={idx} flight={flight} labelIndex={idx} />
        ))}
      </div>
    </div>
  );
}

function LegHotelsBlock({ hotels }: { hotels: unknown[] }) {
  const list = hotels.filter(isObject) as UnknownRecord[];
  if (list.length === 0) return null;

  const listClass = "mt-2 flex w-full min-w-0 flex-col gap-2";

  return (
    <div>
      <p className="text-xs font-medium text-muted">Hotels</p>
      <div className={listClass}>
        {list.map((stay, idx) => (
          <HotelRow key={idx} stay={stay} labelIndex={idx} />
        ))}
      </div>
    </div>
  );
}

function RankedItineraryCard({ envelope, ranked }: { envelope: UnknownRecord; ranked: UnknownRecord }) {
  const itineraryIndex = pickNumber(envelope, ["itinerary_index"]);
  const itineraryCount = pickNumber(envelope, ["itinerary_count"]);

  const summary = pickRecord(ranked, ["summary"]);
  const totalDays = summary ? pickNumber(summary, ["total_duration_days"]) : undefined;
  const itineraryCurrency = summary ? pickString(summary, ["itinerary_currency"]) : undefined;
  const flightsSummaryParts = summary ? flightSummaryParts(summary, itineraryCurrency) : undefined;
  const hotelsSummaryParts = summary ? hotelSummaryParts(summary, itineraryCurrency) : undefined;

  const legs = getLegsFromRanked(ranked);
  const legsWithContent = legs.filter((leg) => {
    const f = pickArray(leg, ["flights"]) ?? [];
    const h = pickArray(leg, ["hotels"]) ?? [];
    return f.length > 0 || h.length > 0;
  });

  return (
    <ItineraryCurrencyContext.Provider value={itineraryCurrency}>
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              Itinerary
              {typeof itineraryIndex === "number" && typeof itineraryCount === "number"
                ? ` • ${itineraryIndex + 1}/${itineraryCount}`
                : ""}
            </p>
          </div>
        </div>

        {(totalDays != null || flightsSummaryParts != null || hotelsSummaryParts != null) && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border bg-background/40 p-2">
              <p className="text-[10px] text-muted">Duration</p>
              <p className="text-sm font-medium text-foreground">
                {totalDays != null ? `${totalDays} days` : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-2">
              <p className="text-[10px] text-muted">Flights</p>
              <p className="text-sm font-medium text-foreground">
                {flightsSummaryParts ? <DualPriceDisplay parts={flightsSummaryParts} /> : "—"}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-2">
              <p className="text-[10px] text-muted">Hotels</p>
              <p className="text-sm font-medium text-foreground">
                {hotelsSummaryParts ? <DualPriceDisplay parts={hotelsSummaryParts} /> : "—"}
              </p>
            </div>
          </div>
        )}

        {legsWithContent.length > 0 && (
        <div className="mt-4 space-y-4">
          {legsWithContent.map((leg, legIdx) => {
            const legFlights = pickArray(leg, ["flights"]) ?? [];
            const legHotels = pickArray(leg, ["hotels"]) ?? [];

            const legLabel =
              pickString(leg, ["title", "name", "label"]) ??
              pickString(leg, ["from", "origin"]) ??
              (legsWithContent.length > 1 ? `Leg ${legIdx + 1}` : undefined);
            const legDates = [
              asIsoDate(pickString(leg, ["start_date", "startDate"])),
              asIsoDate(pickString(leg, ["end_date", "endDate"])),
            ]
              .filter(Boolean)
              .join(" → ");

            return (
              <div key={legIdx} className="rounded-lg border border-border/80 bg-background/30 p-3">
                {(legLabel || legDates) && (
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    {legLabel && <p className="text-sm font-medium text-foreground">{legLabel}</p>}
                    {legDates && <p className="text-xs text-muted">{legDates}</p>}
                  </div>
                )}
                <div className="space-y-4">
                  <LegFlightsBlock flights={legFlights} />
                  <LegHotelsBlock hotels={legHotels} />
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </ItineraryCurrencyContext.Provider>
  );
}

function normalizeItineraryRoot(data: unknown): UnknownRecord | undefined {
  if (!isObject(data)) return undefined;
  if ("itinerary" in data && isObject(data.itinerary)) return data.itinerary;
  if ("ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) {
    return (data as UnknownRecord).ranked_itinerary as UnknownRecord;
  }
  if ("ranked" in data && isObject((data as UnknownRecord).ranked)) {
    return (data as UnknownRecord).ranked as UnknownRecord;
  }
  if ("data" in data && isObject(data.data)) {
    const inner = data.data;
    if ("itinerary" in inner && isObject(inner.itinerary)) return inner.itinerary;
    if ("ranked_itinerary" in inner && isObject((inner as UnknownRecord).ranked_itinerary)) {
      return (inner as UnknownRecord).ranked_itinerary as UnknownRecord;
    }
    if ("ranked" in inner && isObject((inner as UnknownRecord).ranked)) {
      return (inner as UnknownRecord).ranked as UnknownRecord;
    }
    return inner as UnknownRecord;
  }
  return data;
}

export function ItineraryCard({ data }: { data: unknown }) {
  // Envelope-aware ranked itinerary format:
  // { type: "ranked" | "ranked_itinerary" | "ranked", id, itinerary_index, itinerary_count, ranked_itinerary: {...} }
  if (isObject(data) && "ranked_itinerary" in data && isObject((data as UnknownRecord).ranked_itinerary)) {
    return <RankedItineraryCard envelope={data} ranked={(data as UnknownRecord).ranked_itinerary as UnknownRecord} />;
  }

  const root = normalizeItineraryRoot(data);
  if (!root) return null;

  const title =
    pickString(root, ["title", "name"]) ??
    pickString(root, ["destination", "location", "city", "country"]) ??
    "Itinerary";

  const subtitleParts: string[] = [];
  const destination = pickString(root, ["destination", "location"]);
  const start = pickString(root, ["start_date", "startDate", "from", "start"]);
  const end = pickString(root, ["end_date", "endDate", "to", "end"]);
  const duration = pickString(root, ["duration", "duration_days", "durationDays"]);

  if (destination && destination !== title) subtitleParts.push(destination);
  if (start || end) subtitleParts.push([start, end].filter(Boolean).join(" → "));
  if (duration) subtitleParts.push(duration);

  const summary =
    pickString(root, ["summary", "overview", "description"]) ??
    pickString(root, ["notes"]);

  const days = pickArray(root, ["days", "day_plans", "dayPlans"]) ?? [];

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {subtitleParts.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-muted">{subtitleParts.join(" • ")}</p>
          )}
        </div>
      </div>

      {summary && <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">{summary}</p>}

      {days.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">Days</p>
          <div className="mt-2 space-y-2">
            {days.slice(0, 7).map((d, idx) => {
              const dayObj = isObject(d) ? d : undefined;
              const dayTitle =
                (dayObj && pickString(dayObj, ["title", "name"])) || `Day ${idx + 1}`;
              const dayDate = dayObj && pickString(dayObj, ["date", "day", "start_date"]);
              const activities =
                dayObj && (pickArray(dayObj, ["activities", "items", "plan"]) ?? []);

              return (
                <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{dayTitle}</p>
                    {dayDate && <p className="text-xs text-muted">{dayDate}</p>}
                  </div>
                  {Array.isArray(activities) && activities.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm text-foreground">
                      {activities.slice(0, 4).map((a, i) => (
                        <li key={i} className="whitespace-pre-wrap">
                          {typeof a === "string"
                            ? a
                            : isObject(a)
                              ? pickString(a, ["title", "name", "description"]) ?? JSON.stringify(a)
                              : String(a)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {days.length > 7 && (
              <p className="text-xs text-muted">Showing first 7 days…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

