'use client'

/** Rendu des artefacts : images réelles, lecteurs démo, cartes fichiers */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Download, Eye, FileText, Pause, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { getArtifactData } from '@/lib/lumo/artifact-store'
import { downloadText } from '@/lib/lumo/export'
import type { Artifact } from '@/lib/lumo/types'

export function artifactDataUrl(a: Artifact, data?: string): string | undefined {
  const d = data ?? a.data
  return d ? `data:${a.mimeType};base64,${d}` : undefined
}

function fmtSize(n?: number): string {
  if (!n) return ''
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} Mo`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} Ko`
  return `${n} o`
}

/** Charge les données binaires depuis IndexedDB si absentes de l’état.
 *  La donnée est écrite de façon asynchrone juste après la création de l’artefact :
 *  on relit donc plusieurs fois (poll court) pour éviter l’écran « statique » au premier rendu. */
export function useArtifactData(a: Artifact): string | undefined {
  const [stored, setStored] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (a.data) return // donnée déjà en mémoire : rien à lire
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    let tries = 0
    const read = () => {
      void getArtifactData(a.id).then((d) => {
        if (!alive) return
        if (d) {
          setStored(d)
          return
        }
        // L'écriture IndexedDB peut se terminer après ce rendu : on réessaie ~5 s
        if (tries < 12) {
          tries += 1
          timer = setTimeout(read, 400)
        }
      })
    }
    read()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [a.id, a.data])
  // Priorité à la donnée en mémoire (rendu instantané), sinon la donnée stockée
  return a.data ?? stored
}

/* ---------------- Image ---------------- */

export function ImageTile({ a }: { a: Artifact }) {
  const data = useArtifactData(a)
  const src = artifactDataUrl(a, data)
  const { toast } = useToast()

  if (!src) {
    return (
      <div className="shimmer flex aspect-square w-full items-center justify-center rounded-xl border text-xs text-muted-foreground">
        Image indisponible localement
      </div>
    )
  }
  return (
    <figure className="group relative overflow-hidden rounded-xl border">
      <img src={src} alt={a.prompt || a.name} className="aspect-square w-full object-cover" loading="lazy" />
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="truncate text-[11px] text-white/90">{a.provider}</span>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 text-[11px]"
          onClick={() => {
            const url = src
            const link = document.createElement('a')
            link.href = url
            link.download = a.name
            link.click()
            toast({ title: 'Image téléchargée', description: a.name })
          }}
        >
          <Download className="h-3 w-3" /> PNG
        </Button>
      </figcaption>
    </figure>
  )
}

/* ---------------- Audio (démo ou musique générée) ---------------- */

export function AudioCard({ a }: { a: Artifact }) {
  const data = useArtifactData(a)
  const src = artifactDataUrl(a, data)
  const isMusic = !!a.meta?.music
  const voice = a.meta?.voice ? String(a.meta.voice) : 'voix'
  const style = a.meta?.style ? String(a.meta.style) : ''
  const bpm = a.meta?.bpm ? String(a.meta.bpm) : ''
  const keyName = a.meta?.key ? String(a.meta.key) : ''
  const durationSec = a.meta?.durationSec ? Number(a.meta.durationSec) : 0
  const { toast } = useToast()

  if (src) {
    return (
      <div className="rounded-xl border bg-card p-3">
        <div className="mb-2 flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <AudioLines className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{a.name.replace(/\.wav$/, '')}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {isMusic
                ? `piste générée · ${[style, bpm ? `${bpm} BPM` : '', keyName, durationSec ? `${durationSec} s` : ''].filter(Boolean).join(' · ')}`
                : `audio · ${a.provider}`}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 gap-1 text-[11px]"
            onClick={() => {
              const link = document.createElement('a')
              link.href = src
              link.download = a.name
              link.click()
              toast({ title: 'Audio téléchargé', description: a.name })
            }}
          >
            <Download className="h-3 w-3" /> WAV
          </Button>
        </div>
        <audio controls src={src} className="h-9 w-full" preload="metadata" aria-label={`Lecture de ${a.name}`} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <AudioLines className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <div className="flex h-8 flex-1 items-end gap-[3px]" aria-hidden="true">
        {Array.from({ length: 36 }).map((_, i) => (
          <span
            key={i}
            className="wave-bar"
            style={{ height: `${18 + Math.sin(i * 1.7) * 10 + (i % 5) * 3}px`, animationDelay: `${i * 0.06}s`, opacity: 0.75 }}
          />
        ))}
      </div>
      <div className="min-w-0 shrink-0 text-right">
        <p className="max-w-32 truncate text-xs font-medium sm:max-w-none">{a.name}</p>
        <p className="max-w-36 truncate text-[10px] text-muted-foreground sm:max-w-none">
          voix « {voice} » · flux à brancher ({a.provider})
        </p>
      </div>
    </div>
  )
}

/* ---------------- Vidéo : lecteur animé (storyboard Ken Burns) ---------------- */

interface VideoPayload {
  frames: { mime: string; base64: string }[]
  duration: number
  ratio: string
}

/** Séquence animée de secours quand aucun plan n'a pu être généré */
function FallbackAnimation() {
  return (
    <div className="video-fallback absolute inset-0" aria-hidden="true">
      <span className="video-fallback-ring" />
      <span className="video-fallback-ring video-fallback-ring-2" />
    </div>
  )
}

export function VideoCard({ a }: { a: Artifact }) {
  const raw = useArtifactData(a)
  const payload = useMemo<VideoPayload | null>(() => {
    if (!raw) return null
    try {
      const p = JSON.parse(raw) as VideoPayload
      if (Array.isArray(p.frames)) return p
    } catch {
      /* données absentes ou corrompues */
    }
    return null
  }, [raw])

  const frames = payload?.frames ?? []
  const durationSec = payload?.duration || Number(String(a.meta?.duration ?? '8').replace(/\D/g, '')) || 8
  const ratio = payload?.ratio || String(a.meta?.ratio ?? '16:9')

  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number>(0)

  useEffect(() => {
    if (!playing || frames.length === 0) return
    lastRef.current = performance.now()
    const loop = (t: number) => {
      const dt = (t - lastRef.current) / 1000
      lastRef.current = t
      setProgress((p) => {
        const next = p + dt / durationSec
        if (next >= 1) return 0
        return next
      })
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, frames.length, durationSec])

  // Plan courant entièrement dérivé de la progression (aucun état redondant)
  const idx = frames.length > 1 ? Math.min(frames.length - 1, Math.floor(progress * frames.length)) : 0

  const hasFrames = frames.length > 0
  const pct = Math.round(progress * 100)

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="relative aspect-video overflow-hidden bg-secondary">
        {/* Plans : fondu enchaîné + effet Ken Burns */}
        {hasFrames
          ? frames.map((f, i) => (
              <img
                key={i}
                src={`data:${f.mime};base64,${f.base64}`}
                alt={`Plan ${i + 1}`}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
                  playing && i === idx ? 'kenburns opacity-100' : i === idx ? 'opacity-100' : 'opacity-0'
                }`}
                aria-hidden={i !== idx}
              />
            ))
          : <FallbackAnimation />}

        {/* Bouton lecture central */}
        {!playing && (
          <button
            onClick={() => setPlaying(true)}
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/15"
            aria-label="Lire l'aperçu animé"
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />
            </span>
          </button>
        )}

        {/* Barre de contrôle */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6">
          <button
            onClick={() => setPlaying((v) => !v)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/90 text-black hover:bg-white"
            aria-label={playing ? 'Pause' : 'Lecture'}
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Play className="ml-0.5 h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
          <div
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/30"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-150" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {ratio} · {durationSec} s
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 p-2.5">
        <p className="flex-1 truncate text-xs font-medium">{a.name}</p>
        <p className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          {hasFrames ? 'aperçu animé — plans générés' : 'aperçu animé — plans stylisés'}
        </p>
      </div>
    </div>
  )
}

/* ---------------- Fichiers texte / bible / plan / transcription ---------------- */

export function TextFileCard({ a, onOpen }: { a: Artifact; onOpen: () => void }) {
  const icon = <FileText className="h-4 w-4" aria-hidden="true" />
  const label =
    a.kind === 'bible'
      ? 'Bible de l’œuvre'
      : a.kind === 'plan'
        ? 'Plan de projet'
        : a.kind === 'transcript'
          ? 'Transcription'
          : 'Document'
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
      aria-label={`Ouvrir ${label} ${a.name}`}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{a.name}</span>
        <span className="text-[11px] text-muted-foreground">
          {label}
          {a.demo ? ' · démo' : ''} · via {a.provider}
        </span>
      </span>
      <Eye className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

/* ---------------- Visionneuse ---------------- */

export function ArtifactViewDialog({
  artifact,
  open,
  onOpenChange,
}: {
  artifact: Artifact | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const safe: Artifact =
    artifact ?? { id: '', kind: 'text', name: '', mimeType: 'text/plain', createdAt: 0, provider: '' }
  const data = useArtifactData(safe)
  const { toast } = useToast()
  if (!artifact) return null
  const src = artifactDataUrl(artifact, data)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate font-display">{artifact.name}</DialogTitle>
          <DialogDescription>
            {artifact.kind} · {artifact.provider}
            {artifact.demo ? ' · démo' : ''} {artifact.bytes ? `· ${fmtSize(artifact.bytes)}` : ''}
          </DialogDescription>
        </DialogHeader>
        {artifact.kind === 'image' && src && (
          <img src={src} alt={artifact.prompt || artifact.name} className="max-h-[55vh] w-full rounded-xl object-contain" />
        )}
        {artifact.kind === 'video' && src?.startsWith('{') && (() => {
          try {
            const p = JSON.parse(src) as VideoPayload
            return p.frames?.length ? (
              <div className="grid grid-cols-3 gap-1.5">
                {p.frames.map((f, i) => (
                  <img
                    key={i}
                    src={`data:${f.mime};base64,${f.base64}`}
                    alt={`Plan ${i + 1}`}
                    className="aspect-video w-full rounded-lg border object-cover"
                  />
                ))}
              </div>
            ) : null
          } catch {
            return null
          }
        })()}
        {artifact.text !== undefined && (
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl border bg-secondary/50 p-4 text-xs leading-relaxed scrollbar-thin">
            {artifact.text}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          {artifact.text !== undefined && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(artifact.text ?? '')
                toast({ title: 'Copié dans le presse-papiers' })
              }}
            >
              Copier le contenu
            </Button>
          )}
          {artifact.text !== undefined && (
            <Button
              size="sm"
              onClick={() => {
                downloadText(artifact.text ?? '', artifact.name)
                toast({ title: 'Fichier téléchargé', description: artifact.name })
              }}
            >
              <Download className="h-3.5 w-3.5" /> Télécharger
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
