/** Types du noyau Lumo */

export type Mode =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'book'
  | 'project'
  | 'free'
  | 'webdev'
  | 'appdesign'

export type ArtifactKind =
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'bible'
  | 'plan'
  | 'transcript'
  | 'webcode'
  | 'design'

/** Frameworks du mode Dev Web */
export type WebFramework = 'html' | 'javascript' | 'typescript' | 'react' | 'next' | 'php'

export const WEB_FRAMEWORKS: { value: WebFramework; label: string }[] = [
  { value: 'html', label: 'HTML + CSS' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'react', label: 'React' },
  { value: 'next', label: 'Next.js' },
  { value: 'php', label: 'PHP' },
]

/** Frameworks d’export du mode App Design */
export type AppFramework = WebFramework | 'flutterflow'

export const APP_FRAMEWORKS: { value: AppFramework; label: string }[] = [
  ...WEB_FRAMEWORKS,
  { value: 'flutterflow', label: 'FlutterFlow (Flutter)' },
]

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
  /** Fichiers de code (artefact webcode) — sérialisés dans meta.files */
  files?: CodeFile[]
}

export type MessageFlow =
  | 'chat'
  | 'image'
  | 'video'
  | 'audio-voice'
  | 'audio-transcript'
  | 'audio-music'
  | 'webdev'
  | 'appdesign'

/** Fichier de code généré (mode Dev Web ou App Design) */
export interface CodeFile {
  name: string
  lang: string
  content: string
}

/** Pièce jointe d’un message (texte lisible, ou simple référence) */
export interface Attachment {
  name: string
  size: number
  type: string
  /** Contenu texte extrait (fichiers texte) — inclus dans le prompt */
  text?: string
}

/** Suivi d'activité des agents Lumo (style DeepSeek/ChatGPT, repliable) */
export interface AgentActivity {
  label: string
  steps: { label: string; state: 'done' | 'run' | 'todo' }[]
  /** Arborescence en cours de création (mode Dev Web) */
  files?: { name: string; state: 'writing' | 'done' }[]
  note?: string
}

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
  attachments?: Attachment[]
  /** Alternatives proposées quand le modèle est indisponible */
  fallback?: string[]
  /** Suivi temps réel des agents (Dev Web, App Design…) */
  activity?: AgentActivity
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
  /** Fichier de poids choisi (.safetensors, .gguf…) quand on connecte un fichier précis */
  file?: string
  sizeBytes?: number
  /** « model » par défaut — « dataset » pour les jeux de données HF (non exécutables) */
  kind?: 'model' | 'dataset'
  /** Fichiers détectés sur le dépôt HF (proposés au branchement / téléchargement) */
  files?: { path: string; size: number; ext: string }[]
}

export interface ModeInfo {
  label: string
  tagline: string
  description: string
  /** capacité principale pilotant le sélecteur de modèles */
  capability: 'text' | 'image' | 'video' | 'audio'
}

export const MODE_INFO: Record<Mode, ModeInfo> = {
  webdev: {
    label: 'Dev Web',
    tagline: 'Sites et apps web, en vrai code',
    description:
      'Générez un site ou une app web complète : HTML, CSS, JavaScript, TypeScript, React, Next.js ou PHP — avec aperçu live et code exportable.',
    capability: 'text',
  },
  appdesign: {
    label: 'App Design',
    tagline: 'Studio WYSIWYG, de l’écran au code',
    description:
      'Concevez votre application visuellement avec l’assistant de conception pas à pas, puis exportez le code : React, HTML, PHP ou FlutterFlow.',
    capability: 'text',
  },
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
    description:
      'Storyboard en plans réels, aperçu animé jouable (mouvement de caméra + fondus) — rendu mp4 à brancher.',
    capability: 'video',
  },
  audio: {
    label: 'Audio',
    tagline: 'Voix, chansons DiffRhythm, transcription',
    description: 'Synthèse vocale, génération de musique (façon Suno) et transcription de fichiers audio.',
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
