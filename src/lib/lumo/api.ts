/** Appels API côté client */

import type { HfModel } from './types'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatOverride {
  provider?: 'lumo-core' | 'mistral' | 'agnes' | 'hf' | 'openai' | 'openrouter' | 'groq' | 'custom'
  hfModel?: string
}

export async function apiChat(messages: ChatTurn[], system?: string, override?: ChatOverride): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system, ...(override ?? {}) }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) {
    const err = new Error(json.error || 'Le moteur Lumo est indisponible.') as Error & { fallback?: string[] }
    if (Array.isArray(json.available)) err.fallback = json.available
    else if (json.fallback) err.fallback = ['mistral', 'agnes', 'hf']
    throw err
  }
  return String(json.content || '')
}

/**
 * Chat en streaming : les deltas arrivent au fil de la génération du modèle.
 * Repli automatique sur l'appel non-streamé si le flux échoue avant le premier token.
 */
export async function apiChatStream(
  messages: ChatTurn[],
  system: string | undefined,
  onDelta: (full: string, delta: string) => void,
  override?: ChatOverride,
  signal?: AbortSignal,
): Promise<string> {
  let res: Response
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, system, stream: true, ...(override ?? {}) }),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw new Error('Génération interrompue.')
    throw e
  }
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('text/plain') || !res.body) {
    // Réponse JSON (erreur ou repli serveur sans streaming)
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) {
      const err = new Error(json.error || 'Le moteur Lumo est indisponible.') as Error & { fallback?: string[] }
      if (Array.isArray(json.available)) err.fallback = json.available
      else if (json.fallback) err.fallback = ['mistral', 'agnes', 'hf']
      throw err
    }
    const content = String(json.content || '')
    onDelta(content, content)
    return content
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    let done = false
    let value: Uint8Array | undefined
    try {
      ;({ done, value } = await reader.read())
    } catch {
      if (signal?.aborted) throw new Error('Génération interrompue.')
      throw new Error('Flux interrompu.')
    }
    if (done) break
    const text = decoder.decode(value, { stream: true })
    if (text.includes('\u0000ERROR:')) {
      const msg = text.split('\u0000ERROR:')[1] || 'Erreur moteur'
      throw new Error(msg.trim())
    }
    full += text
    onDelta(full, text)
  }
  if (!full.trim()) throw new Error('Réponse vide du moteur.')
  return full
}

export async function apiImage(prompt: string, size: string): Promise<{ base64: string; bytes: number }> {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, size }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'La génération d’image a échoué.')
  return { base64: String(json.base64), bytes: Number(json.bytes || 0) }
}

export async function apiHfLookup(id: string): Promise<HfModel> {
  const res = await fetch(`/api/hf-model?id=${encodeURIComponent(id)}`)
  const json = await res.json()
  if (!res.ok || !json.ok || !json.model) throw new Error(json.error || 'Modèle introuvable.')
  return json.model as HfModel
}

/** URL de téléchargement direct d'un fichier HF (les dépôts privés demandent un token) */
export function hfResolveUrl(id: string, file: string, kind?: string): string {
  const base = kind === 'dataset' ? `https://huggingface.co/datasets/${id}` : `https://huggingface.co/${id}`
  return `${base}/resolve/main/${file}`
}

/* ---------------- Voix (TTS réel) ---------------- */

export async function apiTts(
  text: string,
  voice: string,
  speed = 1,
): Promise<{ base64: string; bytes: number }> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, speed }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'La synthèse vocale a échoué.')
  return { base64: String(json.base64), bytes: Number(json.bytes || 0) }
}

/* ---------------- Transcription (ASR réel) ---------------- */

export interface AsrSegment {
  start: number
  end: number
  text: string
}

export async function apiAsr(base64: string): Promise<{ text: string; segments: AsrSegment[] }> {
  const res = await fetch('/api/asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64 }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'La transcription a échoué.')
  return { text: String(json.text || ''), segments: (json.segments ?? []) as AsrSegment[] }
}

/* ---------------- Musique (studio DiffRhythm 2) ---------------- */

export interface MusicRequest {
  prompt: string
  lyrics?: string
  tags?: string
  style?: string
  duration?: number
  format?: 'mp3' | 'wav' | 'ogg'
}

export interface MusicDoneEvent {
  engine: string
  title: string
  lrc: string
  base64: string
  bytes: number
  mime: string
  durationSec: number
}

export interface MusicStreamHandlers {
  onLyrics?: (lrc: string, title: string, source: string) => void
  onStudio?: (engine: string) => void
  onFallback?: (reason: string) => void
  onDone?: (evt: MusicDoneEvent) => void
  /** Appelé si le serveur renvoie une erreur HTTP (pas de flux du tout) */
  onError?: (message: string) => void
}

/**
 * Studio musical façon Suno : paroles → DiffRhythm 2 (Hugging Face) → audio réel.
 * Consomme le flux NDJSON de /api/music et délègue chaque étape aux handlers.
 */
export async function apiMusicStream(req: MusicRequest, handlers: MusicStreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    })
  } catch (e) {
    if (signal?.aborted) throw new Error('Génération interrompue.')
    handlers.onFallback?.('studio injoignable')
    return
  }
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}))
    handlers.onError?.(json.error || `Le studio musical a répondu ${res.status}.`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    let done = false
    let value: Uint8Array | undefined
    try {
      ;({ done, value } = await reader.read())
    } catch {
      if (signal?.aborted) throw new Error('Génération interrompue.')
      handlers.onFallback?.('flux interrompu')
      return
    }
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let evt: Record<string, unknown>
      try {
        evt = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      switch (evt.stage) {
        case 'lyrics':
          handlers.onLyrics?.(String(evt.lrc ?? ''), String(evt.title ?? ''), String(evt.source ?? ''))
          break
        case 'studio':
          handlers.onStudio?.(String(evt.engine ?? 'DiffRhythm 2'))
          break
        case 'done':
          handlers.onDone?.(evt as unknown as MusicDoneEvent)
          break
        case 'fallback':
          handlers.onFallback?.(String(evt.reason ?? 'studio indisponible'))
          break
      }
    }
  }
}

/* ---------------- Clés API ---------------- */

export interface ApiKeyRow {
  id: string
  provider: string
  name: string
  maskedKey: string
  baseUrl?: string | null
  status: string
  lastCheckedAt: string
  createdAt: string
}

export async function apiListKeys(): Promise<ApiKeyRow[]> {
  const res = await fetch('/api/keys')
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'Impossible de lire les clés.')
  return json.keys as ApiKeyRow[]
}

export async function apiSaveKey(
  provider: string,
  key: string,
  baseUrl?: string,
): Promise<{ detail: string }> {
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, key, baseUrl }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) {
    throw new Error(json.detail || json.error || 'Clé refusée.')
  }
  return { detail: json.detail }
}

export async function apiDeleteKey(id: string): Promise<void> {
  const res = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'Suppression impossible.')
}

/* ---------------- Mémoire (auto-apprentissage) ---------------- */

export interface MemoryRow {
  id: string
  kind: string
  content: string
  weight: number
  hits: number
  updatedAt: string
}

export async function apiListMemory(): Promise<{ count: number; memories: MemoryRow[] }> {
  const res = await fetch('/api/memory')
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'Impossible de lire la mémoire.')
  return { count: Number(json.count || 0), memories: json.memories as MemoryRow[] }
}

export async function apiClearMemory(id?: string): Promise<void> {
  const res = await fetch(`/api/memory${id ? `?id=${encodeURIComponent(id)}` : ''}`, { method: 'DELETE' })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'Purge impossible.')
}

/* ---------------- Feedback (apprentissage ↑/↓) ---------------- */

export async function apiFeedback(
  verdict: 'up' | 'down',
  userMessage: string,
  assistantContent: string,
): Promise<{ message: string }> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict, userMessage, assistantContent }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'Retour non enregistré.')
  return { message: json.message }
}
