"use client";

import { useState, type ReactNode } from "react";

type UnknownRecord = Record<string, unknown>;

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

function ExpandableSection({
  isExpanded,
  onToggle,
  collapsedMaxHeightClass,
  children,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  collapsedMaxHeightClass: string;
  children: ReactNode;
}) {
  const heightTransitionClass = isExpanded
    ? "duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
    : "duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]";

  return (
    <div>
      <div
        className={`relative overflow-hidden transition-[max-height] ${heightTransitionClass} ${
          isExpanded ? "max-h-[4000px]" : collapsedMaxHeightClass
        }`}
      >
        <div className="space-y-2">{children}</div>
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface via-surface/85 to-transparent backdrop-blur-[1px] transition-opacity ${
            isExpanded ? "opacity-0 duration-250" : "opacity-100 duration-500"
          }`}
        />
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
        >
          {isExpanded ? "Show less..." : "Show more..."}
        </button>
      </div>
    </div>
  );
}

function RankedItineraryCard({ envelope, ranked }: { envelope: UnknownRecord; ranked: UnknownRecord }) {
  const [showAllFlights, setShowAllFlights] = useState(false);
  const [showAllHotels, setShowAllHotels] = useState(false);
  const itineraryIndex = pickNumber(envelope, ["itinerary_index"]);
  const itineraryCount = pickNumber(envelope, ["itinerary_count"]);

  const summary = pickRecord(ranked, ["summary"]);
  const totalDays = summary ? pickNumber(summary, ["total_duration_days"]) : undefined;
  const flightsCost = summary ? pickNumber(summary, ["total_flights_cost"]) : undefined;
  const flightsCurrency = summary ? pickString(summary, ["flights_currency"]) : undefined;
  const hotelsCost = summary ? pickNumber(summary, ["total_hotels_cost"]) : undefined;
  const hotelsCurrency = summary ? pickString(summary, ["hotels_currency"]) : undefined;

  const flights = pickArray(ranked, ["flights"]) ?? [];
  const hotels = pickArray(ranked, ["hotels"]) ?? [];

  return (
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

      {(totalDays != null || flightsCost != null || hotelsCost != null) && (
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
              {flightsCost != null && flightsCurrency ? `${flightsCurrency} ${flightsCost}` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/40 p-2">
            <p className="text-[10px] text-muted">Hotels</p>
            <p className="text-sm font-medium text-foreground">
              {hotelsCost != null && hotelsCurrency ? `${hotelsCurrency} ${hotelsCost}` : "—"}
            </p>
          </div>
        </div>
      )}

      {flights.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">Flights</p>
          {flights.length > 3 ? (
            <div className="mt-2">
              <ExpandableSection
                isExpanded={showAllFlights}
                onToggle={() => setShowAllFlights((prev) => !prev)}
                collapsedMaxHeightClass="max-h-[300px]"
              >
                {flights.map((f, idx) => {
                  const flight = isObject(f) ? f : undefined;
                  if (!flight) return null;
                  const from = pickString(flight, ["from"]);
                  const to = pickString(flight, ["to"]);
                  const depart = asIsoDate(flight.depart_date);
                  const arrive = asIsoDate(flight.arrive_date);
                  const options = pickArray(flight, ["options"]) ?? [];
                  const best = bestByRankingScore(options);
                  const price = best && isObject(best.price) ? (best.price as UnknownRecord) : undefined;
                  const currency = price ? pickString(price, ["currency"]) : undefined;
                  const total = price ? pickString(price, ["total", "grandTotal"]) : undefined;
                  const durationMinutes =
                    best && isObject(best._ranking)
                      ? pickNumber(best._ranking as UnknownRecord, ["duration_minutes"])
                      : undefined;
                  const stops =
                    best && isObject(best._ranking) ? pickNumber(best._ranking as UnknownRecord, ["stops"]) : undefined;

                  return (
                    <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {[from, to].filter(Boolean).join(" → ") || `Flight ${idx + 1}`}
                        </p>
                        <p className="text-xs text-muted">{[depart, arrive].filter(Boolean).join(" → ")}</p>
                      </div>
                      {(currency || total || durationMinutes != null || stops != null) && (
                        <p className="mt-1 text-xs text-muted">
                          {[
                            currency && total ? `${currency} ${total}` : null,
                            durationMinutes != null ? `${durationMinutes} min` : null,
                            stops != null ? `${stops} stops` : null,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </ExpandableSection>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {flights.map((f, idx) => {
                const flight = isObject(f) ? f : undefined;
                if (!flight) return null;
                const from = pickString(flight, ["from"]);
                const to = pickString(flight, ["to"]);
                const depart = asIsoDate(flight.depart_date);
                const arrive = asIsoDate(flight.arrive_date);
                const options = pickArray(flight, ["options"]) ?? [];
                const best = bestByRankingScore(options);
                const price = best && isObject(best.price) ? (best.price as UnknownRecord) : undefined;
                const currency = price ? pickString(price, ["currency"]) : undefined;
                const total = price ? pickString(price, ["total", "grandTotal"]) : undefined;
                const durationMinutes =
                  best && isObject(best._ranking)
                    ? pickNumber(best._ranking as UnknownRecord, ["duration_minutes"])
                    : undefined;
                const stops =
                  best && isObject(best._ranking) ? pickNumber(best._ranking as UnknownRecord, ["stops"]) : undefined;

                return (
                  <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">
                        {[from, to].filter(Boolean).join(" → ") || `Flight ${idx + 1}`}
                      </p>
                      <p className="text-xs text-muted">{[depart, arrive].filter(Boolean).join(" → ")}</p>
                    </div>
                    {(currency || total || durationMinutes != null || stops != null) && (
                      <p className="mt-1 text-xs text-muted">
                        {[
                          currency && total ? `${currency} ${total}` : null,
                          durationMinutes != null ? `${durationMinutes} min` : null,
                          stops != null ? `${stops} stops` : null,
                        ]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {hotels.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted">Hotels</p>
          {hotels.length > 3 ? (
            <div className="mt-2">
              <ExpandableSection
                isExpanded={showAllHotels}
                onToggle={() => setShowAllHotels((prev) => !prev)}
                collapsedMaxHeightClass="max-h-[300px]"
              >
                {hotels.map((h, idx) => {
                  const stay = isObject(h) ? h : undefined;
                  if (!stay) return null;
                  const checkIn = asIsoDate(stay.check_in);
                  const checkOut = asIsoDate(stay.check_out);
                  const cityCode = pickString(stay, ["city_code"]);
                  const options = pickArray(stay, ["options"]) ?? [];
                  const best = bestByRankingScore(options) ?? (options.find(isObject) as UnknownRecord | undefined);
                  const hotel = best && isObject(best.hotel) ? (best.hotel as UnknownRecord) : undefined;
                  const hotelName = hotel ? pickString(hotel, ["name"]) : undefined;
                  const ranking = best && isObject(best._ranking) ? (best._ranking as UnknownRecord) : undefined;
                  const pricePerNight = ranking ? pickNumber(ranking, ["price_per_night"]) : undefined;
                  return (
                    <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{hotelName ?? `Hotel ${idx + 1}`}</p>
                        <p className="text-xs text-muted">{[checkIn, checkOut].filter(Boolean).join(" → ")}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {[cityCode, pricePerNight != null ? `${pricePerNight}/night` : null].filter(Boolean).join(" • ")}
                      </p>
                    </div>
                  );
                })}
              </ExpandableSection>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              {hotels.map((h, idx) => {
                const stay = isObject(h) ? h : undefined;
                if (!stay) return null;
                const checkIn = asIsoDate(stay.check_in);
                const checkOut = asIsoDate(stay.check_out);
                const cityCode = pickString(stay, ["city_code"]);
                const options = pickArray(stay, ["options"]) ?? [];
                const best = bestByRankingScore(options) ?? (options.find(isObject) as UnknownRecord | undefined);
                const hotel = best && isObject(best.hotel) ? (best.hotel as UnknownRecord) : undefined;
                const hotelName = hotel ? pickString(hotel, ["name"]) : undefined;
                const ranking = best && isObject(best._ranking) ? (best._ranking as UnknownRecord) : undefined;
                const pricePerNight = ranking ? pickNumber(ranking, ["price_per_night"]) : undefined;
                return (
                  <div key={idx} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{hotelName ?? `Hotel ${idx + 1}`}</p>
                      <p className="text-xs text-muted">{[checkIn, checkOut].filter(Boolean).join(" → ")}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {[cityCode, pricePerNight != null ? `${pricePerNight}/night` : null].filter(Boolean).join(" • ")}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
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

