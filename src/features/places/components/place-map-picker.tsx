"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

import { ActionButton, inputClassName } from "@/features/shared/crud-ui";

type PlaceMapPickerProps = {
  latitude: string;
  longitude: string;
  address: string;
  city: string;
  district: string;
  onChange: (next: {
    latitude?: string;
    longitude?: string;
    address?: string;
    city?: string;
    district?: string;
    google_maps_url?: string;
  }) => void;
};

type SearchState =
  | { type: "idle"; message?: string }
  | { type: "loading"; message: string }
  | { type: "error"; message: string }
  | { type: "success"; message: string };

const DEFAULT_CENTER: [number, number] = [-15.6014, -56.0979];
const DEFAULT_ZOOM = 5;
const DETAIL_ZOOM = 16;

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export function PlaceMapPicker({
  latitude,
  longitude,
  address,
  city,
  district,
  onChange,
}: PlaceMapPickerProps) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SearchState>({ type: "idle" });

  const selectedPosition = useMemo(() => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [latitude, longitude]);

  async function applyCoordinates(lat: number, lng: number, options?: { skipReverseGeocode?: boolean }) {
    const next = {
      latitude: lat.toFixed(7),
      longitude: lng.toFixed(7),
      google_maps_url: buildMapsUrl(lat, lng),
    };

    onChange(next);

    if (options?.skipReverseGeocode) return;

    try {
      setState({ type: "loading", message: "Buscando endereço do ponto selecionado..." });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Falha ao consultar endereço (${response.status})`);
      }

      const result = (await response.json()) as NominatimResult;
      const normalized = normalizeNominatimResult(result);
      onChange({
        ...next,
        address: normalized.address || address,
        city: normalized.city || city,
        district: normalized.district || district,
      });
      setState({ type: "success", message: "Localização atualizada a partir do mapa." });
    } catch (error) {
      console.error("Erro técnico ao buscar endereço no mapa:", error);
      setState({
        type: "error",
        message: "Coordenadas salvas, mas não foi possível preencher endereço automaticamente.",
      });
    }
  }

  async function handleSearch() {
    const query = search.trim();
    if (!query) {
      setState({ type: "error", message: "Digite um local ou endereço para buscar." });
      return;
    }

    try {
      setState({ type: "loading", message: "Buscando local..." });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`,
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Falha ao buscar local (${response.status})`);
      }

      const results = (await response.json()) as NominatimResult[];
      const first = results[0];
      if (!first) {
        setState({ type: "error", message: "Nenhum local encontrado. Tente outro termo ou ajuste manualmente no mapa." });
        return;
      }

      const normalized = normalizeNominatimResult(first);
      onChange({
        latitude: Number(first.lat).toFixed(7),
        longitude: Number(first.lon).toFixed(7),
        google_maps_url: buildMapsUrl(Number(first.lat), Number(first.lon)),
        address: normalized.address || address,
        city: normalized.city || city,
        district: normalized.district || district,
      });
      setState({ type: "success", message: "Local encontrado. Confirme ou ajuste o ponto no mapa." });
    } catch (error) {
      console.error("Erro técnico ao buscar local no mapa:", error);
      setState({ type: "error", message: "Não foi possível buscar o local agora." });
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr),auto]">
        <input
          className={inputClassName}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar local ou endereço"
        />
        <ActionButton type="button" variant="secondary" onClick={() => void handleSearch()}>
          Buscar local
        </ActionButton>
      </div>

      <div className="overflow-hidden rounded-lg border border-ink-950/10 dark:border-white/10">
        <MapContainer
          center={selectedPosition ? [selectedPosition.lat, selectedPosition.lng] : DEFAULT_CENTER}
          zoom={selectedPosition ? DETAIL_ZOOM : DEFAULT_ZOOM}
          scrollWheelZoom
          className="h-72 w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapViewport position={selectedPosition} />
          <MapClickHandler onSelect={(lat, lng) => void applyCoordinates(lat, lng)} />
          {selectedPosition ? (
            <Marker
              position={[selectedPosition.lat, selectedPosition.lng]}
              icon={markerIcon}
              draggable
              eventHandlers={{
                dragend: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => {
                  const marker = event.target;
                  const nextPosition = marker.getLatLng();
                  void applyCoordinates(nextPosition.lat, nextPosition.lng);
                },
              }}
            />
          ) : null}
        </MapContainer>
      </div>

      <div className="rounded-md border border-ink-950/10 bg-slate-50 px-3 py-3 text-sm text-ink-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-200">
        <p className="font-medium text-ink-950 dark:text-slate-100">Como usar</p>
        <ul className="mt-2 space-y-1 text-sm">
          <li>Clique no mapa para definir latitude e longitude.</li>
          <li>Arraste o marcador para ajustar o ponto com mais precisão.</li>
          <li>A busca tenta preencher endereço, cidade e bairro quando o OpenStreetMap devolver esses dados.</li>
        </ul>
      </div>

      {state.message ? (
        <p
          className={[
            "text-sm",
            state.type === "error"
              ? "text-danger-600 dark:text-danger-200"
              : state.type === "success"
                ? "text-mint-700 dark:text-mint-200"
                : "text-ink-600 dark:text-slate-300",
          ].join(" ")}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function MapViewport({ position }: { position: { lat: number; lng: number } | null }) {
  const map = useMap();

  useEffect(() => {
    if (!position) return;
    map.setView([position.lat, position.lng], Math.max(map.getZoom(), DETAIL_ZOOM), { animate: true });
  }, [map, position]);

  return null;
}

function MapClickHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(event: { latlng: { lat: number; lng: number } }) {
      onSelect(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

type NominatimResult = {
  lat: string;
  lon: string;
  display_name?: string;
  address?: {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state_district?: string;
    county?: string;
  };
};

function normalizeNominatimResult(result: NominatimResult) {
  const city =
    result.address?.city ??
    result.address?.town ??
    result.address?.village ??
    result.address?.municipality ??
    "";
  const district =
    result.address?.suburb ??
    result.address?.neighbourhood ??
    result.address?.quarter ??
    result.address?.state_district ??
    result.address?.county ??
    "";
  const address = result.display_name ?? result.address?.road ?? "";

  return { city, district, address };
}

function buildMapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
