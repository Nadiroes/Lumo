'use client'

/** Rendu des artefacts : images réelles, lecteurs démo, cartes fichiers */

import { useEffect, useState } from 'react'
import { AudioLines, Download, Eye, FileText, Play, Sparkles } from 'lucide-react'
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

/** Charge les données binaires depuis IndexedDB si absentes de l’état */
export function useArtifactData(a: Artifact): string | undefined {
  const [data, setData] = useState<string | undefined>(a.data)
  useEffect(() => {
    let alive = true
    if (!a.data) {
      void getArtifactData(a.id).then((d) => {
        if (alive && d) setData(d)
      })
    }
    return () => {
      alive = false
    }
  }, [a.id, a.data])
  return data
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

/* ---------------- Audio (démo) ---------------- */

export function AudioCard({ a }: { a: Artifact }) {
  const voice = a.meta?.voice ? String(a.meta.voice) : 'voix'
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

/* ---------------- Vidéo (démo) ---------------- */

export function VideoCard({ a }: { a: Artifact }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="relative flex aspect-video items-center justify-center bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--primary)_30%,transparent),transparent_55%),radial-gradient(ellipse_at_bottom_right,color-mix(in_oklab,var(--chart-2)_30%,transparent),transparent_55%)] bg-secondary">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Play className="ml-0.5 h-5 w-5" aria-hidden="true" />
        </span>
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {a.meta?.duration ?? '8 s'} · {a.meta?.ratio ?? '16:9'}
        </span>
      </div>
      <div className="flex items-center gap-2 p-2.5">
        <p className="flex-1 truncate text-xs font-medium">{a.name}</p>
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" aria-hidden="true" />
          aperçu démo — rendu Agnes AI à brancher
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
