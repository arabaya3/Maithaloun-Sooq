"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  DeliveryLocationId,
  DeliveryLocationOption,
} from "./delivery-location";
import {
  DELIVERY_STORAGE_KEY,
  parsePersistedDeliveryLocation,
  serializeDeliveryLocation,
} from "./delivery-store";

interface DeliveryContextValue {
  locationId: DeliveryLocationId | null;
  locations: readonly DeliveryLocationOption[];
  ready: boolean;
  selectLocation: (locationId: DeliveryLocationId | null) => void;
}

const DeliveryContext = createContext<DeliveryContextValue | null>(null);

export function DeliveryProvider({
  children,
  locations,
}: {
  children: ReactNode;
  locations: readonly DeliveryLocationOption[];
}) {
  const [locationId, setLocationId] = useState<DeliveryLocationId | null>(null);
  const [restored, setRestored] = useState(false);
  const allowedLocationIds = useMemo(
    () => new Set(locations.map((location) => location.code)),
    [locations],
  );

  useEffect(() => {
    const saved = parsePersistedDeliveryLocation(
      window.localStorage.getItem(DELIVERY_STORAGE_KEY),
      allowedLocationIds,
    );
    queueMicrotask(() => {
      setLocationId(saved);
      setRestored(true);
    });
  }, [allowedLocationIds]);

  useEffect(() => {
    if (!restored) return;
    if (locationId) {
      window.localStorage.setItem(
        DELIVERY_STORAGE_KEY,
        serializeDeliveryLocation(locationId),
      );
    } else {
      window.localStorage.removeItem(DELIVERY_STORAGE_KEY);
    }
  }, [locationId, restored]);

  const value = useMemo<DeliveryContextValue>(
    () => ({
      locationId,
      locations,
      ready: restored,
      selectLocation: (nextLocationId) => {
        if (
          nextLocationId !== null &&
          !allowedLocationIds.has(nextLocationId)
        ) {
          return;
        }
        setLocationId(nextLocationId);
      },
    }),
    [allowedLocationIds, locationId, locations, restored],
  );

  return (
    <DeliveryContext.Provider value={value}>
      {children}
    </DeliveryContext.Provider>
  );
}

export function useDelivery(): DeliveryContextValue {
  const delivery = useContext(DeliveryContext);
  if (!delivery) {
    throw new Error("useDelivery must be used within DeliveryProvider");
  }
  return delivery;
}
