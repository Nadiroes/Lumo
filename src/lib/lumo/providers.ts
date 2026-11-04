/** Catalogue des fournisseurs de modèles (couche d’abstraction « Provider ») */

import type { HfModel, ModelSelection } from './types'

export type Capability = 'text' | 'image' | 'video' | 'audio'

export interface ProviderInfo {
  id: string
  name: string
  vendor: string
  caps: Capability[]
  description: string
  kind: 'builtin' | 'hf'
}

export const BUILTIN_PROVIDERS: ProviderInfo[] = [
  {
    id: 'lumo-core',
    name: 'Lumo Core',
    vendor: 'Lumo',
    caps: ['text'],
    description: 'Moteur conversationnel intégré — actif dans cette démo',
    kind: 'builtin',
  },
  {
    id: 'agnes-ai',
    name: 'Agnes AI',
    vendor: 'Agnes',
    caps: ['text', 'image', 'video', 'audio'],
    description: 'Studio multimodal complet — image, vidéo, audio synchronisé',
    kind: 'builtin',
  },
  {
    id: 'mistral-large',
    name: 'Mistral Large',
    vendor: 'Mistral AI',
    caps: ['text'],
    description: 'Raisonnement, rédaction longue, code',
    kind: 'builtin',
  },
  {
    id: 'mistral-voxtral',
    name: 'Voxtral',
    vendor: 'Mistral AI',
    caps: ['audio'],
    description: 'Transcription et compréhension audio',
    kind: 'builtin',
  },
]

export const DEFAULT_MODELS: ModelSelection = {
  text: 'lumo-core',
  image: 'agnes-ai',
  video: 'agnes-ai',
  audio: 'mistral-voxtral',
}

/** Traduit une tâche Hugging Face en capacités Lumo (une même Famille peut servir plusieurs capacités) */
export function hfTaskToCaps(task: string, modelId = ''): Capability[] {
  const t = `${task} ${modelId}`.toLowerCase()
  const caps: Capability[] = []
  if (
    t.includes('text-to-image') ||
    t.includes('inpaint') ||
    t.includes('img2img') ||
    t.includes('image-to-image')
  )
    caps.push('image')
  if (t.includes('text-to-video') || t.includes('image-to-video') || t.includes('video')) caps.push('video')
  if (
    t.includes('speech') ||
    t.includes('audio') ||
    t.includes('tts') ||
    t.includes('asr') ||
    t.includes('voice') ||
    t.includes('music')
  )
    caps.push('audio')
  // Familles textuelles (et modèles « tout-en-un »)
  const isTextual =
    t.includes('text-generation') ||
    t.includes('conversational') ||
    t.includes('text2text') ||
    t.includes('question-answering') ||
    t.includes('qwen') ||
    t.includes('llama') ||
    t.includes('mistral') ||
    t.includes('glm') ||
    t.includes('gemma') ||
    t.includes('phi') ||
    t.includes('deepseek') ||
    t.includes('omni')
  if (isTextual || caps.length === 0) caps.unshift('text')
  // Modèles vision-langage : texte + image
  if (/-vl|-vision|vision|vlm|omni/.test(t) && !caps.includes('image')) caps.push('image')
  return [...new Set(caps)]
}

/** Heuristique de tâche quand l’API HF est injoignable */
export function inferHfTask(modelId: string): string {
  const id = modelId.toLowerCase()
  if (/(stable-diffusion|sdxl|flux|diffusion|pixart|kandinsky|playground)/.test(id)) return 'text-to-image'
  if (/(whisper|wav2vec|asr|scribe)/.test(id)) return 'automatic-speech-recognition'
  if (/(tts|bark|vits|speech|voice)/.test(id)) return 'text-to-speech'
  if (/(video|anim|movi|cogvideo|mochi|ltx)/.test(id)) return 'text-to-video'
  return 'text-generation'
}

export function hfToProvider(m: HfModel): ProviderInfo {
  const caps = hfTaskToCaps(m.task, m.id)
  const fileLabel = m.file ? ` · ${m.file.split('/').pop()}` : ''
  const sizeLabel = m.sizeBytes
    ? ` · ${m.sizeBytes >= 1_073_741_824 ? `${(m.sizeBytes / 1_073_741_824).toFixed(1)} Go` : `${Math.round(m.sizeBytes / 1_048_576)} Mo`}`
    : ''
  const kindLabel = m.kind === 'dataset' ? 'Jeu de données HF' : 'Modèle HF'
  return {
    id: `hf:${m.id}${m.file ? `::${m.file}` : ''}`,
    name: (m.id.split('/').pop() || m.id) + fileLabel,
    vendor: m.id.split('/')[0] || 'Hugging Face',
    caps: m.kind === 'dataset' ? [] : caps,
    description: `${kindLabel} · ${m.task}${m.downloads ? ` · ${m.downloads.toLocaleString('fr-FR')} téléchargements` : ''}${sizeLabel}`,
    kind: 'hf',
  }
}

export function allProviders(hf: HfModel[]): ProviderInfo[] {
  return [...BUILTIN_PROVIDERS, ...hf.map(hfToProvider)]
}

export function providersFor(hf: HfModel[], cap: Capability): ProviderInfo[] {
  return allProviders(hf).filter((p) => p.caps.includes(cap))
}

export function getProvider(hf: HfModel[], id: string): ProviderInfo | undefined {
  return allProviders(hf).find((p) => p.id === id)
}
