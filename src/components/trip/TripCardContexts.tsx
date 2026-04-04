"use client";

import { createContext, useContext } from "react";
import type { TripLocationMaps } from "./tripShared";

export const TripCurrencyContext = createContext<string | undefined>(undefined);

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
