/** Store central Lumo — orchestration des sessions et des flux de génération */

'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiAsr, apiChat, apiChatStream, apiImage, apiTts, type ChatOverride } from './api'
import { deleteArtifactData, putArtifactData } from './artifact-store'
import { extractDesignDoc, parseCodeBlocks, parseOpeningFiles } from './codegen'
import { generateMusic } from './music'
import { DEFAULT_MODELS } from './providers'
import type {
  Artifact,
  Attachment,
  BookBrief,
  ExportRecord,
  HfModel,
  Message,
  Mode,
  ModelSelection,
  Session,
  WebFramework,
} from './types'

const LUMO_SYSTEM =
  'Tu es Lumo, un agent conversationnel chaleureux, lumineux et efficace. ' +
  'Réponds dans la langue de l’utilisateur (français par défaut). ' +
  'Structure tes réponses en Markdown lisible : titres courts, listes, gras sur les points clés. ' +
  'Sois concret et utile, jamais verbeux. Termine par une suggestion d’action quand c’est pertinent. ' +
  'Tu es intégré à Lumo, un studio de création multimodal avec export .zip versionné. ' +
  'Tu es un agent auto-apprenant : tu t’appuies sur ta mémoire des interactions précédentes pour t’améliorer.'

const PROJECT_SYSTEM =
  LUMO_SYSTEM +
  '\n\nContexte : mode « Projet ». Tu es chef de projet créatif : décompose la demande en phases, ' +
  'jalons, livrables et artefacts (texte, image, audio, vidéo) avec des durées estimées. Termine par une section « Prochaine action ».'

/* ---------------- Mode Dev Web ---------------- */

const WEBDEV_NOTES: Record<WebFramework, string> = {
  html: 'HTML sémantique complet (index.html) + styles.css (CSS moderne : variables, flex/grid) + app.js si des interactions sont utiles.',
  javascript: 'JavaScript vanilla ES6+ dans app.js, index.html et styles.css. Aucun build, aucun framework.',
  typescript:
    'TypeScript strict et typé dans app.ts (interfaces, types explicites), index.html et styles.css. Garde un TS exécutable tel quel dans un projet TS.',
  react:
    'Composants React fonctionnels avec hooks. Pour un aperçu direct possible, fournis aussi un index.html qui charge React 18 UMD + Babel Standalone via CDN (unpkg) et monte <App />. Sinon App.jsx + composants séparés.',
  next: 'Structure Next.js App Router complète : app/layout.tsx, app/page.tsx, composants dans app/components/, TypeScript + Tailwind CSS. Indique les commandes npm en commentaire.',
  php: 'PHP 8 moderne : index.php (logique + htmlspecialchars contre XSS), traitement POST/GET, si formulaire : validation serveur. HTML/CSS responsive embarqué ou styles.css.',
}

function webDevSystem(framework: WebFramework): string {
  return (
    'Tu es Lumo Dev, ingénieur web senior. Génère un site/app web COMPLET, MODERNE et 100% RESPONSIVE ' +
    '(mobile-first) pour la demande de l’utilisateur.\n\n' +
    'FORMAT DE RÉPONSE (obligatoire) :\n' +
    '1. Deux ou trois phrases de présentation de tes choix (pas plus).\n' +
    '2. Ensuite UNIQUEMENT des blocs de code annotés du nom de fichier, un bloc par fichier :\n' +
    '```html:index.html\n…\n```\n```css:styles.css\n…\n```\n```js:app.js\n…\n```\n\n' +
    'SPÉCIFICATIONS :\n' +
    '- Police Poppins (Google Fonts), palette chaleureuse cohérente, coins arrondis, ombres douces.\n' +
    '- Responsive : media queries / flex / grid — rien ne doit déborder sur mobile (390px) comme sur desktop.\n' +
    '- Accessibilité : contrastes, aria-labels, focus visibles, navigation clavier.\n' +
    '- Contenu réaliste en français (jamais de lorem ipsum), pas de TODO.\n' +
    '- Fichiers autonomes (aucun build requis) sauf CDN si le framework l’exige.\n\n' +
    `FRAMEWORK IMPOSÉ : ${framework.toUpperCase()} — ${WEBDEV_NOTES[framework]}`
  )
}

/* ---------------- Mode App Design ---------------- */

const DESIGN_SYSTEM =
  'Tu es le directeur de conception de Lumo (mode App Design). À partir de la demande, conçois ' +
  'l’architecture UI d’une application RESPONSIVE (mobile-first).\n\n' +
  'Réponds en DEUX parties, dans cet ordre :\n' +
  '1. Trois à cinq phrases sur tes choix : type d’app, ton, style, palette.\n' +
  '2. Un UNIQUE bloc ```json contenant EXACTEMENT ce schéma :\n' +
  '{\n' +
  '  "appName": "…",\n' +
  '  "style": "moderne",\n' +
  '  "palette": { "primary": "#E8930C", "bg": "#FDF9F0", "text": "#2B2118", "card": "#FFFFFF" },\n' +
  '  "screens": [\n' +
  '    { "name": "Accueil", "elements": [\n' +
  '      { "type": "navbar", "props": { "text": "…", "links": "Accueil, Fonctions, Contact" } },\n' +
  '      { "type": "hero", "props": { "title": "…", "subtitle": "…", "cta": "…" } },\n' +
  '      { "type": "text", "props": { "text": "…", "size": "md" } }\n' +
  '    ] }\n' +
  '  ]\n' +
  '}\n\n' +
  'TYPES D’ÉLÉMENTS AUTORISÉS (rien d’autre) : navbar, hero, text, button, input, image, list, card, badge, divider, footer.\n' +
  'RÈGLES : 2 à 5 écrans, 4 à 10 éléments par écran, textes réalistes en français, palette chaleureuse contrastée (AA), ' +
  'props toujours en chaînes, aucun commentaire dans le JSON, aucun texte hors des deux parties.'

const DESIGN_REPAIR_SYSTEM =
  'Tu répares du JSON. On te fournit une réponse qui devait contenir un JSON de conception UI.\n' +
  'Réponds UNIQUEMENT avec un bloc ```json STRICTEMENT valide, même schéma :\n' +
  '{ "appName": string, "style": string, "palette": { "primary": "#hex", "bg": "#hex", "text": "#hex", "card": "#hex" },\n' +
  '  "screens": [ { "name": string, "elements": [ { "type": "navbar"|"hero"|"text"|"button"|"input"|"image"|"list"|"card"|"badge"|"divider"|"footer", "props": { …chaînes } } ] } ] }\n' +
  'Chaque clé suivie de deux-points, chaque paire séparée par des virgules, aucun commentaire, aucun texte hors du bloc.'

const DESIGN_GUIDE_SYSTEM =
  LUMO_SYSTEM +
  '\n\nContexte : mode « App Design ». Tu es l’assistant de conception de Lumo : guide l’utilisateur écran par écran ' +
  '(structure, palette, composants, accessibilité, responsive) et propose la prochaine étape concrète. Tu ne génères pas de JSON ici.'

const BIBLE_SYSTEM =
  'Tu es directeur littéraire. À partir du brief JSON fourni par l’utilisateur, rédige la « Bible de l’œuvre » ' +
  'en Markdown avec ces sections : Titre proposé (+ 2 alternatives), Pitch (5 lignes max), Ton & style, ' +
  'Voix narrative, Univers & règles, Personnages (principal détaillé + 2 seconds esquissés), ' +
  'Structure (actes puis 8 à 12 chapitres titrés, une ligne chacun), Thèmes & motifs récurrents, ' +
  'Ambiances visuelles & sonores. Markdown propre, sans méta-commentaire, en français. ' +
  'La longueur cible figure dans le brief : si elle est « Illimité », prévois une structure extensible (séquences, tomes) et dis-le.'

function bookSystem(briefMd: string): string {
  return (
    'Tu es l’assistant d’écriture de Lumo et le directeur littéraire attitré de ce projet. ' +
    'Respecte strictement la Bible de l’œuvre ci-dessous (ton, voix, univers, structure). ' +
    'Quand on te demande un chapitre, écris-le pleinement avec de la matière narrative concrète. ' +
    'Si une cible de pages est fixée dans le brief, vise-la ; si la longueur est illimitée, écris un chapitre complet ' +
    '(1 200 à 2 500 mots) et propose la suite.\n\n' +
    '## BIBLE DE L’ŒUVRE\n\n' + briefMd
  )
}

export interface SendOptions {
  imageSize?: string
  variations?: number
  voice?: string
  audioTab?: 'voice' | 'transcript' | 'music'
  file?: { name: string; size: number }
  /** Audio à transcrire, encodé en base64 par le client */
  fileBase64?: string
  attachments?: Attachment[]
  musicStyle?: string
  musicDuration?: number
  instrumental?: boolean
  framework?: string
  /** Durée du clip vidéo (ex. « 8 s ») */
  duration?: string
}

interface LumoState {
  view: 'hub' | 'chat'
  sessions: Session[]
  activeId: string | null
  hfModels: HfModel[]
  editingMsg: { sessionId: string; msgId: string } | null

  openHub: () => void
  openSession: (id: string) => void
  startSession: (mode: Mode, brief?: BookBrief) => string
  deleteSession: (id: string) => void
  togglePin: (id: string) => void
  renameSession: (id: string, title: string) => void
  setSessionMode: (id: string, mode: Mode) => void
  setSessionModel: (id: string, kind: keyof ModelSelection, providerId: string) => void

  sendMessage: (sessionId: string, text: string, opts?: SendOptions) => Promise<void>
  editMessage: (sessionId: string, msgId: string, newText: string, attachments?: Attachment[]) => Promise<void>
  retryWithProvider: (sessionId: string, provider: string, hfModel?: string) => Promise<void>
  stopGeneration: (sessionId: string) => void
  regenerateLast: (sessionId: string) => Promise<void>
  generateBible: (sessionId: string, brief: BookBrief) => Promise<void>

  addHfModel: (model: HfModel) => void
  removeHfModel: (id: string) => void

  recordExport: (sessionId: string, record: ExportRecord) => void

  updateSession: (id: string, fn: (s: Session) => Session) => void
  updateMessage: (sessionId: string, msgId: string, patch: Partial<Message>) => void
  setEditingMsg: (v: { sessionId: string; msgId: string } | null) => void
}

/* ---- flux en cours (streaming + minuteries simulées) ---- */
const streams = new Map<
  string,
  { timer: ReturnType<typeof setInterval>; sessionId: string; resolve: (c: string) => void }
>()
const sessionTimers = new Map<string, Set<ReturnType<typeof setTimeout>>>()
const aborts = new Map<string, AbortController>()

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

/** Détecte le vrai format d'une image encodée en base64 (l'API renvoie du JPEG, pas du PNG) */
function sniffImageMime(b64: string): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (b64.startsWith('/9j/')) return 'image/jpeg'
  if (b64.startsWith('UklGR')) return 'image/webp'
  return 'image/png'
}

function imageExt(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'
}

/** Bloc texte des pièces jointes, injecté dans le prompt du modèle */
function attachmentBlock(m: Message, maxPerFile = 12000): string {
  if (!m.attachments?.length) return ''
  const parts = m.attachments.map((a) =>
    a.text
      ? `--- Fichier joint : ${a.name} ---\n${a.text.slice(0, maxPerFile)}`
      : `[Pièce jointe : ${a.name} (${a.type || 'fichier'}, ${(a.size / 1024).toFixed(0)} Ko)]`,
  )
  return '\n\n[Fichiers joints par l’utilisateur]\n' + parts.join('\n\n')
}

function attachmentSummary(attachments?: Attachment[]): string {
  if (!attachments?.length) return ''
  const names = attachments.map((a) => a.name).join(', ')
  const texts = attachments
    .filter((a) => a.text)
    .map((a) => `--- ${a.name} ---\n${a.text!.slice(0, 2000)}`)
    .join('\n\n')
  return `\n\n(En tenant compte des fichiers joints : ${names})${texts ? '\n\n' + texts : ''}`
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

      async function chatFlow(
        sessionId: string,
        history: Message[],
        override?: { provider?: string; hfModel?: string },
      ) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const providerLabel =
          override?.provider === 'hf'
            ? `hf:${override.hfModel}`
            : (override?.provider ?? session.models.text)
        const assistantId = uid()
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          pending: true,
          flow: 'chat',
          provider: providerLabel,
        })
        try {
          const turns = history
            .filter((m) => !m.pending && !m.error && m.content.trim())
            .slice(-16)
            .map((m) => ({ role: m.role, content: m.content + attachmentBlock(m) }) as { role: 'user' | 'assistant'; content: string })
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
          const useOverride: ChatOverride | undefined =
            override?.provider && override.provider !== 'lumo-core'
              ? { provider: override.provider as ChatOverride['provider'], hfModel: override.hfModel }
              : undefined

          // Streaming réel : le texte s'affiche au fil de la génération du modèle
          const ac = new AbortController()
          aborts.set(sessionId, ac)
          let lastPaint = 0
          const full = await apiChatStream(
            turns,
            system,
            (content) => {
              const now = Date.now()
              if (now - lastPaint > 60) {
                lastPaint = now
                updateMessage(sessionId, assistantId, { content })
              }
            },
            useOverride,
            ac.signal,
          )
          aborts.delete(sessionId)
          updateMessage(sessionId, assistantId, { content: full, pending: false })
        } catch (e) {
          aborts.delete(sessionId)
          const err = e as Error & { fallback?: string[] }
          if (err.message === 'Génération interrompue.') {
            updateMessage(sessionId, assistantId, {
              pending: false,
              stopped: true,
              content:
                get().sessions.find((s) => s.id === sessionId)?.messages.find((m) => m.id === assistantId)?.content ||
                'Génération interrompue.',
            })
            return
          }
          updateMessage(sessionId, assistantId, {
            pending: false,
            error: err.message,
            content: '',
            fallback: err.fallback ?? ['mistral', 'agnes', 'hf'],
          })
        }
      }

      async function imageFlow(sessionId: string, prompt: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const count = Math.max(1, Math.min(4, opts.variations ?? 1))
        const size = opts.imageSize ?? '1024x1024'
        const provider = session.models.image
        const fullPrompt = prompt + attachmentSummary(opts.attachments)
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

        // Génération SÉQUENTIELLE : l’API image met 30 à 60 s par visuel,
        // les appels en parallèle provoquent des échecs en cascade.
        const started = Date.now()
        const status = (done: number) => {
          const sec = Math.round((Date.now() - started) / 1000)
          const head =
            count > 1
              ? `🎨 Génération des visuels — ${done}/${count} prêts · ⏱ ${sec} s`
              : `🎨 Génération du visuel · ⏱ ${sec} s`
          return `${head}\n\n*Une création d’image demande habituellement 30 à 60 secondes — gardez l’onglet ouvert.*`
        }
        const tick = setInterval(() => {
          const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
          if (m?.pending) updateMessage(sessionId, assistantId, { content: status(artifacts.length) })
        }, 1000)

        const artifacts: Artifact[] = []
        let failed = 0
        let lastErrorDetail = ''
        for (let i = 0; i < count; i++) {
          try {
            const r = await apiImage(fullPrompt, size)
            const mime = sniffImageMime(r.base64)
            const a: Artifact = {
              id: uid(),
              kind: 'image',
              name: `image_${String(artifacts.length + 1).padStart(3, '0')}.${imageExt(mime)}`,
              mimeType: mime,
              createdAt: Date.now(),
              provider,
              prompt: fullPrompt,
              data: r.base64,
              bytes: r.bytes,
              meta: { size },
            }
            void putArtifactData(a.id, r.base64)
            artifacts.push(a)
            // Affichage immédiat de chaque image terminée
            if (get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)?.pending) {
              updateMessage(sessionId, assistantId, {
                artifacts: [...artifacts],
                content: status(artifacts.length),
              })
            }
          } catch (e) {
            failed++
            lastErrorDetail = e instanceof Error ? e.message.slice(0, 160) : ''
          }
        }
        clearInterval(tick)

        const ok = artifacts.length
        const sec = Math.round((Date.now() - started) / 1000)
        const content =
          ok === 0
            ? `La génération d’image a échoué pour « ${truncate(prompt, 60)} » (${sec} s d’attente).${
                lastErrorDetail ? `\n\nDétail du moteur : *${lastErrorDetail}*` : ''
              }\n\nLe service image est peut-être momentanément saturé — utilisez le bouton **Réessayer** ci-dessous.`
            : `Voici ${ok > 1 ? `les ${ok} variations` : 'votre visuel'} pour « ${truncate(prompt, 60)} » (${sec} s).${
                failed ? `\n\n⚠ ${failed} variation(s) n’ont pas abouti.${lastErrorDetail ? ` Détail : ${lastErrorDetail}` : ''}` : ''
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
          content: '🎬 **Analyse du brief**… écriture du script et du découpage en plans.',
          createdAt: Date.now(),
          pending: true,
          flow: 'video',
          provider,
        })

        const basePrompt = prompt + attachmentSummary(opts.attachments)
        const duration = opts.duration ?? '8 s'
        const durSec = Number(String(duration).replace(/\D/g, '')) || 8

        // Plans du storyboard : chaque plan devient une image réelle (effet Ken Burns à la lecture)
        const plans = [
          { label: 'Plan 1/3 — cadrage d’ouverture', suffix: 'cinematic opening wide shot, dramatic light, film still' },
          { label: 'Plan 2/3 — plan rapproché', suffix: 'medium close-up shot, soft depth of field, film still' },
          { label: 'Plan 3/3 — plan final', suffix: 'final dramatic shot, golden hour lighting, film still' },
        ]
        const frames: { mime: string; base64: string }[] = []
        const started = Date.now()

        later(sessionId, 700, () =>
          updateMessage(sessionId, assistantId, {
            content: `📝 **Script validé** — ${durSec} s, 3 plans. Génération du storyboard…`,
          }),
        )

        // Génération séquentielle des plans (l’API image est lente : 30–60 s / plan)
        for (let i = 0; i < plans.length; i++) {
          const p = plans[i]
          const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
          if (!m?.pending) return
          const sec = Math.round((Date.now() - started) / 1000)
          updateMessage(sessionId, assistantId, {
            content: `🎞 ${p.label} — rendu en cours… ⏱ ${sec} s`,
          })
          try {
            const r = await apiImage(`${basePrompt}, ${p.suffix}`, '1344x768')
            frames.push({ mime: sniffImageMime(r.base64), base64: r.base64 })
            const done = Math.round((Date.now() - started) / 1000)
            updateMessage(sessionId, assistantId, {
              content: `✅ ${p.label} prêt (${done} s). ${i < plans.length - 1 ? 'Plan suivant…' : 'Assemblage de l’aperçu animé…'}`,
            })
          } catch {
            updateMessage(sessionId, assistantId, {
              content: `⚠ ${p.label} indisponible — remplacement par un plan stylisé. ${i < plans.length - 1 ? 'Plan suivant…' : 'Assemblage…'}`,
            })
          }
        }

        const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
        if (!m?.pending) return

        // Artefact vidéo : JSON de frames → lecteur animé (Ken Burns + fondus) côté affichage
        const artifact: Artifact = {
          id: uid(),
          kind: 'video',
          name: `clip_${Date.now().toString().slice(-5)}.mp4`,
          mimeType: 'application/json',
          createdAt: Date.now(),
          provider,
          prompt: basePrompt,
          demo: frames.length === 0,
          meta: { duration, ratio: '16:9', frameCount: frames.length },
        }
        // Stockage des frames dans IndexedDB — AWAIT obligatoire : sinon le lecteur
        // lit IndexedDB avant la fin de l’écriture et n’affiche qu’une image statique.
        const payload = JSON.stringify({ frames, duration: durSec, ratio: '16:9' })
        await putArtifactData(artifact.id, payload)
        // Donnée aussi en mémoire : lecture instantanée au premier rendu (persist l’exclut déjà)
        const playable: Artifact = { ...artifact, data: payload }

        updateMessage(sessionId, assistantId, {
          content:
            `🎬 **Aperçu animé prêt** pour « ${truncate(prompt, 60)} ».\n\n` +
            `${frames.length > 0
              ? `${frames.length} plan(s) généré(s) et assemblés en séquence animée (mouvement de caméra + fondus). Appuyez sur ▶ pour lire.`
              : 'Les plans n’ont pas pu être générés : l’aperçu utilise un rendu animé stylisé. Appuyez sur ▶ pour lire.'}\n\n` +
            `Pour un rendu vidéo complet (mp4), branchez une API vidéo (Agnes AI) — la structure est prête à la recevoir.`,
          pending: false,
          artifacts: [playable],
        })
      }

      async function audioFlow(sessionId: string, text: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const provider = session.models.audio
        const assistantId = uid()
        const voice = opts.voice ?? 'Chloé'
        const isTranscript = opts.audioTab === 'transcript'
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: isTranscript ? '🎧 Préparation du fichier audio…' : `🎙 Synthèse de la voix « ${voice} »…`,
          createdAt: Date.now(),
          pending: true,
          flow: isTranscript ? 'audio-transcript' : 'audio-voice',
          provider,
        })

        const firstFile = opts.file ?? opts.attachments?.[0]

        /* ---------- Transcription réelle (ASR) ---------- */
        if (isTranscript) {
          const base64 = opts.fileBase64
          const name = firstFile?.name ?? 'audio'
          if (!base64) {
            updateMessage(sessionId, assistantId, {
              pending: false,
              content: '',
              error: 'Aucun fichier audio reçu — recommencez via l’onglet Transcription.',
            })
            return
          }
          // Progression en direct : le fichier part, puis horloge d’attente (l’ASR prend 10 à 60 s)
          later(sessionId, 400, () => {
            const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
            if (m?.pending) {
              updateMessage(sessionId, assistantId, { content: '🎧 Envoi du fichier au moteur de reconnaissance…' })
            }
          })
          const asrTick = setInterval(() => {
            const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
            if (m?.pending) {
              const sec = Math.round((Date.now() - m.createdAt) / 1000)
              updateMessage(sessionId, assistantId, {
                content: `🎧 Analyse de « ${name} » en cours… ⏱ ${sec} s\n\n*Transcription d’un fichier audio : habituellement 10 à 60 secondes.*`,
              })
            }
          }, 1000)
          try {
            const ac = new AbortController()
            aborts.set(sessionId, ac)
            const { text: raw, segments } = await apiAsr(base64)
            aborts.delete(sessionId)
            clearInterval(asrTick)
            const md =
              `# Transcription — ${name}\n\n` +
              segments
                .map((s) => {
                  const mm = Math.floor(s.start / 60)
                  const ss = String(Math.round(s.start % 60)).padStart(2, '0')
                  return `[${String(mm).padStart(2, '0')}:${ss}] ${s.text}`
                })
                .join('\n\n')
            const artifact: Artifact = {
              id: uid(),
              kind: 'transcript',
              name: `transcription_${name.replace(/\.[^.]+$/, '')}.md`,
              mimeType: 'text/markdown',
              createdAt: Date.now(),
              provider,
              text: md,
              meta: { segments: segments.length, chars: raw.length },
            }
            updateMessage(sessionId, assistantId, {
              content:
                `✅ Transcription terminée — **${segments.length} segment(s)**, ${raw.split(/\s+/).length} mots.\n\nOuvrez l’artefact pour le texte complet et horodaté, ou copiez-le directement.`,
              pending: false,
              artifacts: [artifact],
            })
          } catch (e) {
            aborts.delete(sessionId)
            clearInterval(asrTick)
            updateMessage(sessionId, assistantId, {
              pending: false,
              content: '',
              error: `Transcription impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}`,
            })
          }
          return
        }

        /* ---------- Voix réelle (TTS) ---------- */
        const source = text.trim() || opts.attachments?.find((a) => a.text)?.text?.slice(0, 3500) || ''
        if (!source.trim()) {
          updateMessage(sessionId, assistantId, {
            pending: false,
            content: '',
            error: 'Écrivez le texte à transformer en voix (ou joignez un fichier texte).',
          })
          return
        }
        if (source.length > 4000) {
          updateMessage(sessionId, assistantId, {
            pending: false,
            content: '',
            error: `Texte trop long (${source.length} caractères). Le moteur vocal accepte jusqu’à 4 000 caractères — découpez-le en plusieurs demandes.`,
          })
          return
        }
        const tick = setInterval(() => {
          const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
          if (m?.pending && m.content.startsWith('🎙')) {
            const sec = Math.round((Date.now() - m.createdAt) / 1000)
            updateMessage(sessionId, assistantId, {
              content: `🎙 Synthèse de la voix « ${voice} »… ⏱ ${sec} s`,
            })
          }
        }, 1000)
        try {
          const ac = new AbortController()
          aborts.set(sessionId, ac)
          const { base64, bytes } = await apiTts(source, voice)
          aborts.delete(sessionId)
          clearInterval(tick)
          const artifact: Artifact = {
            id: uid(),
            kind: 'audio',
            name: `voix_${voice.normalize('NFD').replace(/[^\w]/g, '')}_${Date.now().toString().slice(-5)}.wav`,
            mimeType: 'audio/wav',
            createdAt: Date.now(),
            provider,
            prompt: source.slice(0, 200),
            data: base64,
            bytes,
            meta: { voice, tts: true },
          }
          await putArtifactData(artifact.id, base64)
          updateMessage(sessionId, assistantId, {
            content:
              `🔊 Voix « ${voice} » générée (${(bytes / 1024).toFixed(0)} Ko).\n\n` +
              `▶ Écoutez ci-dessous — le WAV est téléchargeable et réutilisable dans vos montages.`,
            pending: false,
            artifacts: [artifact],
          })
        } catch (e) {
          aborts.delete(sessionId)
          clearInterval(tick)
          updateMessage(sessionId, assistantId, {
            pending: false,
            content: '',
            error: `Synthèse vocale impossible : ${e instanceof Error ? e.message : 'erreur inconnue'}`,
          })
        }
      }

      /** Génération musicale locale (façon Suno) — rendu WAV réel, lisible et téléchargeable */
      async function musicFlow(sessionId: string, prompt: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const provider = session.models.audio
        const assistantId = uid()
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '🎼 Composition en cours… analyse du prompt, choix du style…',
          createdAt: Date.now(),
          pending: true,
          flow: 'audio-music',
          provider,
        })
        try {
          later(sessionId, 500, () => {
            const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
            if (m?.pending) {
              updateMessage(sessionId, assistantId, {
                content: '🎼 Style, tempo et tonalité choisis — enregistrement des pistes (nappes, basse, mélodie, batterie)…',
              })
            }
          })
          later(sessionId, 1600, () => {
            const m = get().sessions.find((s) => s.id === sessionId)?.messages.find((x) => x.id === assistantId)
            if (m?.pending) {
              updateMessage(sessionId, assistantId, {
                content: '🎚 Mixage et rendu audio… réverbération, écho, masterisation.',
              })
            }
          })
          const res = await generateMusic({
            prompt,
            style: opts.musicStyle ?? 'auto',
            durationSec: opts.musicDuration ?? 24,
            instrumental: opts.instrumental ?? false,
          })
          const artifact: Artifact = {
            id: uid(),
            kind: 'audio',
            name: `${res.title.replace(/[^\wÀ-ÿ]+/g, '_')}.wav`,
            mimeType: 'audio/wav',
            createdAt: Date.now(),
            provider,
            prompt,
            data: res.wavBase64,
            bytes: res.bytes,
            meta: {
              music: true,
              style: res.meta.style,
              bpm: res.meta.bpm,
              key: res.meta.key,
              durationSec: res.meta.durationSec,
              instrumental: opts.instrumental ?? false,
            },
          }
          await putArtifactData(artifact.id, artifact.data!)
          updateMessage(sessionId, assistantId, {
            content:
              `Voici **« ${res.title} »** — ${res.meta.style}, ${res.meta.bpm} BPM, ${res.meta.key} (${res.meta.durationSec} s).\n\n` +
              `▶ Écoutez la piste ci-dessous et téléchargez-la en WAV. Dites-moi si vous voulez une variation : plus rapide, plus sombre, autre style, autre durée…`,
            pending: false,
            artifacts: [artifact],
          })
        } catch (e) {
          updateMessage(sessionId, assistantId, {
            content: '',
            pending: false,
            error: `La génération musicale a échoué : ${e instanceof Error ? e.message : 'erreur inconnue'}`,
          })
        }
      }

      /* ---------- mode Dev Web ---------- */

      async function webDevFlow(sessionId: string, prompt: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const framework = ((opts.framework ?? 'html') as WebFramework) || 'html'
        const provider = session.models.text
        const assistantId = uid()
        const steps = [
          { label: 'Analyse du brief et de l’expérience attendue', state: 'run' as const },
          { label: 'Conception de l’architecture et de l’arborescence', state: 'todo' as const },
          { label: `Écriture du code ${framework.toUpperCase()} (composants, styles, responsive)`, state: 'todo' as const },
          { label: 'Assemblage du projet et vérification', state: 'todo' as const },
        ]
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          pending: true,
          flow: 'webdev',
          provider,
          activity: { label: 'Lumo Dev — agents en action', steps, note: 'Suivez la création des fichiers en temps réel ↓' },
        })
        const ac = new AbortController()
        aborts.set(sessionId, ac)
        let lastPaint = 0
        let gotFirst = false
        const filesLive: { name: string; state: 'writing' | 'done' }[] = []
        try {
          const full = await apiChatStream(
            [{ role: 'user', content: prompt + attachmentSummary(opts.attachments) }],
            webDevSystem(framework),
            (acc) => {
              const now = Date.now()
              if (now - lastPaint < 220) return
              lastPaint = now
              if (!gotFirst) {
                // Dès le premier token : le brief est analysé, l'architecture se dessine
                gotFirst = true
                updateMessage(sessionId, assistantId, {
                  activity: {
                    label: 'Lumo Dev — agents en action',
                    steps: steps.map((s, i) => ({ ...s, state: i === 0 ? 'done' : i === 1 ? 'run' : 'todo' })),
                    note: 'Lecture du brief… planification de l’arborescence…',
                  },
                })
                return
              }
              // Aperçu de l’introduction en direct
              const introCut = acc.indexOf('```')
              if (introCut > 0) {
                updateMessage(sessionId, assistantId, { content: acc.slice(0, introCut) })
              }
              // Détection en direct : tout bloc ouvert (même en cours d'écriture) apparaît
              const opened = parseOpeningFiles(acc, framework)
              if (opened.length === 0 && filesLive.length === 0) return
              const next = opened.map((name, i) => ({
                name,
                state: (i < opened.length - 1 ? 'done' : 'writing') as 'writing' | 'done',
              }))
              const treeChanged =
                next.length !== filesLive.length ||
                next.some((f, i) => filesLive[i]?.name !== f.name || filesLive[i]?.state !== f.state)
              if (treeChanged) {
                filesLive.splice(0, filesLive.length, ...next)
                updateMessage(sessionId, assistantId, {
                  activity: {
                    label: 'Lumo Dev — agents en action',
                    steps: steps.map((s, i) => ({
                      ...s,
                      state: i <= 1 ? 'done' : i === 2 ? 'run' : 'todo',
                    })),
                    files: [...filesLive],
                    note: next.length ? 'Les fichiers apparaissent au fil de l’écriture ↓' : 'Planification de l’arborescence…',
                  },
                })
              }
            },
            undefined,
            ac.signal,
          )
          aborts.delete(sessionId)

          const files = parseCodeBlocks(full, framework)
          if (files.length === 0) {
            throw new Error('Aucun code exploitable dans la réponse — reformulez ou réessayez.')
          }
          const intro = full.slice(0, full.indexOf('```')).trim()
          const artifact: Artifact = {
            id: uid(),
            kind: 'webcode',
            name: `${files.find((f) => f.name.endsWith('.html'))?.name.replace(/\.html$/, '') ?? 'projet'}_${framework}`,
            mimeType: 'text/plain',
            createdAt: Date.now(),
            provider,
            prompt,
            files,
            meta: { framework, fileCount: files.length, previewable: buildPreviewable(files) ? 'oui' : 'non' },
          }
          updateMessage(sessionId, assistantId, {
            content:
              (intro || `Voici votre projet **${framework}** complet et responsive.`) +
              `\n\n**${files.length} fichier(s)** généré(s). Ouvrez l’artefact ci-dessous pour l’aperçu live et le téléchargement.`,
            pending: false,
            artifacts: [artifact],
            activity: {
              label: 'Lumo Dev — projet assemblé',
              steps: steps.map((s) => ({ ...s, state: 'done' })),
              files: files.map((f) => ({ name: f.name, state: 'done' })),
            },
          })
        } catch (e) {
          aborts.delete(sessionId)
          const err = e as Error & { fallback?: string[] }
          if (err.message === 'Génération interrompue.') {
            updateMessage(sessionId, assistantId, {
              pending: false,
              stopped: true,
              content: 'Génération interrompue — relancez pour reprendre le développement.',
              activity: {
                label: 'Lumo Dev — interrompu',
                steps: steps.map((s, i) => ({ ...s, state: i < 2 ? 'done' : 'todo' })),
                files: [...filesLive],
              },
            })
            return
          }
          updateMessage(sessionId, assistantId, {
            pending: false,
            error: `Génération du code impossible : ${err.message}`,
            content: '',
            fallback: err.fallback ?? ['mistral', 'agnes', 'hf'],
          })
        }
      }

      function buildPreviewable(files: NonNullable<Artifact['files']>): boolean {
        return files.some((f) => f.lang === 'html' || f.name.endsWith('.html'))
      }

      /* ---------- mode App Design ---------- */

      async function designFlow(sessionId: string, prompt: string, opts: SendOptions) {
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return
        const provider = session.models.text
        const assistantId = uid()
        const steps = [
          { label: 'Analyse du besoin et du public cible', state: 'run' as const },
          { label: 'Choix du style, de la palette et du ton', state: 'todo' as const },
          { label: 'Composition des écrans et des composants', state: 'todo' as const },
          { label: 'Préparation du studio visuel', state: 'todo' as const },
        ]
        addMessage(sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          pending: true,
          flow: 'appdesign',
          provider,
          activity: { label: 'Studio de conception — assistant en action', steps },
        })
        const advance = (upTo: number, note?: string) =>
          updateMessage(sessionId, assistantId, {
            activity: {
              label: 'Studio de conception — assistant en action',
              steps: steps.map((s, i) => ({ ...s, state: i < upTo ? 'done' : i === upTo ? 'run' : 'todo' })),
              ...(note ? { note } : {}),
            },
          })
        try {
          const ac = new AbortController()
          aborts.set(sessionId, ac)
          advance(1, 'L’assistant analyse votre demande…')
          const full = await apiChat(
            [{ role: 'user', content: prompt + attachmentSummary(opts.attachments) }],
            DESIGN_SYSTEM,
          )
          aborts.delete(sessionId)
          advance(2, 'Extraction de la structure de la maquette…')
          let doc = extractDesignDoc(full)

          // Passe de réparation : le modèle renvoie parfois un JSON mal formé
          if (!doc) {
            try {
              const fixed = await apiChat(
                [
                  {
                    role: 'user',
                    content:
                      'Voici la réponse à réparer (garde le même design, corrige la syntaxe) :\n\n' +
                      full.slice(0, 6000),
                  },
                ],
                DESIGN_REPAIR_SYSTEM,
              )
              doc = extractDesignDoc(fixed)
            } catch {
              /* réparation impossible → repli texte */
            }
          }
          if (!doc) throw new Error('structure de design illisible')
          advance(3, `${doc.screens.length} écran(s) composé(s) — ouverture du studio…`)

          const intro = full.replace(/```json[\s\S]*?```/, '').trim()
          const elCount = doc.screens.reduce((n, s) => n + s.elements.length, 0)
          const artifact: Artifact = {
            id: uid(),
            kind: 'design',
            name: `design_${doc.appName.toLowerCase().replace(/[^\wà-ÿ]+/g, '_').slice(0, 30)}.json`,
            mimeType: 'application/json',
            createdAt: Date.now(),
            provider,
            prompt,
            text: JSON.stringify(doc),
            meta: { appName: doc.appName, screens: doc.screens.length, elements: elCount },
          }
          updateMessage(sessionId, assistantId, {
            content:
              (intro || `Voici la maquette de **${doc.appName}**.`) +
              `\n\n**${doc.screens.length} écran(s)** · ${elCount} éléments · palette ${doc.palette.primary}.\n\n` +
              `▶ **Ouvrez le studio visuel** (bouton sous ce message ou artefact) pour tout ajuster en WYSIWYG, ` +
              `prévisualiser l’app, insérer images et icônes, et exporter le code : React, HTML ou FlutterFlow.`,
            pending: false,
            artifacts: [artifact],
            activity: {
              label: 'Studio de conception — maquette prête',
              steps: steps.map((s) => ({ ...s, state: 'done' })),
            },
          })
        } catch {
          // Repli : réponse guidée en texte quand le JSON n’a pas abouti
          try {
            const turns = [{ role: 'user' as const, content: prompt }]
            const guide = await apiChat(turns, DESIGN_GUIDE_SYSTEM)
            updateMessage(sessionId, assistantId, {
              content: guide,
              pending: false,
            })
          } catch (e) {
            const err = e as Error & { fallback?: string[] }
            updateMessage(sessionId, assistantId, {
              pending: false,
              error: err.message,
              content: '',
              fallback: err.fallback ?? ['mistral', 'agnes', 'hf'],
            })
          }
        }
      }

      /* ---------- état ---------- */
      return {
        view: 'hub',
        sessions: [],
        activeId: null,
        hfModels: [],
        editingMsg: null,

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
          const attachments = opts.attachments
          if (!trimmed && !opts.file && !attachments?.length) return
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return

          const isFirstUser =
            session.messages.filter((m) => m.role === 'user').length === 0
          addMessage(sessionId, {
            id: uid(),
            role: 'user',
            content: trimmed || (opts.file ? `Transcrire « ${opts.file.name} »` : attachments?.[0]?.name || ''),
            createdAt: Date.now(),
            attachments: attachments?.length ? attachments : undefined,
          })
          if (isFirstUser) {
            updateSession(sessionId, (s) => ({ ...s, title: truncate(trimmed || opts.file?.name || 'Session', 42) }))
          }

          const history = get().sessions.find((s) => s.id === sessionId)!.messages

          if (session.mode === 'image') await imageFlow(sessionId, trimmed, opts)
          else if (session.mode === 'video') await videoFlow(sessionId, trimmed, opts)
          else if (session.mode === 'audio') {
            if (opts.audioTab === 'music') await musicFlow(sessionId, trimmed, opts)
            else await audioFlow(sessionId, trimmed, opts)
          } else if (session.mode === 'webdev') await webDevFlow(sessionId, trimmed, opts)
          else if (session.mode === 'appdesign') await designFlow(sessionId, trimmed, opts)
          else await chatFlow(sessionId, history)
        },

        editMessage: async (sessionId, msgId, newText, attachments) => {
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return
          const idx = session.messages.findIndex((m) => m.id === msgId)
          if (idx < 0) return
          // Purger les artefacts des messages qui seront régénérés
          session.messages.slice(idx + 1).forEach((m) =>
            m.artifacts?.forEach((a) => void deleteArtifactData(a.id)),
          )
          const edited: Message = {
            ...session.messages[idx],
            content: newText.trim(),
            attachments: attachments?.length ? attachments : undefined,
            createdAt: Date.now(),
          }
          const kept = session.messages.slice(0, idx)
          updateSession(sessionId, (s) => ({ ...s, messages: [...kept, edited], updatedAt: Date.now() }))

          const mode = session.mode
          const opts: SendOptions = { attachments }
          if (mode === 'image') await imageFlow(sessionId, edited.content, opts)
          else if (mode === 'video') await videoFlow(sessionId, edited.content, opts)
          else if (mode === 'audio') await audioFlow(sessionId, edited.content, { ...opts, audioTab: 'voice' })
          else if (mode === 'webdev') {
            const fw = (session.messages[idx].artifacts?.[0]?.meta?.framework as string) ?? opts.framework ?? 'html'
            await webDevFlow(sessionId, edited.content, { ...opts, framework: fw })
          } else if (mode === 'appdesign') await designFlow(sessionId, edited.content, opts)
          else await chatFlow(sessionId, [...kept, edited])
        },

        retryWithProvider: async (sessionId, provider, hfModel) => {
          const session = get().sessions.find((s) => s.id === sessionId)
          if (!session) return
          const lastAssistantIdx = session.messages.map((m) => m.role).lastIndexOf('assistant')
          if (lastAssistantIdx >= 0) {
            const removed = session.messages[lastAssistantIdx]
            removed.artifacts?.forEach((a) => void deleteArtifactData(a.id))
            updateSession(sessionId, (s) => ({
              ...s,
              messages: s.messages.filter((_, i) => i !== lastAssistantIdx),
            }))
          }
          const fresh = get().sessions.find((s) => s.id === sessionId)!
          await chatFlow(sessionId, fresh.messages, { provider, hfModel })
        },

        stopGeneration: (sessionId) => {
          // Arrête les flux réseau en cours (streaming chat / dev web / TTS / ASR)
          aborts.get(sessionId)?.abort()
          aborts.delete(sessionId)
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
            await imageFlow(sessionId, lastUser.content, { imageSize: size, variations, attachments: lastUser.attachments })
          } else if (mode === 'video') {
            await videoFlow(sessionId, lastUser.content, { attachments: lastUser.attachments })
          } else if (mode === 'audio') {
            if (removed.flow === 'audio-music') {
              await musicFlow(sessionId, lastUser.content, { audioTab: 'music', attachments: lastUser.attachments })
            } else {
              await audioFlow(sessionId, lastUser.content, {
                audioTab: removed.flow === 'audio-transcript' ? 'transcript' : 'voice',
                attachments: lastUser.attachments,
              })
            }
          } else if (mode === 'webdev') {
            await webDevFlow(sessionId, lastUser.content, {
              framework: (removed.artifacts?.[0]?.meta?.framework as string) ?? 'html',
              attachments: lastUser.attachments,
            })
          } else if (mode === 'appdesign') {
            await designFlow(sessionId, lastUser.content, { attachments: lastUser.attachments })
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
            const err = e as Error & { fallback?: string[] }
            updateMessage(sessionId, assistantId, {
              pending: false,
              error: err.message,
              fallback: err.fallback ?? ['mistral', 'agnes', 'hf'],
            })
          }
        },

        addHfModel: (model) =>
          set((st) => ({
            // Remplace l'entrée existante (même id) pour rafraîchir fichiers / type / tâche
            hfModels: [model, ...st.hfModels.filter((m) => m.id !== model.id)],
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
        setEditingMsg: (v) => set({ editingMsg: v }),
      }
    },
    {
      name: 'lumo-store-v1',
      version: 2,
      migrate: (state) => state as never,
      partialize: (state) => ({
        sessions: state.sessions.map((s) => ({
          ...s,
          messages: s.messages
            .filter((m) => !m.pending)
            .map((m) => ({
              ...m,
              attachments: m.attachments?.map((a) => ({ ...a, text: a.text ? a.text.slice(0, 4000) : undefined })),
              artifacts: m.artifacts?.map((a) => ({ ...a, data: undefined })),
            })),
        })),
        hfModels: state.hfModels,
      }),
    },
  ),
)
