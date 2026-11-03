/** Store central Lumo — orchestration des sessions et des flux de génération */

'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiChat, apiImage } from './api'
import { deleteArtifactData, putArtifactData } from './artifact-store'
import { DEFAULT_MODELS } from './providers'
import type {
  Artifact,
  BookBrief,
  ExportRecord,
  HfModel,
  Message,
  MessageFlow,
  Mode,
  ModelSelection,
  Session,
} from './types'

const LUMO_SYSTEM =
  'Tu es Lumo, un agent conversationnel chaleureux, lumineux et efficace. ' +
  'Réponds dans la langue de l’utilisateur (français par défaut). ' +
  'Structure tes réponses en Markdown lisible : titres courts, listes, gras sur les points clés. ' +
  'Sois concret et utile, jamais verbeux. Termine par une suggestion d’action quand c’est pertinent. ' +
  'Tu es intégré à Lumo, un studio de création multimodal avec export .zip versionné.'

const PROJECT_SYSTEM =
  LUMO_SYSTEM +
  '\n\nContexte : mode « Projet ». Tu es chef de projet créatif : décompose la demande en phases, ' +
  'jalons, livrables et artefacts (texte, image, audio, vidéo) avec des durées estimées. Termine par une section « Prochaine action ».'

const BIBLE_SYSTEM =
  'Tu es directeur littéraire. À partir du brief JSON fourni par l’utilisateur, rédige la « Bible de l’œuvre » ' +
  'en Markdown avec ces sections : Titre proposé (+ 2 alternatives), Pitch (5 lignes max), Ton & style, ' +
  'Voix narrative, Univers & règles, Personnages (principal détaillé + 2 seconds esquissés), ' +
  'Structure (actes puis 8 à 12 chapitres titrés, une ligne chacun), Thèmes & motifs récurrents, ' +
  'Ambiances visuelles & sonores. Markdown propre, sans méta-commentaire, en français.'

function bookSystem(briefMd: string): string {
  return (
    'Tu es l’assistant d’écriture de Lumo et le directeur littéraire attitré de ce projet. ' +
    'Respecte strictement la Bible de l’œuvre ci-dessous (ton, voix, univers, structure). ' +
    'Quand on te demande un chapitre, écris-le pleinement avec de la matière narrative concrète.\n\n' +
    '## BIBLE DE L’ŒUVRE\n\n' + briefMd
  )
}

export interface SendOptions {
  imageSize?: string
  variations?: number
  voice?: string
  audioTab?: 'voice' | 'transcript'
  file?: { name: string; size: number }
}

interface LumoState {
  view: 'hub' | 'chat'
  sessions: Session[]
  activeId: string | null
  hfModels: HfModel[]

  openHub: () => void
  openSession: (id: string) => void
  startSession: (mode: Mode, brief?: BookBrief) => string
  deleteSession: (id: string) => void
  togglePin: (id: string) => void
  renameSession: (id: string, title: string) => void
  setSessionMode: (id: string, mode: Mode) => void
  setSessionModel: (id: string, kind: keyof ModelSelection, providerId: string) => void

  sendMessage: (sessionId: string, text: string, opts?: SendOptions) => Promise<void>
  stopGeneration: (sessionId: string) => void
  regenerateLast: (sessionId: string) => Promise<void>
  generateBible: (sessionId: string, brief: BookBrief) => Promise<void>

  addHfModel: (model: HfModel) => void
  removeHfModel: (id: string) => void

  recordExport: (sessionId: string, record: ExportRecord) => void

  updateSession: (id: string, fn: (s: Session) => Session) => void
  updateMessage: (sessionId: string, msgId: string, patch: Partial<Message>) => void
}

/* ---- flux en cours (streaming + minuteries simulées) ---- */
const streams = new Map<
  string,
  { timer: ReturnType<typeof setInterval>; sessionId: string; resolve: (c: string) => void }
>()
const sessionTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>()

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

export const useLumo = create<LumoState>()(
  persist(
    (set, get) => {
      function updateSession(id: string, fn: (s: Session) => Session) {
        set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? fn(s) : s)) }))
      }
      function updateMessage(sessionId: string, msgId: string, patch: Partial<Message>) {
        updateSession(sessionId, (s) => ({
          ...s,
          updatedAt: Date.now(),
          messages: s.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
        }))
      }

      function addMessage(sessionId: string, msg: Message) {
        updateSession(sessionId, (s) => ({ ...s, messages: [...s.messages, msg] }))
      }

      function finalizeStream(msgId: string, stopped: boolean) {
        const entry = streams.get(msgId)
        if (!entry) return
        clearInterval(entry.timer)
        streams.delete(msgId)
      }

      function revealStream(sessionId: string, msgId: string, full: string): Promise<string> {
        return new Promise((resolve) => {
          let revealed = 0
          const chunk = Math.max(3, Math.ceil(full.length / 160))
          const timer = setInterval(() => {
            revealed = Math.min(full.length, revealed + chunk)
            updateMessage(sessionId, msgId, { content: full.slice(0, revealed) })
            if (revealed >= full.length) {
              clearInterval(timer)
              streams.delete(msgId)
              updateMessage(sessionId, msgId, { content: full, pending: false })
              resolve(full)
            }
          }, 16)
          streams.set(msgId, {
            timer,
            sessionId,
            resolve: (content) => {
              updateMessage(sessionId, msgId, { content, pending: false, stopped: true })
              resolve(content)
            },
          })
        })
      }

      function later(sessionId: string, ms: number, fn: () => void) {
        const t = setTimeout(() => {
          const set_ = sessionTimers.get(sessionId)
          if (set_) set_.delete(t)
          fn()
        }, ms)
        if (!sessionTimers.has(sessionId)) sessionTimers.set(sessionId, new Set())
        sessionTimers.get(sessionId)!.add(t)
      }

      /* ---------- flux ---------- */

      async function chatFlow(sessionId: string, history: Message[]) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const assistantId = uid()
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          pending: true,
          flow: 'chat',
          provider: session.models.text,
        })
        try {
          const turns = history
            .filter((m) => !m.pending && !m.error && m.content.trim())
            .slice(-16)
            .map((m) => ({ role: m.role, content: m.content }) as { role: 'user' | 'assistant'; content: string })
          let system = LUMO_SYSTEM
          if (session.mode === 'project') system = PROJECT_SYSTEM
          if (session.mode === 'book' && session.brief) {
            const bibleArtifact = session.messages
              .flatMap((m) => m.artifacts ?? [])
              .find((a) => a.kind === 'bible')
            system = bookSystem(
              bibleArtifact?.text ??
                'Brief : ' + JSON.stringify(session.brief, null, 2),
            )
          }
          const full = await apiChat(turns, system)
          const stillPending = get().sessions
            .find((s) => s.id === sessionId)
            ?.messages.find((m) => m.id === assistantId)?.pending
          if (stillPending) await revealStream(sessionId, assistantId, full)
          else updateMessage(sessionId, assistantId, { content: full, pending: false })
        } catch (e) {
          updateMessage(sessionId, assistantId, {
            pending: false,
            error: e instanceof Error ? e.message : 'Erreur inconnue',
            content: '',
          })
        }
      }

      async function imageFlow(sessionId: string, prompt: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const count = Math.max(1, Math.min(4, opts.variations ?? 1))
        const size = opts.imageSize ?? '1024x1024'
        const provider = session.models.image
        const assistantId = uid()
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          pending: true,
          flow: 'image',
          provider,
        })
        const results = await Promise.allSettled(
          Array.from({ length: count }, (_, i) =>
            i === 0
              ? apiImage(prompt, size)
              : new Promise<{ base64: string; bytes: number }>((resolve, reject) =>
                  setTimeout(() => apiImage(prompt, size).then(resolve, reject), i * 3000),
                ),
          ),
        )
        const artifacts: Artifact[] = []
        let ok = 0
        for (let i = 0; i < results.length; i++) {
          const r = results[i]
          if (r.status === 'fulfilled') {
            ok++
            const a: Artifact = {
              id: uid(),
              kind: 'image',
              name: `image_${String(artifacts.length + 1).padStart(3, '0')}.png`,
              mimeType: 'image/png',
              createdAt: Date.now(),
              provider,
              prompt,
              data: r.value.base64,
              bytes: r.value.bytes,
              meta: { size },
            }
            void putArtifactData(a.id, a.data)
            artifacts.push(a)
          }
        }
        const failed = count - ok
        const content =
          ok === 0
            ? `La génération d’image a échoué pour « ${truncate(prompt, 60)} ». Réessayez dans un instant.`
            : `Voici ${ok > 1 ? `les ${ok} variations` : 'votre visuel'} pour « ${truncate(prompt, 60)} ».${
                failed ? ` (${failed} tentative(s) échouée(s))` : ''
              }`
        updateMessage(sessionId, assistantId, {
          content,
          pending: false,
          artifacts,
          error: ok === 0 ? 'Génération impossible' : undefined,
        })
      }

      async function videoFlow(sessionId: string, prompt: string, opts: SendOptions = {}) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const provider = session.models.video
        const assistantId = uid()
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '🎬 Analyse du brief… découpage du storyboard…',
          createdAt: Date.now(),
          pending: true,
          flow: 'video',
          provider,
        })
        later(sessionId, 900, () =>
          updateMessage(sessionId, assistantId, { content: '🎞 Rendu des plans (1/3)…' }),
        )
        later(sessionId, 1800, () =>
          updateMessage(sessionId, assistantId, { content: '🎞 Rendu des plans (2/3)…' }),
        )
        later(sessionId, 2700, () =>
          updateMessage(sessionId, assistantId, { content: '🎞 Rendu des plans (3/3)…' }),
        )
        later(sessionId, 3600, () => {
          const artifact: Artifact = {
            id: uid(),
            kind: 'video',
            name: `clip_${Date.now().toString().slice(-5)}.mp4`,
            mimeType: 'video/mp4',
            createdAt: Date.now(),
            provider,
            prompt,
            demo: true,
            meta: { duration: opts.duration ?? '8 s', ratio: '16:9' },
          }
          updateMessage(sessionId, assistantId, {
            content: `Aperçu vidéo généré pour « ${truncate(prompt, 60)} ».\n\nLe rendu vidéo complet nécessite le branchement d’Agnes AI (image → vidéo, audio synchronisé). Cet aperçu est une simulation prête à recevoir l’API.`,
            pending: false,
            artifacts: [artifact],
          })
        })
      }

      async function audioFlow(sessionId: string, text: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const provider = session.models.audio
        const assistantId = uid()
        const voice = opts.voice ?? 'Chloé'
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content:
            opts.audioTab === 'transcript'
              ? '🎧 Analyse du fichier… transcription en cours…'
              : `🎙 Synthèse de la voix « ${voice} »…`,
          createdAt: Date.now(),
          pending: true,
          flow: opts.audioTab === 'transcript' ? 'audio-transcript' : 'audio-voice',
          provider,
        })
        if (opts.audioTab === 'transcript' && opts.file) {
          later(sessionId, 1200, () =>
            updateMessage(sessionId, assistantId, { content: '🎧 Alignement des segments et horodatage…' }),
          )
          later(sessionId, 2100, () => {
            const artifact: Artifact = {
              id: uid(),
              kind: 'transcript',
              name: `transcription_${opts.file!.name.replace(/\.[^.]+$/, '')}.md`,
              mimeType: 'text/markdown',
              createdAt: Date.now(),
              provider,
              demo: true,
              text:
                `# Transcription — ${opts.file!.name}\n\n` +
                `> **Démo** — branchez Voxtral ou Agnes AI pour transcrire réellement ce fichier (${(opts.file!.size / 1024).toFixed(0)} Ko).\n\n` +
                '[00:00] Segment de démonstration : la transcription temps réel s’affichera ici, mot après mot.\n' +
                '[00:07] Deuxième segment simulé, avec diarisation des locuteurs.\n',
            }
            updateMessage(sessionId, assistantId, {
              content: `Transcription terminée pour « ${opts.file!.name} » (démo).`,
              pending: false,
              artifacts: [artifact],
            })
          })
        } else {
          later(sessionId, 1500, () => {
            const artifact: Artifact = {
              id: uid(),
              kind: 'audio',
              name: `synthese_${Date.now().toString().slice(-5)}.wav`,
              mimeType: 'audio/wav',
              createdAt: Date.now(),
              provider,
              demo: true,
              meta: { voice },
            }
            updateMessage(sessionId, assistantId, {
              content: `Voix « ${voice} » générée pour votre texte (démo).\n\nLe flux vocal complet nécessite le branchement de l’API audio choisie. Ce lecteur est prêt à recevoir le flux.`,
              pending: false,
              artifacts: [artifact],
            })
          })
        }
      }

      /* ---------- état ---------- */
      return {
        view: 'hub',
        sessions: [],
        activeId: null,
        hfModels: [],

        openHub: () => set({ view: 'hub' }),
        openSession: (id) => set({ view: 'chat', activeId: id }),

        startSession: (mode, brief) => {
          const id = uid()
          const now = Date.now()
          const session: Session = {
            id,
            title: brief?.title?.trim() || `Nouvelle session ${mode === 'free' ? 'libre' : mode === 'book' ? 'Livre' : mode}`,
            mode,
            brief,
            messages: [],
            models: { ...DEFAULT_MODELS },
            createdAt: now,
            updatedAt: now,
            exports: [],
          }
          set((st) => ({
            sessions: [session, ...st.sessions].slice(0, 40),
            activeId: id,
            view: 'chat',
          }))
          return id
        },

        deleteSession: (id) => {
          const s = get().sessions.find((x) => x.id === id)
          s?.messages.forEach((m) => m.artifacts?.forEach((a) => void deleteArtifactData(a.id)))
          set((st) => ({
            sessions: st.sessions.filter((x) => x.id !== id),
            activeId: st.activeId === id ? null : st.activeId,
            view: st.activeId === id ? 'hub' : st.view,
          }))
        },

        togglePin: (id) =>
          updateSession(id, (s) => ({ ...s, pinned: !s.pinned })),

        renameSession: (id, title) =>
          updateSession(id, (s) => ({ ...s, title: title.trim() || s.title })),

        setSessionMode: (id, mode) => updateSession(id, (s) => ({ ...s, mode })),

        setSessionModel: (id, kind, providerId) =>
          updateSession(id, (s) => ({ ...s, models: { ...s.models, [kind]: providerId } })),

        sendMessage: async (sessionId, text, opts = {}) => {
          const trimmed = text.trim()
          if (!trimmed && !opts.file) return
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return

          const isFirstUser =
            session.messages.filter((m) => m.role === 'user').length === 0
          addMessage(sessionId, {
            id: uid(),
            role: 'user',
            content: trimmed || (opts.file ? `Transcrire « ${opts.file.name} »` : ''),
            createdAt: Date.now(),
          })
          if (isFirstUser) {
            updateSession(sessionId, (s) => ({ ...s, title: truncate(trimmed || opts.file?.name || 'Session', 42) }))
          }

          const history = get().sessions.find((s) => s.id === sessionId)!.messages

          if (session.mode === 'image') await imageFlow(sessionId, trimmed, opts)
          else if (session.mode === 'video') await videoFlow(sessionId, trimmed, opts)
          else if (session.mode === 'audio') await audioFlow(sessionId, trimmed, opts)
          else await chatFlow(sessionId, history)
        },

        stopGeneration: (sessionId) => {
          const timers = sessionTimers.get(sessionId)
          if (timers) {
            timers.forEach((t) => clearTimeout(t))
            sessionTimers.delete(sessionId)
          }
          const session = get().sessions.find((s) => s.id === sessionId)
          const pendingMsg = session?.messages.find((m) => m.pending)
          if (pendingMsg) {
            const entry = Array.from(streams.entries()).find(([, v]) => v.sessionId === sessionId)
            if (entry) {
              clearInterval(entry[1].timer)
              streams.delete(entry[0])
            }
            updateMessage(sessionId, pendingMsg.id, {
              pending: false,
              stopped: true,
              content: pendingMsg.content || 'Génération interrompue.',
            })
          }
        },

        regenerateLast: async (sessionId) => {
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return
          const lastAssistantIdx = session.messages.map((m) => m.role).lastIndexOf('assistant')
          if (lastAssistantIdx < 0) return
          const lastUser = session.messages
            .slice(0, lastAssistantIdx)
            .reverse()
            .find((m) => m.role === 'user')
          if (!lastUser) return
          const removed = session.messages[lastAssistantIdx]
          removed.artifacts?.forEach((a) => void deleteArtifactData(a.id))
          updateSession(sessionId, (s) => ({
            ...s,
            messages: s.messages.filter((_, i) => i !== lastAssistantIdx),
          }))
          const mode = session.mode
          if (mode === 'image') {
            const size = (removed.artifacts?.[0]?.meta?.size as string) ?? '1024x1024'
            const variations = (removed.artifacts?.length ?? 1) > 1 ? 4 : 1
            await imageFlow(sessionId, lastUser.content, { imageSize: size, variations })
          } else if (mode === 'video') {
            await videoFlow(sessionId, lastUser.content)
          } else if (mode === 'audio') {
            await audioFlow(sessionId, lastUser.content, { audioTab: removed.flow === 'audio-transcript' ? 'transcript' : 'voice' })
          } else {
            await chatFlow(sessionId, session.messages.slice(0, lastAssistantIdx))
          }
        },

        generateBible: async (sessionId, brief) => {
          const assistantId = uid()
          addMessage(sessionId, {
            id: assistantId,
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
            pending: true,
            flow: 'chat',
            provider: 'lumo-core',
          })
          try {
            const full = await apiChat(
              [{ role: 'user', content: 'Voici mon brief. Rédige la Bible de l’œuvre.\n\n' + JSON.stringify(brief, null, 2) }],
              BIBLE_SYSTEM,
            )
            const revealed = await revealStream(sessionId, assistantId, full)
            const artifact: Artifact = {
              id: uid(),
              kind: 'bible',
              name: 'bible_de_l_oeuvre.md',
              mimeType: 'text/markdown',
              createdAt: Date.now(),
              provider: 'lumo-core',
              text: revealed,
            }
            updateMessage(sessionId, assistantId, { artifacts: [artifact] })
          } catch (e) {
            updateMessage(sessionId, assistantId, {
              pending: false,
              error: e instanceof Error ? e.message : 'Erreur inconnue',
            })
          }
        },

        addHfModel: (model) =>
          set((st) => ({
            hfModels: st.hfModels.some((m) => m.id === model.id)
              ? st.hfModels
              : [model, ...st.hfModels],
          })),

        removeHfModel: (id) =>
          set((st) => ({ hfModels: st.hfModels.filter((m) => m.id !== id) })),

        recordExport: (sessionId, record) =>
          updateSession(sessionId, (s) => ({
            ...s,
            savedToProject: s.savedToProject || record.keptInProject,
            exports: [...s.exports, record],
          })),

        updateSession,
        updateMessage,
      }
    },
    {
      name: 'lumo-store-v1',
      version: 1,
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages
            .filter((m) => !m.pending)
            .map((m) => ({
              ...m,
              artifacts: m.artifacts?.map((a) => ({ ...a, data: undefined })),
            })),
        })),
        hfModels: state.hfModels,
      }),
    },
  ),
)
