"use client";

import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Fragment, useMemo, useState } from "react";
import { DualPriceDisplay, formatAmadeusDualPriceParts } from "./tripDualPrice";
import { useTripCurrency, useTripLocationMaps } from "./TripCardContexts";
import type { UnknownRecord } from "./tripShared";
import {
  formatDurationMinutesAsHoursMinutes,
  getFlightOptionSortableId,
  isObject,
  LEG_OPTION_PANEL_CLASS,
  pickArray,
  pickNumber,
  pickString,
} from "./tripShared";
import {
  collectSegmentGroupsFromRecord,
  formatAirportLineWithMaps,
  formatCabinClassLabel,
  formatConnectionLayover,
  formatFareBagsLine,
  formatFlightEndpointDisplay,
  formatFlightEndpointFromNestedEndpoint,
  formatSegmentCarrier,
  gatherFlightOfferSourceRecord,
  getMultiItinerarySummaryLines,
  getFirstTravelerFareDetailsBySegment,
  buildFareDetailBySegmentId,
  resolveFareDetailForSegment,
  itineraryGroupLabel,
  pickFareBagsField,
  pickFlightOptionRouteAirportCodes,
  resolveFlightHeaderPlaceLabel,
  getPerLegDurationAndStops,
} from "./tripFlightFormatting";
import { SortableOptionRow } from "./SortableOptionRow";

function formatLegDurationStopsLine(leg: { durationMinutes?: number; stops: number }): string {
  const parts: string[] = [];
  if (leg.durationMinutes != null) {
    parts.push(formatDurationMinutesAsHoursMinutes(leg.durationMinutes));
  }
  parts.push(`${leg.stops} ${leg.stops === 1 ? "stop" : "stops"}`);
  return parts.join(" · ");
}

/** When `priceOnly`, show dual price only (used for multi-itinerary: duration/stops are per leg above). */
function FlightOptionMetaLine({ opt, priceOnly }: { opt: UnknownRecord; priceOnly?: boolean }) {
  const tripCurrency = useTripCurrency();
  const price = isObject(opt.price) ? (opt.price as UnknownRecord) : undefined;
  const parts = price ? formatAmadeusDualPriceParts(price, tripCurrency) : undefined;
  const ranking = isObject(opt._ranking) ? (opt._ranking as UnknownRecord) : undefined;
  const durationMinutes =
    !priceOnly && ranking ? pickNumber(ranking, ["duration_minutes"]) : undefined;
  const stops = !priceOnly && ranking ? pickNumber(ranking, ["stops"]) : undefined;
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
  const maps = useTripLocationMaps();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const routeAirports = pickFlightOptionRouteAirportCodes(opt, parentFlight);
  const routeTitle = [routeAirports.from, routeAirports.to].filter(Boolean).join(" → ");
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
  const linesFromOpt = getMultiItinerarySummaryLines(opt, maps, "airport");
  const linesFromParent = getMultiItinerarySummaryLines(parentFlight, maps, "airport");
  const multiItinLines = linesFromOpt ?? linesFromParent;
  const multiItinSource =
    linesFromOpt != null && linesFromOpt.length > 1
      ? opt
      : linesFromParent != null && linesFromParent.length > 1
        ? parentFlight
        : opt;
  const legDurationStops =
    multiItinLines != null && multiItinLines.length > 1
      ? getPerLegDurationAndStops(multiItinSource)
      : undefined;
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
          {multiItinLines && multiItinLines.length > 1 ? (
            <div className="space-y-1">
              {multiItinLines.map((line, i) => {
                const leg = legDurationStops?.[i];
                return (
                  <div
                    key={i}
                    className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"
                  >
                    <p className="min-w-0 text-sm font-medium text-foreground leading-snug">{line}</p>
                    {leg ? (
                      <span className="shrink-0 text-xs text-muted">
                        {formatLegDurationStopsLine(leg)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{title}</p>
              {dateRight ? <p className="text-xs text-muted shrink-0">{dateRight}</p> : null}
            </div>
          )}
          <FlightOptionMetaLine
            opt={opt}
            priceOnly={multiItinLines != null && multiItinLines.length > 1}
          />
        </div>
      </button>
      {detailsOpen && (
        <div
          id={detailId}
          role="region"
          aria-labelledby={`${detailId}-summary`}
          className="border-t border-border bg-background/25 px-3 py-3"
        >
          <FlightSegmentDetailList flight={parentFlight} segmentsFrom={opt} />
        </div>
      )}
    </div>
  );
}
function SortableFlightOptionsList({
  flight,
  flightIndex,
  legIndex,
  parentFlightIndex,
  objectOptions,
  onReorder,
}: {
  flight: UnknownRecord;
  flightIndex: number;
  legIndex: number;
  parentFlightIndex: number;
  objectOptions: UnknownRecord[];
  onReorder: (newOrder: UnknownRecord[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const sortableIds = useMemo(
    () => objectOptions.map((opt) => getFlightOptionSortableId(opt, legIndex, flightIndex)),
    [objectOptions, legIndex, flightIndex]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortableIds.indexOf(String(active.id));
    const newIndex = sortableIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(objectOptions, oldIndex, newIndex));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {objectOptions.map((opt, i) => (
            <SortableOptionRow
              key={sortableIds[i]}
              id={sortableIds[i]}
              ariaLabel="Drag to reorder fare option"
            >
              <FlightOptionBox
                opt={opt}
                optionIndex={i}
                parentFlight={flight}
                parentFlightIndex={parentFlightIndex}
              />
            </SortableOptionRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
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
        Per-segment breakdown is not available for this trip.
      </p>
    </div>
  );
}

function FlightSegmentConnectionRow({ prev, next }: { prev: UnknownRecord; next: UnknownRecord }) {
  const maps = useTripLocationMaps();
  const layover = formatConnectionLayover(prev, next);
  const hub = formatAirportLineWithMaps(next, "departure", maps);
  if (!layover) return null;
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-background/20 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">Connection</span>
      <span className="text-muted"> at {hub}</span>
      <span className="text-muted"> · {layover}</span>
    </div>
  );
}

function FlightSegmentCard({
  seg,
  index,
  total,
  fareDetail,
  /** When set (multi-itinerary offer), "Segment X of Y" counts within this itinerary only. */
  segmentIndexInLeg,
  segmentCountInLeg,
}: {
  seg: UnknownRecord;
  /** Global index for fare matching (`fareDetailsBySegment` order). */
  index: number;
  total: number;
  fareDetail?: UnknownRecord;
  segmentIndexInLeg?: number;
  segmentCountInLeg?: number;
}) {
  const maps = useTripLocationMaps();
  const dep = formatFlightEndpointFromNestedEndpoint(seg, "departure");
  const arr = formatFlightEndpointFromNestedEndpoint(seg, "arrival");
  const carrier = formatSegmentCarrier(seg);
  const depLoc = formatAirportLineWithMaps(seg, "departure", maps);
  const arrLoc = formatAirportLineWithMaps(seg, "arrival", maps);

  const cabinLabel = fareDetail ? formatCabinClassLabel(fareDetail.cabin) : undefined;
  const checkedBags = fareDetail ? formatFareBagsLine(pickFareBagsField(fareDetail, "checked")) : undefined;
  const cabinBags = fareDetail ? formatFareBagsLine(pickFareBagsField(fareDetail, "cabin")) : undefined;
  const hasFareExtras = Boolean(cabinLabel || checkedBags || cabinBags);

  const useLegLabels =
    segmentIndexInLeg !== undefined && segmentCountInLeg !== undefined && segmentCountInLeg > 0;
  const labelNum = useLegLabels ? segmentIndexInLeg + 1 : index + 1;
  const labelTotal = useLegLabels ? segmentCountInLeg : total;

  return (
    <div className="rounded-md border border-border/50 bg-background/30 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
        Segment {labelNum}
        {labelTotal > 1 ? ` of ${labelTotal}` : ""}
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
        {hasFareExtras ? (
          <>
            {cabinLabel ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Cabin class</dt>
                <dd className="mt-0.5 text-foreground">{cabinLabel}</dd>
              </div>
            ) : null}
            {checkedBags ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Checked bags</dt>
                <dd className="mt-0.5 text-foreground">{checkedBags}</dd>
              </div>
            ) : null}
            {cabinBags ? (
              <div>
                <dt className="text-[10px] font-medium uppercase text-muted">Cabin bags</dt>
                <dd className="mt-0.5 text-foreground">{cabinBags}</dd>
              </div>
            ) : null}
          </>
        ) : null}
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
  const source = segmentsFrom !== undefined ? segmentsFrom : gatherFlightOfferSourceRecord(flight);
  const groups = collectSegmentGroupsFromRecord(source);
  const fallbackRecord = segmentsFrom ?? flight;
  /** Cabin/bags usually live on the offer option (`travelerPricings`); fall back to parent flight. */
  const fareSource = segmentsFrom ?? flight;
  const fareDetailsInOrder = getFirstTravelerFareDetailsBySegment(fareSource);
  const fareById = buildFareDetailBySegmentId(fareDetailsInOrder);

  const flatCount = groups.reduce((n, g) => n + g.length, 0);
  if (flatCount === 0) {
    return <FlightSegmentFallback flight={fallbackRecord} />;
  }

  if (groups.length <= 1) {
    const segments = groups[0] ?? [];
    return (
      <div className="space-y-2">
        {segments.map((seg, i) => (
          <Fragment key={i}>
            <FlightSegmentCard
              seg={seg}
              index={i}
              total={segments.length}
              fareDetail={resolveFareDetailForSegment(seg, i, fareDetailsInOrder, fareById)}
            />
            {i < segments.length - 1 ? (
              <FlightSegmentConnectionRow prev={segments[i]} next={segments[i + 1]} />
            ) : null}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => {
        const segStart = groups.slice(0, gi).reduce((s, g) => s + g.length, 0);
        const legLabel = itineraryGroupLabel(gi, groups.length);
        return (
          <div
            key={gi}
            className="overflow-hidden rounded-lg border border-border/70 bg-background/25"
          >
            <div className="border-b border-border/50 bg-muted/20 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground">{legLabel}</p>
              {group.length > 1 ? (
                <p className="mt-0.5 text-[10px] text-muted">
                  {group.length} segment{group.length === 1 ? "" : "s"} in this direction
                </p>
              ) : null}
            </div>
            <div className="space-y-2 px-3 py-2">
              {group.map((seg, si) => {
                const idx = segStart + si;
                return (
                  <Fragment key={`${gi}-${si}`}>
                    <FlightSegmentCard
                      seg={seg}
                      index={idx}
                      total={flatCount}
                      segmentIndexInLeg={si}
                      segmentCountInLeg={group.length}
                      fareDetail={resolveFareDetailForSegment(seg, idx, fareDetailsInOrder, fareById)}
                    />
                    {si < group.length - 1 ? (
                      <FlightSegmentConnectionRow prev={group[si]} next={group[si + 1]} />
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlightRow({
  flight,
  labelIndex,
  legIndex,
  onOptionsReorder,
}: {
  flight: UnknownRecord;
  labelIndex: number;
  legIndex: number;
  onOptionsReorder?: (newOptions: UnknownRecord[]) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const maps = useTripLocationMaps();
  const from = pickString(flight, ["from"]);
  const to = pickString(flight, ["to"]);
  const options = pickArray(flight, ["options"]) ?? [];
  const objectOptions = options.filter(isObject) as UnknownRecord[];

  const title =
    [resolveFlightHeaderPlaceLabel(from, maps), resolveFlightHeaderPlaceLabel(to, maps)].filter(Boolean).join(" → ") ||
    `Flight ${labelIndex + 1}`;
  const canSortOptions = Boolean(onOptionsReorder) && objectOptions.length > 1;

  const previewSource = objectOptions[0] ?? flight;
  const multiItinLines = getMultiItinerarySummaryLines(previewSource, maps);
  const departSummary = formatFlightEndpointDisplay(flight, "departure", true);
  const arriveSummary = formatFlightEndpointDisplay(flight, "arrival", true);
  const dateSummary = [departSummary, arriveSummary].filter(Boolean).join(" → ");

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
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            {multiItinLines && multiItinLines.length > 1 ? (
              <div className="min-w-0 space-y-0.5">
                {multiItinLines.map((line, i) => (
                  <p key={i} className="text-sm text-foreground">
                    <span className="font-medium">{line}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="min-w-0 text-sm text-foreground">
                <span className="font-medium">{title}</span>
                {dateSummary ? (
                  <>
                    <span className="font-medium text-muted"> · </span>
                    <span className="font-normal text-muted">{dateSummary}</span>
                  </>
                ) : null}
              </p>
            )}
            {objectOptions.length > 0 ? (
              <p className="text-xs text-muted shrink-0">
                {objectOptions.length === 1 ? "1 fare option" : `${objectOptions.length} fare options`}
              </p>
            ) : null}
          </div>
        </div>
      </button>
      {detailsOpen && (
        <div
          id={`flight-detail-${labelIndex}`}
          role="region"
          aria-labelledby={`flight-summary-${labelIndex}`}
          className={LEG_OPTION_PANEL_CLASS}
        >
          {objectOptions.length > 0 ? (
            canSortOptions && onOptionsReorder ? (
              <SortableFlightOptionsList
                flight={flight}
                flightIndex={labelIndex}
                legIndex={legIndex}
                parentFlightIndex={labelIndex}
                objectOptions={objectOptions}
                onReorder={onOptionsReorder}
              />
            ) : (
              <div className="space-y-2">
                {objectOptions.map((opt, i) => (
                  <FlightOptionBox
                    key={i}
                    opt={opt}
                    optionIndex={i}
                    parentFlight={flight}
                    parentFlightIndex={labelIndex}
                  />
                ))}
              </div>
            )
          ) : (
            <FlightSegmentDetailList flight={flight} />
          )}
        </div>
      )}
    </div>
  );
}

export function LegFlightsBlock({
  flights,
  legIndex,
  onReorderFlightOptions,
}: {
  flights: unknown[];
  legIndex: number;
  onReorderFlightOptions?: (flightIndex: number, newOptions: unknown[]) => void;
}) {
  const list = flights.filter(isObject) as UnknownRecord[];
  if (list.length === 0) return null;

  const listClass = "mt-2 flex w-full min-w-0 flex-col gap-2";

  return (
    <div>
      <p className="text-xs font-medium text-muted">Flights</p>
      <div className={listClass}>
        {list.map((flight, idx) => (
          <FlightRow
            key={idx}
            flight={flight}
            labelIndex={idx}
            legIndex={legIndex}
            onOptionsReorder={
              onReorderFlightOptions
                ? (newOrder) => onReorderFlightOptions(idx, newOrder)
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
