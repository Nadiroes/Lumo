'use client'

/**
 * Mode Hub — point de départ créatif de Lumo.
 * L’utilisateur choisit d’abord un mode de création, puis est dirigé
 * vers la fenêtre de conversation adaptée.
 */

import { motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Cuboid,
  Download,
  Pin,
  Star,
  Sun,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { LumoWordmark } from '@/components/lumo/logo'
import { ModeIcon } from '@/components/lumo/mode-icon'
import { ModelHubDialog } from '@/components/lumo/model-picker'
import { SettingsDialog } from '@/components/lumo/settings-dialog'
import { ThemeToggle } from '@/components/lumo/theme-toggle'
import { useLumo } from '@/lib/lumo/store'
import { MODE_INFO, type Mode } from '@/lib/lumo/types'

const CARD_MODES: { mode: Mode; featured?: boolean }[] = [
  { mode: 'text' },
  { mode: 'image' },
  { mode: 'video' },
  { mode: 'audio' },
  { mode: 'book', featured: true },
  { mode: 'project' },
  { mode: 'free' },
]

function groupLabel(ts: number): string {
  const now = new Date()
  const d = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ts >= startOfToday) return 'Aujourd’hui'
  if (ts >= startOfToday - 86400000) return 'Hier'
  if (ts >= startOfToday - 7 * 86400000) return 'Cette semaine'
  return 'Plus ancien'
}

export function ModeHub({ onBookWizard }: { onBookWizard: () => void }) {
  const sessions = useLumo((s) => s.sessions)
  const hfCount = useLumo((s) => s.hfModels.length)
  const startSession = useLumo((s) => s.startSession)
  const openSession = useLumo((s) => s.openSession)
  const togglePin = useLumo((s) => s.togglePin)

  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)
  const artifactCount = sessions.reduce(
    (n, s) => n + s.messages.reduce((k, m) => k + (m.artifacts?.length ?? 0), 0),
    0,
  )
  const exportCount = sessions.reduce((n, s) => n + s.exports.length, 0)

  const pinned = recent.filter((s) => s.pinned)
  const unpinned = recent.filter((s) => !s.pinned)
  const ordered = [...pinned, ...unpinned]

  return (
    <div className="flex h-dvh flex-col overflow-y-auto bg-background scrollbar-thin">
      {/* Barre supérieure */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <LumoWordmark />
          <div className="flex items-center gap-1.5">
            <ModelHubDialog
              trigger={
                <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
                  <Cuboid className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span className="hidden sm:inline">Hub de modèles</span>
                  {hfCount > 0 && (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      {hfCount}
                    </span>
                  )}
                </Button>
              }
            />
            <ThemeToggle />
            <SettingsDialog />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-10 sm:px-6">
        {/* Héros */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex">
            <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Sun className="float-slow h-9 w-9 text-primary" aria-hidden="true" />
            </span>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Bonjour. Que voulez-vous créer aujourd’hui ?
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Choisissez un point de départ — le mode n’est jamais une prison : vous pouvez changer d’outil
            en pleine conversation, puis tout exporter en .zip versionné.
          </p>
        </div>

        {/* Cartes de modes */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CARD_MODES.map(({ mode, featured }, i) => {
            const info = MODE_INFO[mode]
            return (
              <motion.button
                key={mode}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.35, ease: 'easeOut' }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => (mode === 'book' ? onBookWizard() : startSession(mode))}
                className={`group relative flex flex-col items-start gap-2.5 rounded-2xl border p-5 text-left transition-colors ${
                  featured
                    ? 'border-primary/40 bg-primary/5 hover:border-primary/70 hover:bg-primary/10'
                    : 'bg-card hover:border-primary/40 hover:bg-accent'
                }`}
                aria-label={`Nouvelle session ${info.label} — ${info.tagline}`}
              >
                {featured && (
                  <span className="absolute right-4 top-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Nouveau
                  </span>
                )}
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  {mode === 'book' ? <BookOpen className="h-5 w-5" aria-hidden="true" /> : <ModeIcon mode={mode} className="h-5 w-5" />}
                </span>
                <span className="font-display text-base font-semibold">{info.label}</span>
                <span className="text-sm leading-snug text-muted-foreground">{info.description}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  Commencer <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </motion.button>
            )
          })}

          {/* Carte stats */}
          <div className="flex flex-col justify-center gap-3 rounded-2xl border border-dashed p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vos créations</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { n: sessions.length, l: 'sessions' },
                { n: artifactCount, l: 'artefacts' },
                { n: exportCount, l: 'exports' },
              ].map(({ n, l }) => (
                <div key={l}>
                  <p className="font-display text-xl font-semibold text-primary">{n}</p>
                  <p className="text-[11px] text-muted-foreground">{l}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Stockées en local sur votre machine — rien ne quitte votre appareil sans export.
            </p>
          </div>
        </div>

        {/* Projets récents */}
        <section className="mt-12" aria-label="Projets récents">
          <h2 className="mb-4 font-display text-lg font-semibold">Projets récents</h2>
          {recent.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Aucune session pour l’instant — lancez votre première création ci-dessus.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ordered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ModeIcon mode={s.mode} className="h-4.5 w-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{MODE_INFO[s.mode].label}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatDistanceToNow(new Date(s.updatedAt), { addSuffix: true, locale: fr })}
                      </span>
                      {s.exports.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-0.5">
                            <Download className="h-3 w-3" aria-hidden="true" />
                            {s.exports.length}
                          </span>
                        </>
                      )}
                      {s.savedToProject && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-0.5 text-primary">
                            <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                            dans le projet
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={s.pinned ? 'Retirer des épinglés' : 'Épingler la session'}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePin(s.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        e.stopPropagation()
                        togglePin(s.id)
                      }
                    }}
                    className="mt-0.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    {s.pinned ? <Pin className="h-3.5 w-3.5 text-primary" /> : <Star className="h-3.5 w-3.5" />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t bg-sidebar">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-4 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <p>Lumo v0.1 — studio de création multimodal · démo locale</p>
          <p>
            Export .zip versionné · Agnes AI · Mistral · <span className="text-primary">Hugging Face</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
