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

/** Traduit une tâche Hugging Face en capacités Lumo */
export function hfTaskToCaps(task: string): Capability[] {
  const t = (task || '').toLowerCase()
  if (t.includes('text-to-image') || t.includes('inpaint') || t.includes('img2img')) return ['image']
  if (t.includes('text-to-video') || t.includes('image-to-video')) return ['video']
  if (
    t.includes('speech') ||
    t.includes('audio') ||
    t.includes('tts') ||
    t.includes('asr') ||
    t.includes('voice')
  )
    return ['audio']
  return ['text']
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
  return {
    id: `hf:${m.id}`,
    name: m.id.split('/').pop() || m.id,
    vendor: m.id.split('/')[0] || 'Hugging Face',
    caps: hfTaskToCaps(m.task),
    description: `Modèle HF · ${m.task}${m.downloads ? ` · ${m.downloads.toLocaleString('fr-FR')} téléchargements` : ''}`,
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
