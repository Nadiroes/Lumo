/**
 * Catalogue de modèles recommandés de Lumo — les modèles explicitement branchés
 * dans le projet (choisis par l'utilisateur), avec leur voie d'exécution :
 *
 *  - `llamacpp`  : fichier .gguf téléchargé sur le disque puis exécuté par le
 *                  runtime llama.cpp CPU (moteur local, tête de chaîne /api/chat).
 *  - `pipeline`  : environnement Python dédié (vendor/pipelines/venv) + poids HF,
 *                  exécuté hors ligne par les runners de scripts/lumo-pipelines.
 *
 * AUCUNE limite de taille artificielle : seule la capacité réelle du disque est
 * vérifiée avant chaque téléchargement (marge de sécurité incluse).
 */

import type { Mode } from './types'

export type CatalogKind = 'code' | 'vision' | 'chat' | 'embedding' | 'tts' | 'image' | 'music'

export interface CatalogVariant {
  /** Fichier exact dans le dépôt HF */
  file: string
  sizeBytes: number
  label: string
}

export interface CatalogEntry {
  id: string
  title: string
  repo: string
  kind: CatalogKind
  /** Voie d'exécution */
  engine: 'llamacpp' | 'pipeline'
  /** Blocs où cette entrée est proposée ('global' = partout) */
  modes: Mode[]
  /** Fichier recommandé (llamacpp) */
  file?: string
  sizeBytes?: number
  /** Autres quantifications téléchargeables (llamacpp) */
  variants?: CatalogVariant[]
  /** Identifiant du pipeline Python (engine='pipeline') */
  pipelineId?: string
  note?: string
}

/** GB → octets (décimal, convention HF) */
const gb = (n: number) => Math.round(n * 1e9)

/* Fichiers du dépôt huihui-ai (relevés de l'API HF, blobs=true) */
const QWEN38 = 'huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF'

export const LOCAL_CATALOG: CatalogEntry[] = [
  {
    id: 'qwen38-27b-abl',
    title: 'Qwen3.8 Coder 27B (abliterated)',
    repo: QWEN38,
    kind: 'code',
    engine: 'llamacpp',
    modes: ['webdev', 'appdesign', 'text', 'free'],
    file: 'Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf',
    sizeBytes: gb(16.6),
    variants: [
      { file: 'Huihui-Qwen3.8-27B-abliterated-UD-IQ2_S.gguf', sizeBytes: gb(8.4), label: 'IQ2_S · 8,4 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-UD-Q2_K_XL.gguf', sizeBytes: gb(10.0), label: 'Q2_K_XL · 10,0 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-UD-IQ3_XXS.gguf', sizeBytes: gb(11.0), label: 'IQ3_XXS · 11,0 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-UD-IQ4_XS.gguf', sizeBytes: gb(14.4), label: 'IQ4_XS · 14,4 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-UD-DW-Q4_K_M.gguf', sizeBytes: gb(16.6), label: 'Q4_K_M · 16,6 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-UD-Q4_K_XL.gguf', sizeBytes: gb(17.4), label: 'Q4_K_XL · 17,4 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-Q6_K.gguf', sizeBytes: gb(22.4), label: 'Q6_K · 22,4 Go' },
      { file: 'Huihui-Qwen3.8-27B-abliterated-Q8_0.gguf', sizeBytes: gb(29.0), label: 'Q8_0 · 29,0 Go' },
    ],
    note:
      'Modèle 27B multimodal (texte + image) sans garde-fous, spécialisé code et applications. ' +
      'Vision : ajoutez le projeteur mmproj-model-bf16.gguf (0,9 Go) au même dossier. ' +
      'Exige une machine généreuse (RAM ≥ taille du fichier + 2 Go) — la vérification disque est automatique.',
  },
  {
    id: 'yue2',
    title: 'YuE 2 (3B) — génération de chansons',
    repo: 'm-a-p/YuE2-3B',
    kind: 'music',
    engine: 'pipeline',
    pipelineId: 'yue',
    modes: ['labs'],
    note:
      'Modèle open source complet : paroles + style → score mélodie/accords éditable → chanson chantée 48 kHz. ' +
      'Poids : YuE2-3B (7,3 Go) + YuE2-Vae (0,5 Go). GPU 24 Go recommandé ; CPU possible mais très lent.',
  },
  {
    id: 'audio8-tts',
    title: 'Audio8 TTS Realistic Air (0.6B)',
    repo: 'Edge0/Audio8-TTS-Realistic-Air',
    kind: 'tts',
    engine: 'pipeline',
    pipelineId: 'audio8-tts',
    modes: ['audio', 'labs'],
    note:
      'Synthèse vocale réaliste 23 langues (dont français), clonage de voix zéro-shot, 44,1 kHz. ' +
      'Poids 2,6 Go — tourne sur CPU (environ 0,6 Go de RAM en fp32 + marge).',
  },
  {
    id: 'moss-image',
    title: 'MOSS-Image SFT (5B)',
    repo: 'OpenMOSS-Team/MOSS-Image-SFT',
    kind: 'image',
    engine: 'pipeline',
    pipelineId: 'moss-image',
    modes: ['image'],
    note:
      'Text-to-image 5B (rendu de texte fiable, affichages, interfaces). Poids 27,2 Go — ' +
      'nécessite un disque conséquent ; GPU fortement recommandé, CPU très lent.',
  },
  {
    id: 'embeddinggemma-2',
    title: 'EmbeddingGemma 2 (744M) — embeddings multimodaux',
    repo: 'google/embeddinggemma-2',
    kind: 'embedding',
    engine: 'pipeline',
    pipelineId: 'embeddinggemma',
    modes: ['text', 'book', 'project'],
    note:
      'Embeddings texte/images/audio/vidéo (744M) pour la recherche sémantique et le classement de documents. ' +
      'Poids 1,5 Go — tourne sur CPU.',
  },
]

/** Entrées proposées pour un bloc donné (variante « global » : tout le catalogue) */
export function catalogFor(mode?: Mode): CatalogEntry[] {
  if (!mode) return LOCAL_CATALOG
  return LOCAL_CATALOG.filter((e) => e.modes.includes(mode))
}
