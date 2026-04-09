"use client";

import { createContext, useContext } from "react";
import type { TripLocationMaps } from "./tripShared";

export const TripCurrencyContext = createContext<string | undefined>(undefined);

const EMPTY_CARRIERS: Record<string, string> = {};

/** `flight_dictionaries.carriers`: IATA code → airline display name. */
export const TripCarriersContext = createContext<Record<string, string>>(EMPTY_CARRIERS);

export function useTripCarriers(): Record<string, string> {
  return useContext(TripCarriersContext);
}

export function useTripCurrency(): string | undefined {
  return useContext(TripCurrencyContext);
}

const EMPTY_LOCATION_MAPS: TripLocationMaps = {
  airportToCityMeta: {},
  cityCodeToName: {},
};

export const TripLocationMapsContext = createContext<TripLocationMaps>(EMPTY_LOCATION_MAPS);

export function useTripLocationMaps(): TripLocationMaps {
  return useContext(TripLocationMapsContext);
}
