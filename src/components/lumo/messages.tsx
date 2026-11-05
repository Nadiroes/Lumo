'use client'

/** Fil de conversation : bulles, streaming, artefacts, actions, fallback modèles */

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  AlertTriangle,
  ArrowUpFromLine,
  Copy,
  Import,
  KeyRound,
  Music,
  PencilLine,
  RefreshCw,
  Repeat,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  apiFeedback,
  apiListKeys,
} from '@/lib/lumo/api'
import { ArtifactViewDialog, AudioCard, ImageTile, TextFileCard, VideoCard } from '@/components/lumo/artifacts'
import { DesignCard, DesignStudioDialog } from '@/components/lumo/app-studio'
import { AgentActivityPanel } from '@/components/lumo/agent-activity'
import { LumoMark } from '@/components/lumo/logo'
import { CodePreviewDialog, WebCodeCard } from '@/components/lumo/web-preview'
import { useLumo } from '@/lib/lumo/store'
import { MODE_INFO, type Artifact, type Message, type Session } from '@/lib/lumo/types'

const SUGGESTIONS: Record<string, string[]> = {
  text: [
    'Résume ce projet en 5 points clés',
    'Écris un e-mail professionnel pour décaler une réunion',
    'Explique-moi les boucles for comme si j’avais 10 ans',
    'Trouve 10 noms pour ma marque de café',
  ],
  image: [
    'Un renard astronaute, style aquarelle',
    'Couverture de podcast minimaliste, ambiance chaude',
    'Logo pour boulangerie « Le Levain », doré',
    'Affiche d’un festival de jazz au coucher du soleil',
  ],
  video: [
    'Clip de 8 s : lever de soleil en timelapse',
    'Teaser mystère pour un roman noir',
    'Boucle animée : café qui fume sur un bureau',
  ],
  audio: [
    'Lis ce paragraphe avec la voix Chloé',
    'Compose une musique lo-fi chaleureuse au piano, ambiance pluie',
    'Fais une voix grave et lente pour une bande-annonce',
    'Une boucle électro énergique pour une séance de sport',
  ],
  book: [
    'Écris le chapitre 1 en respectant la Bible',
    'Propose trois évolutions pour le personnage principal',
    'Renforce l’ambiance de la scène d’ouverture',
  ],
  project: [
    'Organise le lancement de ma marque de thé en 6 semaines',
    'Prépare le plan de mon portfolio de graphiste',
    'Structure la production d’un EP de 5 titres',
  ],
  free: [
    'Présente-toi et montre-moi ce que tu sais faire',
    'Écris un haïku puis illustre-le',
    'Aide-moi à brainstormer une campagne visuelle',
  ],
  webdev: [
    'Crée la page d’accueil d’une boulangerie artisanale en HTML + CSS, responsive',
    'Un tableau de bord météo en JavaScript vanilla avec graphiques',
    'Une landing page SaaS en React, moderne et responsive',
    'Un mini blog en PHP avec liste d’articles et formulaire de contact',
  ],
  appdesign: [
    'Conçois une app de réservation de coach sportif',
    'Maquette d’une app bancaire minimaliste, palette sombre',
    'Une app de recettes avec écran d’accueil, détail et favoris',
    'Conçois une app de livraison de repas colorée et joueuse',
  ],
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}

function ArtifactGrid({
  artifacts,
  flow,
  pending,
  onOpen,
}: {
  artifacts: Artifact[]
  flow?: Message['flow']
  pending: boolean
  onOpen: (a: Artifact) => void
}) {
  const images = artifacts.filter((a) => a.kind === 'image')
  const others = artifacts.filter((a) => a.kind !== 'image')

  return (
    <div className="mt-2 space-y-2.5">
      {pending && flow === 'image' && (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer aspect-square rounded-xl border" aria-label="Génération en cours" />
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className={`grid gap-2.5 ${images.length === 1 ? 'max-w-sm' : 'grid-cols-2 sm:max-w-md'}`}>
          {images.map((a) => (
            <ImageTile key={a.id} a={a} />
          ))}
        </div>
      )}
      {others.map((a) => {
        if (a.kind === 'audio') return <AudioCard key={a.id} a={a} />
        if (a.kind === 'video') return <VideoCard key={a.id} a={a} />
        if (a.kind === 'webcode') return <WebCodeCard key={a.id} a={a} onOpen={() => onOpen(a)} />
        if (a.kind === 'design') return <DesignCard key={a.id} a={a} onOpen={() => onOpen(a)} />
        return <TextFileCard key={a.id} a={a} onOpen={() => onOpen(a)} />
      })}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Carte de secours quand le modèle est indisponible                 */
/* ---------------------------------------------------------------- */

const FALLBACK_OPTIONS: Record<string, { label: string; description: string; provider: string }> = {
  mistral: {
    label: 'Basculer sur Mistral',
    description: 'Mistral Large — raisonnement, rédaction, code',
    provider: 'mistral',
  },
  agnes: {
    label: 'Basculer sur Agnes AI',
    description: 'Agnes 2.5 Flash — multimodal rapide',
    provider: 'agnes',
  },
  hf: {
    label: 'Importer un modèle Hugging Face',
    description: 'GPT/LLaMA/Mistral HF — .safetensors, .gguf, config .json',
    provider: 'hf',
  },
}

function HfFallbackDialog({
  open,
  onOpenChange,
  onUse,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUse: (modelId: string) => void
}) {
  const [modelId, setModelId] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Modèle Hugging Face</DialogTitle>
          <DialogDescription>
            Indiquez l’identifiant du modèle à utiliser via l’API Hugging Face (token requis dans
            Paramètres → Clés API).
          </DialogDescription>
        </DialogHeader>
        <Input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="ex. : meta-llama/Llama-3.2-3B-Instruct"
          aria-label="Identifiant du modèle Hugging Face"
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Formats pris en charge via le Hub : <strong>.safetensors</strong>, <strong>.gguf</strong>,{' '}
          <strong>config .json</strong>. Pour exécuter un <em>.gguf</em> en local (llama.cpp, LM Studio),
          enregistrez un « Endpoint personnalisé » dans les paramètres : Lumo lui transmettra la conversation.
        </p>
        <Button
          disabled={!modelId.trim()}
          onClick={() => {
            onUse(modelId.trim())
            onOpenChange(false)
          }}
          className="gap-1.5"
        >
          <Import className="h-4 w-4" /> Utiliser ce modèle
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function FallbackCard({
  session,
  m,
}: {
  session: Session
  m: Message
}) {
  const retryWithProvider = useLumo((s) => s.retryWithProvider)
  const { toast } = useToast()
  const [hfOpen, setHfOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function ensureKey(provider: 'mistral' | 'agnes' | 'huggingface', label: string): Promise<boolean> {
    try {
      const keys = await apiListKeys()
      const row = keys.find((k) => k.provider === provider && k.status === 'valid')
      if (row) return true
      toast({
        title: `Aucune clé ${label} valide`,
        description: 'Ajoutez-la dans Paramètres → Clés API, puis réessayez.',
        variant: 'destructive',
      })
      return false
    } catch {
      toast({ title: 'Impossible de vérifier les clés', variant: 'destructive' })
      return false
    }
  }

  async function handle(kind: string) {
    const opt = FALLBACK_OPTIONS[kind]
    if (!opt || busy) return
    setBusy(kind)
    try {
      if (kind === 'hf') {
        setHfOpen(true)
        return
      }
      const label = kind === 'mistral' ? 'Mistral' : 'Agnes AI'
      if (!(await ensureKey(kind as 'mistral' | 'agnes', label))) return
      toast({ title: `Nouvelle tentative avec ${label}…` })
      await retryWithProvider(session.id, opt.provider)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> Modèle indisponible — proposez-moi une alternative :
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
        {Object.entries(FALLBACK_OPTIONS).map(([kind, opt]) => (
          <Button
            key={kind}
            variant="outline"
            size="sm"
            className="h-auto flex-col items-start gap-0.5 px-2.5 py-2 text-left"
            disabled={busy === kind}
            onClick={() => void handle(kind)}
          >
            <span className="flex items-center gap-1 text-xs font-medium">
              {kind === 'hf' ? <Import className="h-3 w-3" /> : <ArrowUpFromLine className="h-3 w-3" />}
              {opt.label.replace('Basculer sur ', '')}
            </span>
            <span className="text-[10px] font-normal leading-snug text-muted-foreground">{opt.description}</span>
          </Button>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <KeyRound className="h-3 w-3" /> Les clés API se gèrent dans Paramètres → Clés API.
      </p>
      <HfFallbackDialog
        open={hfOpen}
        onOpenChange={setHfOpen}
        onUse={async (modelId) => {
          if (!(await ensureKey('huggingface', 'Hugging Face'))) return
          toast({ title: `Tentative avec ${modelId}…` })
          await retryWithProvider(session.id, 'hf', modelId)
        }}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Bulle utilisateur : édition + copie                               */
/* ---------------------------------------------------------------- */

function UserMessage({
  session,
  m,
  isEditing,
}: {
  session: Session
  m: Message
  isEditing: boolean
}) {
  const setEditingMsg = useLumo((s) => s.setEditingMsg)
  const generating = session.messages.some((x) => x.pending)
  const { toast } = useToast()

  return (
    <article className={`group flex justify-end ${isEditing ? 'opacity-70' : ''}`} aria-label="Votre message">
      <div className="max-w-[85%] sm:max-w-[70%]">
        <div
          className={`rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm ${
            isEditing ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-background' : ''
          }`}
        >
          {m.content}
          {m.attachments && m.attachments.length > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {m.attachments.map((a, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full bg-black/15 px-2 py-0.5 text-[10px]"
                >
                  📎 {a.name}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-end gap-1 pr-1">
          <span className="text-[11px] text-muted-foreground">
            {format(new Date(m.createdAt), "HH'mm", { locale: fr })}
          </span>
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              disabled={generating}
              onClick={() => setEditingMsg({ sessionId: session.id, msgId: m.id })}
              aria-label="Modifier ce message et régénérer"
            >
              <PencilLine className="h-3 w-3" /> Modifier
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
              onClick={() => {
                void navigator.clipboard.writeText(m.content)
                toast({ title: 'Message copié' })
              }}
              aria-label="Copier ce message"
            >
              <Copy className="h-3 w-3" /> Copier
            </Button>
          </span>
        </div>
      </div>
    </article>
  )
}

/* ---------------------------------------------------------------- */
/* Réponse de Lumo                                                   */
/* ---------------------------------------------------------------- */

function AssistantMessage({
  session,
  m,
  isLast,
  onOpenArtifact,
}: {
  session: Session
  m: Message
  isLast: boolean
  onOpenArtifact: (a: Artifact) => void
}) {
  const { toast } = useToast()
  const regenerateLast = useLumo((s) => s.regenerateLast)
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const streaming = m.pending && m.flow === 'chat'
  const isImageError = !!m.error && m.flow === 'image'
  const [retrying, setRetrying] = useState(false)

  async function retryImage() {
    if (retrying) return
    setRetrying(true)
    try {
      await regenerateLast(session.id)
    } finally {
      setRetrying(false)
    }
  }

  async function feedback(verdict: 'up' | 'down') {
    setVote(verdict)
    const prevUser = [...session.messages]
      .slice(0, session.messages.findIndex((x) => x.id === m.id))
      .reverse()
      .find((x) => x.role === 'user')
    try {
      const r = await apiFeedback(verdict, prevUser?.content ?? '', m.content)
      toast({
        title: verdict === 'up' ? 'Merci pour votre retour !' : 'Retour noté',
        description: r.message,
        className:
          verdict === 'up'
            ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
            : undefined,
      })
    } catch {
      toast({ title: 'Retour non enregistré', variant: 'destructive' })
    }
  }

  return (
    <article className="group flex gap-2.5 sm:gap-3" aria-label="Réponse de Lumo">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <LumoMark className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-display text-sm font-semibold">Lumo</span>
          <span className="text-[11px] text-muted-foreground">
            {format(new Date(m.createdAt), "HH'mm", { locale: fr })}
            {m.provider ? ` · ${m.provider}` : ''}
          </span>
        </div>

        {m.providerNote && !m.pending && (
          <p className="mb-1 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
            <Repeat className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{m.providerNote}</span>
          </p>
        )}

        <div className="rounded-2xl rounded-tl-md border bg-card px-4 py-3">
          {m.pending && !m.content && m.flow !== 'image' && !m.activity && (
            <span className="flex items-center gap-1 py-1" aria-label="Lumo écrit">
              <span className="typing-dot" />
              <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
              <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
            </span>
          )}
          {m.activity && <AgentActivityPanel activity={m.activity} running={!!m.pending} />}
          {m.content && (
            <>
              <Markdown content={m.content} />
              {streaming && <span className="stream-cursor" aria-hidden="true" />}
            </>
          )}
          <ArtifactGrid artifacts={m.artifacts ?? []} flow={m.flow} pending={!!m.pending} onOpen={onOpenArtifact} />
          {m.error && (
            <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {m.error}
              {isImageError && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 h-7 gap-1 border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => void retryImage()}
                  disabled={retrying}
                >
                  <RefreshCw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
                  {retrying ? 'Nouvelle tentative…' : 'Réessayer la génération'}
                </Button>
              )}
            </div>
          )}
          {m.error && m.fallback && m.fallback.length > 0 && <FallbackCard session={session} m={m} />}
        </div>

        {!m.pending && (
          <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => {
                void navigator.clipboard.writeText(m.content)
                toast({ title: 'Réponse copiée' })
              }}
            >
              <Copy className="h-3 w-3" /> Copier
            </Button>
            {isLast && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  void regenerateLast(session.id)
                  toast({ title: 'Régénération…' })
                }}
              >
                <RefreshCw className="h-3 w-3" /> Régénérer
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 ${vote === 'up' ? 'text-emerald-600' : 'text-muted-foreground'}`}
              aria-label="Réponse utile"
              disabled={!!vote}
              onClick={() => void feedback('up')}
            >
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-2 ${vote === 'down' ? 'text-destructive' : 'text-muted-foreground'}`}
              aria-label="Réponse inutile"
              disabled={!!vote}
              onClick={() => void feedback('down')}
            >
              <ThumbsDown className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

/* ---------------------------------------------------------------- */
/* Fil complet                                                       */
/* ---------------------------------------------------------------- */

export function ChatMessages({ session }: { session: Session }) {
  const messages = session.messages
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const [viewing, setViewing] = useState<Artifact | null>(null)
  const sendMessage = useLumo((s) => s.sendMessage)
  const editingMsg = useLumo((s) => s.editingMsg)
  const isWebcodeView = viewing?.kind === 'webcode'
  const isDesignView = viewing?.kind === 'design'

  const contentLength = useMemo(
    () => messages.reduce((n, m) => n + m.content.length, 0),
    [messages],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [contentLength, messages.length])

  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        }}
        className="flex-1 overflow-y-auto scrollbar-thin"
        aria-label="Fil de conversation"
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-10 text-center sm:pt-16">
              <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <LumoMark className="float-slow h-10 w-10" />
              </span>
              <h2 className="font-display text-xl font-semibold sm:text-2xl">
                {session.mode === 'book' ? 'Votre Bible est prête. Écrivons.' : 'Que créons-nous ?'}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {MODE_INFO[session.mode].description}
              </p>
              <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {(SUGGESTIONS[session.mode] ?? SUGGESTIONS.free).map((s) => (
                  <button
                    key={s}
                    onClick={() => void sendMessage(session.id, s)}
                    className="rounded-xl border bg-card px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
              {session.mode === 'audio' && (
                <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Music className="h-3.5 w-3.5 text-primary" /> Onglet « Musique » de la barre de saisie :
                  génération type Suno, 100 % locale.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserMessage
                    key={m.id}
                    session={session}
                    m={m}
                    isEditing={editingMsg?.sessionId === session.id && editingMsg.msgId === m.id}
                  />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    session={session}
                    m={m}
                    isLast={m.id === lastAssistantId}
                    onOpenArtifact={setViewing}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>
      <CodePreviewDialog artifact={viewing} open={!!viewing && isWebcodeView} onOpenChange={(v) => !v && setViewing(null)} />
      <DesignStudioDialog artifact={viewing} open={!!viewing && isDesignView} onOpenChange={(v) => !v && setViewing(null)} />
      <ArtifactViewDialog
        artifact={viewing}
        open={!!viewing && !isWebcodeView && !isDesignView}
        onOpenChange={(v) => !v && setViewing(null)}
      />
    </>
  )
}
