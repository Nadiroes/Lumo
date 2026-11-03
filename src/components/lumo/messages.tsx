'use client'

/** Fil de conversation : bulles, streaming, artefacts, actions */

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { ArtifactViewDialog, AudioCard, ImageTile, TextFileCard, VideoCard } from '@/components/lumo/artifacts'
import { LumoMark } from '@/components/lumo/logo'
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
    'Fais une voix grave et lente pour une bande-annonce',
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
        return <TextFileCard key={a.id} a={a} onOpen={() => onOpen(a)} />
      })}
    </div>
  )
}

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
  const streaming = m.pending && m.flow === 'chat'

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

        <div className="rounded-2xl rounded-tl-md border bg-card px-4 py-3">
          {m.pending && !m.content && m.flow !== 'image' && (
            <span className="flex items-center gap-1 py-1" aria-label="Lumo écrit">
              <span className="typing-dot" />
              <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
              <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
            </span>
          )}
          {m.content && (
            <>
              <Markdown content={m.content} />
              {streaming && <span className="stream-cursor" aria-hidden="true" />}
            </>
          )}
          <ArtifactGrid artifacts={m.artifacts ?? []} flow={m.flow} pending={m.pending} onOpen={onOpenArtifact} />
          {m.error && (
            <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {m.error}
            </p>
          )}
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
              className="h-7 px-2 text-muted-foreground"
              aria-label="Réponse utile"
              onClick={() => toast({ title: 'Merci pour votre retour !' })}
            >
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              aria-label="Réponse inutile"
              onClick={() => toast({ title: 'Retour noté', description: 'Lumo apprendra de cela.' })}
            >
              <ThumbsDown className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

export function ChatMessages({ session }: { session: Session }) {
  const messages = session.messages
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const [viewing, setViewing] = useState<Artifact | null>(null)
  const sendMessage = useLumo((s) => s.sendMessage)

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
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <article key={m.id} className="flex justify-end" aria-label="Votre message">
                    <div className="max-w-[85%] sm:max-w-[70%]">
                      <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                        {m.content}
                      </div>
                      <p className="mt-1 pr-1 text-right text-[11px] text-muted-foreground">
                        {format(new Date(m.createdAt), "HH'mm", { locale: fr })}
                      </p>
                    </div>
                  </article>
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
      <ArtifactViewDialog artifact={viewing} open={!!viewing} onOpenChange={(v) => !v && setViewing(null)} />
    </>
  )
}
