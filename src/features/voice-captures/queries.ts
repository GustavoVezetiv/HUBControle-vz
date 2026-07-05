import type { AppSupabaseClient } from "@/features/shared/types";
import type { VoiceCaptureSessionWithSuggestions } from "@/features/voice-captures/types";
import type { VoiceCaptureSession, VoiceCaptureSuggestion } from "@/lib/supabase/types";

export async function listVoiceCaptureSessions(
  client: AppSupabaseClient,
  userId: string,
): Promise<{ data: VoiceCaptureSessionWithSuggestions[]; error: string | null }> {
  const [sessionsResult, suggestionsResult] = await Promise.all([
    client
      .from("voice_capture_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at_mobile", { ascending: false })
      .limit(50),
    client
      .from("voice_capture_suggestions")
      .select("*")
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
  ]);

  const error = sessionsResult.error ?? suggestionsResult.error;
  if (error) {
    console.error("[voice-captures] Failed to list voice captures", error);
    return { data: [], error: error.message };
  }

  const suggestionsBySession = new Map<string, VoiceCaptureSuggestion[]>();
  for (const suggestion of (suggestionsResult.data ?? []) as VoiceCaptureSuggestion[]) {
    const current = suggestionsBySession.get(suggestion.voice_capture_session_id) ?? [];
    current.push(suggestion);
    suggestionsBySession.set(suggestion.voice_capture_session_id, current);
  }

  return {
    data: ((sessionsResult.data ?? []) as VoiceCaptureSession[]).map((session) => ({
      ...session,
      suggestions: suggestionsBySession.get(session.id) ?? [],
    })),
    error: null,
  };
}
