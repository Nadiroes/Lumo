'use client'

/** Rendu des artefacts : images réelles, lecteurs audio/waveform, vidéos, cartes fichiers */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Download, Eye, FileText, Pause, Play, Sparkles, Volume2, VolumeX, Repeat } from 'lucide-react'
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

/* ---------------- Audio (voix TTS ou musique générée) ---------------- */

/**
 * base64 → Blob → object URL.
 * Contrairement à une data-URI géante collée dans <audio src>, le Blob URL
 * offre une lecture native fiable (durée, seek, gros fichiers multi-Mo)
 * et est révoqué proprement au démontage.
 */
function useAudioObjectUrl(a: Artifact): string | undefined {
  const data = useArtifactData(a)
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let objectUrl: string | undefined
    let cancelled = false
    // Conversion en micro-tâche : évite un setState synchrone dans l'effet
    void Promise.resolve().then(() => {
      if (cancelled) return
      if (!data) {
        setUrl(undefined)
        return
      }
      try {
        const bin = atob(data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: a.mimeType || 'audio/mpeg' }))
        setUrl(objectUrl)
      } catch {
        setUrl(undefined)
      }
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [data, a.mimeType])
  return url
}

/** Forme d'onde par défaut (pendant le décodage ou en cas d'échec) : vague régulière. */
const DEFAULT_PEAKS = Array.from({ length: 84 }, (_, i) => 0.3 + Math.abs(Math.sin(i * 0.55)) * 0.45)

/** Cache module : la décodage d'un morceau de 4 min coûte ~1 s — jamais deux fois pour le même artefact. */
const peaksCache = new Map<string, { peaks: number[]; duration: number }>()

/**
 * Décode l'audio réel via Web Audio et extrait 84 crêtes (0..1) + la durée exacte —
 * c'est la « bande » affichée : la vraie enveloppe du morceau généré.
 * La durée renvoyée par decodeAudioData est exacte (le <audio> peut se tromper sur du MP3 VBR).
 */
function useWaveformPeaks(
  url: string | undefined,
  cacheKey: string,
): { peaks: number[]; decoding: boolean; duration: number } {
  const [state, setState] = useState<{ peaks: number[]; decoding: boolean; duration: number }>(() => {
    const hit = peaksCache.get(cacheKey)
    return hit
      ? { peaks: hit.peaks, decoding: false, duration: hit.duration }
      : { peaks: DEFAULT_PEAKS, decoding: true, duration: 0 }
  })
  useEffect(() => {
    const hit = peaksCache.get(cacheKey)
    if (hit) return // déjà décodé : l'état initial a déjà chargé le cache
    if (!url) return
    let alive = true
    let ctx: AudioContext | undefined
    void (async () => {
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) throw new Error('Web Audio indisponible')
        ctx = new AC()
        const buf = await fetch(url).then((r) => {
          if (!r.ok) throw new Error('lecture impossible')
          return r.arrayBuffer()
        })
        const audio = await ctx.decodeAudioData(buf)
        if (!alive) return
        const ch = audio.getChannelData(0)
        const BARS = 84
        const block = Math.max(1, Math.floor(ch.length / BARS))
        const out: number[] = []
        for (let i = 0; i < BARS; i++) {
          let max = 0
          for (let j = 0; j < block; j += 32) max = Math.max(max, Math.abs(ch[i * block + j]))
          out.push(max)
        }
        const top = Math.max(...out) || 1
        const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
        peaksCache.set(cacheKey, { peaks: out, duration })
        setState({ peaks: out.map((p) => Math.min(1, Math.max(0.12, p / top))), decoding: false, duration })
      } catch {
        if (alive) setState({ peaks: DEFAULT_PEAKS, decoding: false, duration: 0 })
      } finally {
        void ctx?.close().catch(() => {})
      }
    })()
    return () => {
      alive = false
    }
  }, [url, cacheKey])
  return state
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

interface EngineTheme {
  badge: string
  label: string
  played: string
  knob: string
  icon: string
}

/** Couleurs distinctes selon le moteur : DiffRhythm (vert studio) vs aperçu local (ambre). */
function engineTheme(engine: string, isMusic: boolean): EngineTheme {
  if (engine === 'diffrhythm1' || engine === 'diffrhythm2')
    return {
      badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      label: engine === 'diffrhythm2' ? 'DiffRhythm 2' : 'DiffRhythm 1',
      played: 'bg-emerald-500',
      knob: 'bg-emerald-500',
      icon: '🎤',
    }
  if (isMusic)
    return {
      badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
      label: 'Aperçu local',
      played: 'bg-amber-500',
      knob: 'bg-amber-500',
      icon: '🎹',
    }
  return { badge: 'bg-primary/10 text-primary', label: 'Voix', played: 'bg-primary', knob: 'bg-primary', icon: '🔊' }
}

/** Seule lecture à la fois : démarrer un morceau met en pause les autres cartes audio. */
let activeAudioEl: HTMLAudioElement | null = null

export function AudioCard({ a }: { a: Artifact }) {
  const url = useAudioObjectUrl(a)
  const { peaks, decoding, duration: decodedDuration } = useWaveformPeaks(url, a.id)
  const isMusic = !!a.meta?.music
  const voice = a.meta?.voice ? String(a.meta.voice) : 'voix'
  const style = a.meta?.style ? String(a.meta.style) : ''
  const bpm = a.meta?.bpm ? String(a.meta.bpm) : ''
  const keyName = a.meta?.key ? String(a.meta.key) : ''
  const durationSec = a.meta?.durationSec ? Number(a.meta.durationSec) : 0
  const engine = a.meta?.engine ? String(a.meta.engine) : ''
  const qualityLabel = a.meta?.quality ? String(a.meta.quality) : ''
  const instrumental = a.meta?.instrumental === true
  const lyrics = a.meta?.lyrics ? String(a.meta.lyrics) : ''
  const theme = engineTheme(engine, isMusic)
  const ext = a.mimeType?.includes('mpeg') ? 'MP3' : a.mimeType?.includes('ogg') ? 'OGG' : 'WAV'
  const { toast } = useToast()

  /* Transport : lecture, progression, volume, boucle.
   * Durée retenue, par priorité : durée exacte décodée (Web Audio) → durée du <audio>
   * → estimation des métadonnées. Le MP3 VBR peut induire le <audio> en erreur. */
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [elDur, setElDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [muted, setMuted] = useState(false)
  const [loop, setLoop] = useState(false)
  const dur = decodedDuration > 0 ? decodedDuration : elDur > 0 ? elDur : durationSec

  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0

  function toggle() {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      void el.play().catch(() => toast({ title: 'Lecture impossible', variant: 'destructive' }))
    } else {
      el.pause()
    }
  }

  /** Clic (ou clavier) sur la bande → seek à la position visée */
  function seekTo(clientX: number, el: HTMLElement) {
    const audio = audioRef.current
    if (!audio || !dur) return
    const rect = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    audio.currentTime = frac * dur
    setCur(audio.currentTime)
  }

  function onWaveKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio) return
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      audio.currentTime = Math.min(dur, audio.currentTime + 5)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      audio.currentTime = Math.max(0, audio.currentTime - 5)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      toggle()
    }
  }

  if (url) {
    const metaLine = isMusic
      ? [
          style !== 'libre' && style ? style : '',
          bpm ? `${bpm} BPM` : '',
          keyName,
          instrumental ? 'instrumental' : '',
        ]
          .filter(Boolean)
          .join(' · ')
      : `voix « ${voice} » · ${a.provider}`

    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        {/* Élément de lecture réel, caché — le Blob URL garantit seek + durée natives */}
        <audio
          ref={audioRef}
          src={url}
          loop={loop}
          preload="metadata"
          className="hidden"
          aria-label={`Lecture de ${a.name}`}
          onPlay={(e) => {
            /* Lecture exclusive : le démarrage d'une carte met en pause la précédente —
             * sinon deux morceaux se superposent et l'écoute devient incompréhensible. */
            if (activeAudioEl && activeAudioEl !== e.currentTarget && !activeAudioEl.paused) {
              activeAudioEl.pause()
            }
            activeAudioEl = e.currentTarget
            setPlaying(true)
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setElDur(d)
          }}
          onVolumeChange={(e) => setVol(e.currentTarget.volume)}
        />

        {/* Ligne titre + badge moteur + téléchargement */}
        <div className="flex items-center gap-2.5 px-3 pb-1 pt-3">
          <span
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${theme.badge}`}
            aria-hidden="true"
          >
            <AudioLines className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{a.name.replace(/\.(wav|mp3|ogg)$/, '')}</p>
            <p className="truncate text-[10px] text-muted-foreground">{metaLine}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${theme.badge}`}
            title={
              engine.startsWith('diffrhythm')
                ? `Généré par ${theme.label} (studio Hugging Face) — vraie chanson rendue`
                : isMusic
                  ? 'Composition procédurale locale — aperçu instrumental, pas une chanson DiffRhythm'
                  : 'Synthèse vocale Lumo'
            }
          >
            {theme.icon} {theme.label}
            {qualityLabel ? ` · ${qualityLabel}` : ''}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 gap-1 text-[11px]"
            onClick={() => {
              const link = document.createElement('a')
              link.href = url
              link.download = a.name
              link.click()
              toast({ title: 'Audio téléchargé', description: a.name })
            }}
          >
            <Download className="h-3 w-3" /> {ext}
          </Button>
        </div>

        {/* La bande : lecture + forme d'onde réelle cliquable + temps + volume */}
        <div className="flex items-center gap-3 px-3 pb-3 pt-1.5">
          <button
            onClick={toggle}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-transform hover:scale-105 active:scale-95 ${theme.played}`}
            aria-label={playing ? 'Pause' : 'Lecture'}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>

          <div
            role="slider"
            tabIndex={0}
            aria-label="Position de lecture — cliquez pour vous déplacer"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-valuetext={`${fmtTime(cur)} sur ${fmtTime(dur)}`}
            onKeyDown={onWaveKey}
            onClick={(e) => seekTo(e.clientX, e.currentTarget)}
            className="group relative flex h-12 min-w-0 flex-1 cursor-pointer items-center gap-[2px] rounded-md px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {peaks.map((p, i) => {
              const played = (i / peaks.length) * 100 <= pct
              return (
                <span
                  key={i}
                  className={`min-w-[2px] flex-1 rounded-full transition-[background-color] duration-150 ${
                    played ? theme.played : 'bg-muted-foreground/25'
                  } ${decoding ? 'opacity-60' : ''}`}
                  style={{ height: `${Math.max(8, Math.round(p * 100))}%` }}
                />
              )
            })}
            {/* Curseur de position */}
            <span
              className="pointer-events-none absolute top-0 h-full w-0.5 bg-foreground/70 opacity-0 shadow transition-opacity group-hover:opacity-100"
              style={{ left: `calc(${pct}% - 1px)`, opacity: pct > 0 && pct < 100 ? 1 : undefined }}
            />
          </div>

          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {fmtTime(cur)} / {fmtTime(dur)}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLoop((v) => !v)}
                aria-pressed={loop}
                aria-label="Lecture en boucle"
                title="Boucle"
                className={`rounded p-1 transition-colors ${loop ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Repeat className="h-3 w-3" />
              </button>
              <button
                onClick={() => {
                  const audio = audioRef.current
                  if (!audio) return
                  const next = !audio.muted
                  audio.muted = next
                  setMuted(next)
                }}
                aria-label={muted ? 'Réactiver le son' : 'Couper le son'}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : vol}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  const audio = audioRef.current
                  if (audio) {
                    audio.volume = v
                    audio.muted = false
                  }
                  setVol(v)
                  setMuted(false)
                }}
                aria-label="Volume"
                className="h-1 w-14 cursor-pointer accent-primary"
              />
            </div>
          </div>
        </div>

        {lyrics && (
          <details className="group border-t bg-muted/30">
            <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              📝 Paroles de la chanson
              <span className="float-right text-[10px] group-open:hidden">afficher ▾</span>
              <span className="float-right hidden text-[10px] group-open:inline">masquer ▴</span>
            </summary>
            <div className="max-h-44 overflow-y-auto whitespace-pre-line px-3 pb-3 text-[11px] leading-relaxed text-foreground/90">
              {lyrics.split('\n').map((line, i) =>
                line.trim().startsWith('[') ? (
                  <p key={i} className="mt-2 font-semibold uppercase tracking-wide text-primary/80">
                    {line.replace(/[[\]]/g, '')}
                  </p>
                ) : (
                  <p key={i}>{line}</p>
                ),
              )}
            </div>
          </details>
        )}
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
          {isMusic ? 'préparation de la bande…' : `voix « ${voice} » · flux à brancher`} ({a.provider})
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
        {artifact.kind === 'audio' && (
          /* Même lecteur waveform que dans la conversation : lecture fiable depuis le panneau artefacts */
          <AudioCard a={artifact} />
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
