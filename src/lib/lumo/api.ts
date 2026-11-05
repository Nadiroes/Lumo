/** Appels API côté client */

import type { HfDetectResult, HfModel } from './types'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Métadonnées de chaîne renvoyées par le serveur (repli, traçabilité) */
export interface ChainMeta {
  providerUsed?: string
  chain?: { source: string; model?: string; ok: boolean; error?: string }[]
  note?: string
}

export interface ChatOverride {
  provider?: 'lumo-core' | 'mistral' | 'agnes' | 'hf' | 'openai' | 'openrouter' | 'groq' | 'custom'
  hfModel?: string
  /** Modèle du lien HF général — sert de relais si hfModel échoue (quota…) */
  globalHf?: string
  /** Modèle local (GGUF, runtime CPU llama.cpp) — tête de chaîne de repli */
  localModel?: string
}

export async function apiChat(
  messages: ChatTurn[],
  system?: string,
  override?: ChatOverride,
  onMeta?: (meta: ChainMeta) => void,
): Promise<string> {
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
  onMeta?.({ providerUsed: json.providerUsed, chain: json.chain, note: json.note })
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
  onMeta?: (meta: ChainMeta) => void,
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
    // Réponse JSON (erreur, chaîne de repli ou repli serveur sans streaming)
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) {
      const err = new Error(json.error || 'Le moteur Lumo est indisponible.') as Error & { fallback?: string[] }
      if (Array.isArray(json.available)) err.fallback = json.available
      else if (json.fallback) err.fallback = ['mistral', 'agnes', 'hf']
      throw err
    }
    const content = String(json.content || '')
    onDelta(content, content)
    onMeta?.({ providerUsed: json.providerUsed, chain: json.chain, note: json.note })
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

export async function apiImage(
  prompt: string,
  size: string,
  hf?: { model?: string; globalHf?: string },
): Promise<{ base64: string; bytes: number; engine?: string; note?: string }> {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, size, ...(hf ?? {}) }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'La génération d’image a échoué.')
  return {
    base64: String(json.base64),
    bytes: Number(json.bytes || 0),
    engine: json.engine ? String(json.engine) : undefined,
    note: json.note ? String(json.note) : undefined,
  }
}

/* ---------------- Moteur local (llama.cpp CPU) ---------------- */

export interface LocalEngineStatus {
  running: boolean
  port?: number
}

export interface LocalDownloadState {
  id: string
  repoId: string
  file: string
  status: 'download' | 'done' | 'error'
  bytes: number
  total: number
  startedAt: number
  error?: string
  speed?: number
}

export interface LocalCatalogEntry {
  id: string
  title: string
  repo: string
  kind: string
  engine: 'llamacpp' | 'pipeline'
  file?: string
  sizeBytes?: number
  installed: boolean
}

export interface LocalStatus {
  ok: true
  runtime: { installed: boolean; dir?: string; version?: string; url: string }
  disk: { totalBytes: number; freeBytes: number }
  ram: { totalBytes: number; freeBytes: number }
  models: {
    id: string
    repoId: string
    file: string
    size: number
    addedAt: number
    engine: LocalEngineStatus
  }[]
  downloads: LocalDownloadState[]
  catalog?: LocalCatalogEntry[]
}

export async function apiLocalStatus(): Promise<LocalStatus> {
  const res = await fetch('/api/local')
  return (await res.json()) as LocalStatus
}

export async function apiLocalAction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !json.ok) throw new Error(json.error || 'Action du moteur local impossible.')
  return json as Record<string, unknown>
}

/** Détection d'un lien HF : dépôt précis, organisation (liste des modèles) ou recherche */
export async function apiHfDetect(link: string, dir?: string): Promise<HfDetectResult> {
  const qs = new URLSearchParams({ id: link })
  if (dir) qs.set('dir', dir)
  const res = await fetch(`/api/hf-model?${qs.toString()}`)
  const json = (await res.json()) as HfDetectResult
  if (!res.ok || !json.ok) throw new Error(json.error || 'Lien introuvable sur le Hub.')
  return json
}

export async function apiHfLookup(id: string): Promise<HfModel> {
  const r = await apiHfDetect(id)
  if (r.kind === 'org') {
    throw new Error(
      r.models?.length
        ? `« ${r.query} » est une organisation : ${r.models.length} modèles proposés ci-dessous — choisissez celui à charger.`
        : `« ${r.query} » est une organisation sans modèle public répertorié.`,
    )
  }
  if (r.kind === 'search') {
    throw new Error(
      r.models?.length
        ? `Dépôt exact introuvable : ${r.models.length} modèles correspondants proposés ci-dessous.`
        : 'Dépôt introuvable sur le Hub.',
    )
  }
  if (!r.model) throw new Error('Modèle introuvable.')
  return r.model
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
  /** Instrumental : DiffRhythm compose sans voix chantées */
  instrumental?: boolean
  /** Qualité de rendu : rapide | standard | studio (solveur + nombre de pas de diffusion) */
  quality?: 'rapide' | 'standard' | 'studio'
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
  /** Présélection de rendu utilisée (badge du lecteur) */
  quality?: string
  steps?: number
  solver?: string
  /** true si le morceau a été découpé à la durée demandée (fondu de sortie) */
  trimmed?: boolean
}

/** Tentative de studio exécutée directement depuis le navigateur (quota ZeroGPU propre à l'IP de l'utilisateur). */
export interface ClientStudioAttempt {
  space: string
  label: string
  params: Record<string, unknown>
}

export interface ClientStudioEvent {
  reason: string
  title: string
  lrc: string
  attempts: ClientStudioAttempt[]
}

export interface MusicStreamHandlers {
  onLyrics?: (lrc: string, title: string, source: string) => void
  onStudio?: (engine: string) => void
  /** Une tentative de studio démarre (compte HF, accès public, DiffRhythm 1…) */
  onStudioAttempt?: (label: string) => void
  /** Une tentative a échoué, la suivante démarre — reason est lisible par l'utilisateur */
  onStudioRetry?: (label: string, reason: string) => void
  /** Les chemins serveur ont échoué : tentatives à relancer depuis le navigateur */
  onClientStudio?: (evt: ClientStudioEvent) => void
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
        case 'studio-attempt':
          handlers.onStudioAttempt?.(String(evt.label ?? ''))
          break
        case 'studio-retry':
          handlers.onStudioRetry?.(String(evt.label ?? ''), String(evt.reason ?? ''))
          break
        case 'client-studio':
          handlers.onClientStudio?.({
            reason: String(evt.reason ?? ''),
            title: String(evt.title ?? ''),
            lrc: String(evt.lrc ?? ''),
            attempts: (Array.isArray(evt.attempts) ? evt.attempts : []) as ClientStudioAttempt[],
          })
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

/* ---------------- Pipelines locaux (YuE, TTS, image, embeddings) ---------------- */

export type PipelineId = 'yue' | 'audio8-tts' | 'moss-image' | 'embeddinggemma'

export interface PipelineHardware {
  gpu: boolean
  ramTotalBytes: number
  ramOk: boolean
  diskFreeBytes: number
  diskOk: boolean
}

export interface PipelineJob {
  id: string
  pipelineId: PipelineId
  kind: 'setup' | 'download' | 'run'
  status: 'run' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  lines: string[]
  error?: string
}

export interface PipelineStatus {
  id: PipelineId
  label: string
  kind: 'music' | 'tts' | 'image' | 'embedding'
  description: string
  totalBytes: number
  weightsDir: string
  bytesDownloaded: number
  weightsComplete: boolean
  ready: boolean
  hardware: PipelineHardware
  jobs: PipelineJob[]
}

export interface PipelinesStatus {
  ok: boolean
  env: { installed: boolean; ready: boolean; error?: string }
  ram: { totalBytes: number; freeBytes: number }
  cpus: number
  pipelines: PipelineStatus[]
}

export async function apiPipelinesStatus(): Promise<PipelinesStatus> {
  const res = await fetch('/api/pipelines')
  const json = (await res.json()) as PipelinesStatus
  if (!res.ok || !json.ok) throw new Error('Pipelines indisponibles.')
  return json
}

export async function apiPipelinesAction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/pipelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { ok?: boolean; error?: string }
  if (!res.ok || !json.ok) throw new Error(json.error || 'Action du pipeline impossible.')
  return json as Record<string, unknown>
}

export interface PipelineRunHandlers {
  onWeights?: (repo: string, file: string, pct: number) => void
  onStage?: (evt: Record<string, unknown>) => void
}

/**
 * Exécute un pipeline (/api/pipelines action run) et consomme son flux NDJSON :
 * événements {stage} au fil de l'eau puis {stage:'done', …} ou {stage:'error'}.
 */
export async function apiPipelineRun(
  id: PipelineId,
  args: Record<string, unknown>,
  handlers: PipelineRunHandlers,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetch('/api/pipelines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'run', id, args }),
    signal,
  })
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error || `Le pipeline a répondu ${res.status}.`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let final: Record<string, unknown> | null = null
  for (;;) {
    let done = false
    let value: Uint8Array | undefined
    try {
      ;({ done, value } = await reader.read())
    } catch {
      if (signal?.aborted) throw new Error('Génération interrompue.')
      throw new Error('Flux du pipeline interrompu.')
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
      if (evt.stage === 'weights') {
        handlers.onWeights?.(String(evt.repo ?? ''), String(evt.file ?? ''), Number(evt.pct ?? 0))
      } else if (evt.stage === 'done') {
        final = evt
      } else if (evt.stage === 'error') {
        throw new Error(String(evt.message ?? 'Échec du pipeline.'))
      } else {
        handlers.onStage?.(evt)
      }
    }
  }
  if (!final) throw new Error('Le pipeline n’a pas abouti.')
  return final
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
