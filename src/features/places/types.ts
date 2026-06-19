import type { Category, Place } from "@/lib/supabase/types";

export type PlaceRow = Place;

export type PlaceFormValues = {
  name: string;
  description: string;
  place_type: string;
  status: string;
  city: string;
  district: string;
  address: string;
  google_maps_url: string;
  latitude: string;
  longitude: string;
  planned_date: string;
  visited_date: string;
  estimated_cost: string;
  actual_cost: string;
  rating: string;
  would_repeat: boolean;
  companion: string;
  notes: string;
  category_id: string;
};

export type PlaceSupportData = {
  categories: Pick<Category, "id" | "name" | "type" | "color" | "icon">[];
};

export const placeStatusOptions = [
  { value: "want_to_go", label: "Quero ir" },
  { value: "planned", label: "Planejado" },
  { value: "visited", label: "Fui" },
  { value: "cancelled", label: "Cancelado" },
] as const;

export const placeTypeOptions = [
  { value: "restaurant", label: "Restaurante" },
  { value: "bar", label: "Bar" },
  { value: "cafe", label: "Cafeteria" },
  { value: "outing", label: "Passeio" },
  { value: "trip", label: "Viagem" },
  { value: "event", label: "Evento" },
  { value: "cinema", label: "Cinema" },
  { value: "park", label: "Parque" },
  { value: "shopping", label: "Compras" },
  { value: "other", label: "Outro" },
] as const;

export const ratingOptions = [
  { value: "all", label: "Todas as notas" },
  { value: "5", label: "5 estrelas" },
  { value: "4", label: "4 estrelas ou mais" },
  { value: "3", label: "3 estrelas ou mais" },
  { value: "2", label: "2 estrelas ou mais" },
  { value: "1", label: "1 estrela ou mais" },
] as const;

export const emptyPlaceForm: PlaceFormValues = {
  name: "",
  description: "",
  place_type: "other",
  status: "want_to_go",
  city: "",
  district: "",
  address: "",
  google_maps_url: "",
  latitude: "",
  longitude: "",
  planned_date: "",
  visited_date: "",
  estimated_cost: "0",
  actual_cost: "0",
  rating: "",
  would_repeat: false,
  companion: "",
  notes: "",
  category_id: "",
};

export function placeToFormValues(item: PlaceRow): PlaceFormValues {
  return {
    name: item.name,
    description: item.description ?? "",
    place_type: item.place_type,
    status: item.status,
    city: item.city ?? "",
    district: item.district ?? "",
    address: item.address ?? "",
    google_maps_url: item.google_maps_url ?? "",
    latitude: item.latitude === null ? "" : String(item.latitude),
    longitude: item.longitude === null ? "" : String(item.longitude),
    planned_date: item.planned_date ?? "",
    visited_date: item.visited_date ?? "",
    estimated_cost: String(item.estimated_cost ?? 0),
    actual_cost: String(item.actual_cost ?? 0),
    rating: item.rating === null ? "" : String(item.rating),
    would_repeat: Boolean(item.would_repeat),
    companion: item.companion ?? "",
    notes: item.notes ?? "",
    category_id: item.category_id ?? "",
  };
}

export function isPlaceCategory(category: Pick<Category, "type"> | undefined) {
  if (!category?.type) return false;
  return new Set(["places", "leisure", "general"]).has(category.type.trim().toLowerCase());
}

export function isOutOfScopePlaceCategory(category: Pick<Category, "type"> | undefined) {
  return category ? !isPlaceCategory(category) : false;
}

export function getPlaceStatusTone(status: string): "success" | "warning" | "neutral" | "info" {
  if (status === "visited") return "success";
  if (status === "planned") return "info";
  if (status === "cancelled") return "neutral";
  return "warning";
}
