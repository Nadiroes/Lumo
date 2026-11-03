/** Types du noyau Lumo */

export type Mode = 'text' | 'image' | 'video' | 'audio' | 'book' | 'project' | 'free'

export type ArtifactKind = 'image' | 'audio' | 'video' | 'text' | 'bible' | 'plan' | 'transcript'

export interface Artifact {
  id: string
  kind: ArtifactKind
  name: string
  mimeType: string
  createdAt: number
  provider: string
  prompt?: string
  /** Contenu texte (bible, plan, transcription…) */
  text?: string
  /** Données binaires en base64 (images) — persistées dans IndexedDB */
  data?: string
  bytes?: number
  /** Artefact de démonstration (vidéo/audio simulés) */
  demo?: boolean
  meta?: Record<string, string | number | boolean>
}

export type MessageFlow = 'chat' | 'image' | 'video' | 'audio-voice' | 'audio-transcript'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  provider?: string
  artifacts?: Artifact[]
  pending?: boolean
  stopped?: boolean
  error?: string
  flow?: MessageFlow
}

export interface BookBrief {
  title?: string
  genre: string
  subgenre?: string
  audience: string
  tones: string[]
  themes?: string
  pov: string
  tense: string
  setting?: string
  protagonist?: string
  worldRules?: string
  length: string
  structure: string
}

export interface ModelSelection {
  text: string
  image: string
  video: string
  audio: string
}

export interface ExportRecord {
  version: string
  exportedAt: number
  files: number
  bytes: number
  keptInProject: boolean
}

export interface Session {
  id: string
  title: string
  mode: Mode
  brief?: BookBrief
  messages: Message[]
  models: ModelSelection
  pinned?: boolean
  savedToProject?: boolean
  createdAt: number
  updatedAt: number
  exports: ExportRecord[]
}

export interface HfModel {
  id: string
  task: string
  downloads?: number
  likes?: number
  source: 'api' | 'heuristique'
  addedAt: number
}

export interface ModeInfo {
  label: string
  tagline: string
  description: string
  /** capacité principale pilotant le sélecteur de modèles */
  capability: 'text' | 'image' | 'video' | 'audio'
}

export const MODE_INFO: Record<Mode, ModeInfo> = {
  text: {
    label: 'Texte',
    tagline: 'Rédiger, analyser, coder, réfléchir',
    description: 'Rédaction, résumés, code, brainstorming, reformulation.',
    capability: 'text',
  },
  image: {
    label: 'Image',
    tagline: 'Générer, éditer, styliser des visuels',
    description: 'Génération d’images, 4 variations, styles et formats.',
    capability: 'image',
  },
  video: {
    label: 'Vidéo',
    tagline: 'Créer des clips, animer des images',
    description: 'Clips courts et animations (rendu Agnes AI à brancher).',
    capability: 'video',
  },
  audio: {
    label: 'Audio',
    tagline: 'Voix, transcription, synchronisation',
    description: 'Synthèse vocale et transcription de fichiers audio.',
    capability: 'audio',
  },
  book: {
    label: 'Livre',
    tagline: 'Direction artistique, puis écriture',
    description: 'Wizard de direction artistique puis co-écriture chapitre par chapitre.',
    capability: 'text',
  },
  project: {
    label: 'Projet',
    tagline: 'Brief multi-artefacts',
    description: 'Lumo décompose votre livrable en plan d’action et artefacts.',
    capability: 'text',
  },
  free: {
    label: 'Libre',
    tagline: 'Conversation multimodale',
    description: 'Commencez en texte, ajoutez images et médias en route.',
    capability: 'text',
  },
}
