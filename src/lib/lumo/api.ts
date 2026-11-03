/** Appels API côté client */

import type { HfModel } from './types'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export async function apiChat(messages: ChatTurn[], system?: string): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, system }),
  })
  const json = await res.json()
  if (!res.ok || !json.ok) throw new Error(json.error || 'Le moteur Lumo est indisponible.')
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
