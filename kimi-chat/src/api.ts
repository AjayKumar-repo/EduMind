// Shared calls to the EduMind backend.
export const API_BASE_URL = "http://127.0.0.1:8000";

export const BACKEND_UNREACHABLE =
  "Can't reach the EduMind backend at http://127.0.0.1:8000. Is it running?";

async function errorDetail(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({} as { detail?: string }));
  return (data as { detail?: string }).detail || `Request failed (${response.status})`;
}

function friendly(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") return error as Error;
  if (error instanceof TypeError) return new Error(BACKEND_UNREACHABLE);
  return error instanceof Error ? error : new Error(String(error));
}

/** Stream a chat answer, calling onDelta with each new piece of text. Resolves with the full text. */
export async function streamChat(
  body: { message: string; active_documents: string[]; learning_style?: string | null },
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw friendly(error);
  }
  if (!response.ok || !response.body) throw new Error(await errorDetail(response));

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        full += chunk;
        onDelta(chunk);
      }
    }
  } catch (error) {
    throw friendly(error);
  }
  return full;
}

export type MindMapNode = { title: string; note?: string; children: MindMapNode[] };
export type AudioScript = { title: string; segments: { speaker: "Maya" | "Leo"; text: string }[] };

async function postStudio<T>(path: string, documents: string[], signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documents }),
      signal,
    });
  } catch (error) {
    throw friendly(error);
  }
  if (!response.ok) throw new Error(await errorDetail(response));
  return response.json();
}

export const generateMindMap = (documents: string[], signal?: AbortSignal) =>
  postStudio<MindMapNode>("/studio/mindmap", documents, signal);

export const generateAudioScript = (documents: string[], signal?: AbortSignal) =>
  postStudio<AudioScript>("/studio/audio-overview", documents, signal);

export async function resetChat(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/chat/reset`, { method: "POST" });
  } catch {
    /* backend offline: nothing to reset */
  }
}

/** Small localStorage helpers that never throw (private windows, blocked storage). */
export const store = {
  get<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

export const docsKey = (prefix: string, documents: string[]) =>
  `${prefix}:${[...documents].sort().join("|")}`;
