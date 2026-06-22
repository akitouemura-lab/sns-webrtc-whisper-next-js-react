export type Caption = {
  id: number;
  session_id: string;
  chunk_index: number;
  source_language: string;
  target_language: string;
  transcript: string;
  translation: string | null;
  duration_ms: number | null;
  provider: string;
  warning: string | null;
  created_at: string;
};

export type Session = {
  id: string;
  title: string;
  source_language: string;
  target_language: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
  caption_count: number;
};

export type DiagnosticResponse = {
  text: string;
  language: string;
  duration_ms: number | null;
  provider: string;
  warning: string | null;
};

export type VocabularyItem = {
  term: string;
  count: number;
  example: string;
  meaning: string | null;
};

export type ServiceStatus = {
  whisper: Record<string, string | boolean | number>;
  translation: Record<string, string | boolean | number>;
};

export type TranscriptionResponse = {
  session: Session;
  caption: Caption;
};

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getHealth() {
  return request<ServiceStatus>("/api/health");
}

export function getSessions(query?: string) {
  const params = query?.trim()
    ? `?query=${encodeURIComponent(query.trim())}`
    : "";
  return request<Session[]>(`/api/sessions${params}`);
}

export function getCaptions(sessionId: string) {
  return request<Caption[]>(`/api/sessions/${sessionId}/captions`);
}

export function updateSessionTitle(sessionId: string, title: string) {
  return request<Session>(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  });
}

export function summarizeSession(sessionId: string, style = "brief") {
  return request<{ session_id: string; summary: string }>(
    `/api/sessions/${sessionId}/summary?style=${encodeURIComponent(style)}`,
    { method: "POST" }
  );
}

export function uploadAudioChunk(formData: FormData) {
  return request<TranscriptionResponse>("/api/transcribe", {
    method: "POST",
    body: formData
  });
}

export function diagnoseAudioChunk(formData: FormData) {
  return request<DiagnosticResponse>("/api/diagnose", {
    method: "POST",
    body: formData
  });
}

export function getVocabulary(sessionId: string) {
  return request<VocabularyItem[]>(`/api/sessions/${sessionId}/vocabulary`);
}

export async function exportSession(sessionId: string, format: string) {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${sessionId}/export?format=${encodeURIComponent(
      format
    )}`
  );
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.blob();
}
