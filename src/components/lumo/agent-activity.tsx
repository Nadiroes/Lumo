'use client'

/**
 * Suivi d'activité des agents Lumo — panneau repliable façon DeepSeek/ChatGPT.
 * Affiche les étapes et l'arborescence des fichiers créés en temps réel.
 */

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileCode,
  FilePlus2,
  Loader2,
  PenLine,
  Radio,
} from 'lucide-react'
import type { AgentActivity } from '@/lib/lumo/types'

function StepRow({ label, state }: { label: string; state: 'done' | 'run' | 'todo' }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-snug">
      {state === 'done' ? (
        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
      ) : state === 'run' ? (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <span className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        </span>
      )}
      <span className={state === 'todo' ? 'text-muted-foreground/70' : state === 'done' ? 'text-muted-foreground' : 'text-foreground'}>
        {label}
      </span>
    </li>
  )
}

function FileRow({ name, state }: { name: string; state: 'writing' | 'done' }) {
  return (
    <li className="flex items-center gap-2 text-[11px] leading-snug">
      {state === 'done' ? (
        <FileCode className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
      ) : (
        <FilePlus2 className="h-3 w-3 shrink-0 animate-pulse text-primary" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono">{name}</span>
      {state === 'writing' ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-primary">
          <PenLine className="h-3 w-3 animate-pulse" aria-hidden="true" /> écriture…
        </span>
      ) : (
        <span className="shrink-0 text-emerald-600 dark:text-emerald-400">prêt</span>
      )}
    </li>
  )
}

export function AgentActivityPanel({ activity, running }: { activity: AgentActivity; running: boolean }) {
  // Déplie pendant le travail, replie automatiquement à la fin
  // (état ajusté pendant le rendu — pattern React recommandé)
  const [openOverride, setOpenOverride] = useState<boolean | null>(null)
  const [wasRunning, setWasRunning] = useState(running)
  if (wasRunning !== running) {
    setWasRunning(running)
    setOpenOverride(running)
  }
  const open = openOverride ?? running
  const doneCount = activity.steps.filter((s) => s.state === 'done').length
  const allDone = doneCount === activity.steps.length

  return (
    <div className="mb-2 overflow-hidden rounded-xl border bg-secondary/40">
      <button
        onClick={() => setOpenOverride(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/60"
        aria-expanded={open}
        aria-label={`${open ? 'Replier' : 'Déplier'} le suivi des agents`}
      >
        <Radio
          className={`h-3.5 w-3.5 shrink-0 ${running ? 'animate-pulse text-primary' : 'text-muted-foreground'}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{activity.label}</span>
        <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {doneCount}/{activity.steps.length}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="border-t px-3 py-2.5">
          <ul className="space-y-1.5">
            {activity.steps.map((s) => (
              <StepRow key={s.label} label={s.label} state={s.state} />
            ))}
          </ul>
          {activity.files && activity.files.length > 0 && (
            <div className="mt-2.5 rounded-lg border bg-background p-2">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Arborescence du projet
              </p>
              <ul className="space-y-1">
                {activity.files.map((f) => (
                  <FileRow key={f.name} name={f.name} state={f.state} />
                ))}
              </ul>
            </div>
          )}
          {activity.note && !allDone && (
            <p className="mt-2 text-[11px] italic text-muted-foreground">{activity.note}</p>
          )}
        </div>
      )}
    </div>
  )
}
