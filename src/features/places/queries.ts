import { safeLogCreate, safeLogFieldDiffs } from "@/features/audit/logger";
import { archiveRecord, restoreArchivedRecord } from "@/features/shared/archive";
import type { AppSupabaseClient } from "@/features/shared/types";

import type { PlaceFormValues, PlaceRow } from "@/features/places/types";

export async function listPlaces(client: AppSupabaseClient) {
  return client.from("places").select("*").is("archived_at", null).order("planned_date", { ascending: true }).order("created_at", { ascending: false });
}

export async function listPlaceSupportData(client: AppSupabaseClient) {
  const categories = await client.from("categories").select("id,name,type,color,icon").eq("is_active", true).order("name", { ascending: true });
  return { categories };
}

export async function createPlace(client: AppSupabaseClient, userId: string, values: PlaceFormValues) {
  const result = await client.from("places").insert(toPayload(userId, values)).select("*").single();
  if (!result.error && result.data) {
    await safeLogCreate(client, userId, "places", result.data.id, result.data);
  }
  return result;
}

export async function updatePlace(client: AppSupabaseClient, id: string, values: PlaceFormValues) {
  const currentResult = await client.from("places").select("*").eq("id", id).single();
  if (currentResult.error || !currentResult.data) {
    console.error("Erro técnico ao carregar lugar atual para auditoria:", currentResult.error);
    return { data: null, error: { message: "Não foi possível carregar o lugar atual." } };
  }

  const result = await client.from("places").update(toPayload(undefined, values)).eq("id", id).select("*").single();
  if (!result.error && result.data) {
    await safeLogFieldDiffs(client, result.data.user_id, "places", result.data.id, currentResult.data, result.data);
  }
  return result;
}

export async function archivePlace(client: AppSupabaseClient, id: string, userId: string, reason?: string) {
  return archiveRecord(client, "places", id, userId, reason);
}

export async function restorePlace(client: AppSupabaseClient, id: string, userId: string) {
  return restoreArchivedRecord(client, "places", id, userId);
}

function toPayload(userId: string | undefined, values: PlaceFormValues): Partial<PlaceRow> {
  return {
    ...(userId ? { user_id: userId } : {}),
    name: values.name.trim(),
    description: values.description.trim() || null,
    place_type: values.place_type,
    status: values.status,
    city: values.city.trim() || null,
    district: values.district.trim() || null,
    address: values.address.trim() || null,
    google_maps_url: values.google_maps_url.trim() || null,
    latitude: optionalNumber(values.latitude),
    longitude: optionalNumber(values.longitude),
    planned_date: values.planned_date || null,
    visited_date: values.visited_date || null,
    estimated_cost: Number(values.estimated_cost || 0),
    actual_cost: Number(values.actual_cost || 0),
    rating: values.rating ? Number(values.rating) : null,
    would_repeat: values.status === "visited" ? values.would_repeat : null,
    companion: values.companion.trim() || null,
    notes: values.notes.trim() || null,
    category_id: values.category_id || null,
  };
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}
