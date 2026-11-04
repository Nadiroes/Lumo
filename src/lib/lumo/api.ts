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
