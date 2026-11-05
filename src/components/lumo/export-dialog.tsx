'use client'

/**
 * Dialogue d’export : la double issue du cahier des charges.
 * 1. Garder dans le projet (local)   2. Exporter un .zip versionné réel
 * (manifest.json, transcript, artefacts binaires, checksums SHA-256)
 */

import { useMemo, useState } from 'react'
import { BadgeCheck, FileArchive, FolderTree, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { buildExportZip, downloadBlob, nextExportVersion } from '@/lib/lumo/export'
import { useLumo } from '@/lib/lumo/store'
import type { Session } from '@/lib/lumo/types'

function slugifyLocal(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'session'
  )
}

export function ExportDialog({
  session,
  open,
  onOpenChange,
}: {
  session: Session
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const recordExport = useLumo((s) => s.recordExport)
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const version = useMemo(() => nextExportVersion(session), [session])

  const stats = useMemo(() => {
    const messages = session.messages.filter((m) => !m.pending && !m.error)
    const artifacts = messages.flatMap((m) => m.artifacts ?? [])
    const byKind: Record<string, number> = {}
    artifacts.forEach((a) => {
      byKind[a.kind] = (byKind[a.kind] ?? 0) + 1
    })
    const bytes = artifacts.reduce((n, a) => n + (a.bytes ?? (a.text?.length ?? 0)), 0)
    return { messages: messages.length, artifacts, byKind, bytes }
  }, [session])

  const root = `Lumo_Export_${slugifyLocal(session.title)}_${version}`

  async function exportZip() {
    setBusy(true)
    try {
      const result = await buildExportZip(session)
      downloadBlob(result.blob, result.filename)
      recordExport(session.id, {
        version: result.version,
        exportedAt: Date.now(),
        files: result.files,
        bytes: result.bytes,
        keptInProject: false,
      })
      toast({
        title: `Export ${result.version} téléchargé`,
        description: `${result.filename} · ${result.files} fichiers · manifest et checksums inclus.`,
      })
      onOpenChange(false)
    } catch (e) {
      toast({
        title: 'Export impossible',
        description: e instanceof Error ? e.message : 'Erreur inconnue.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  function keepInProject() {
    recordExport(session.id, {
      version,
      exportedAt: Date.now(),
      files: stats.artifacts.length + 3,
      bytes: stats.bytes,
      keptInProject: true,
    })
    toast({
      title: 'Session conservée dans le projet',
      description: 'Elle reste accessible depuis l’accueil, avec ses artefacts.',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 font-display">
            <FileArchive className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 break-words">Exporter « {session.title} »</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Version suivante : <strong>{version}</strong>
            {session.exports.length > 0 && ` (précédente : ${session.exports[session.exports.length - 1].version})`}
            {' — '}chaque export crée une archive autonome, jamais d’écrasement.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Résumé du contenu */}
          <div className="grid min-w-0 grid-cols-3 gap-2 text-center">
            {[
              { n: stats.messages, l: 'messages' },
              { n: stats.artifacts.length, l: 'artefacts' },
              {
                n: stats.bytes >= 1_048_576
                  ? `${(stats.bytes / 1_048_576).toFixed(1)} Mo`
                  : `${Math.max(1, Math.round(stats.bytes / 1024))} Ko`,
                l: 'contenu',
              },
            ].map(({ n, l }) => (
              <div key={l} className="min-w-0 rounded-xl border bg-secondary/40 p-2.5">
                <p className="truncate font-display text-base font-semibold sm:text-lg">{n}</p>
                <p className="truncate text-[11px] text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>

          {Object.keys(stats.byKind).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(stats.byKind).map(([kind, n]) => (
                <span key={kind} className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                  {n} × {kind}
                </span>
              ))}
            </div>
          )}

          {/* Aperçu de la structure */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <FolderTree className="h-3.5 w-3.5" aria-hidden="true" /> Structure de l’archive
            </p>
            <pre className="max-h-44 overflow-auto rounded-xl border bg-secondary/50 p-3 text-[11px] leading-relaxed scrollbar-thin">{`${root}/
├── manifest.json            ← versioning + empreintes
├── README.md
├── conversation/
│   ├── transcript.json
│   └── transcript.md
├── artifacts/               ← ${stats.artifacts.length} fichier(s)
└── metadata/
    ├── providers.json
    ├── checksums.sha256${session.brief ? '\n    └── brief.json             ← direction artistique' : ''}`}</pre>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" className="flex-1 gap-1.5" onClick={keepInProject}>
              <BadgeCheck className="h-4 w-4 text-primary" />
              Garder dans le projet
            </Button>
            <Button className="flex-1 gap-1.5" onClick={exportZip} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
              Exporter le .zip
            </Button>
          </div>
          {session.savedToProject && (
            <p className="text-center text-[11px] text-primary">Cette session est déjà conservée dans le projet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
