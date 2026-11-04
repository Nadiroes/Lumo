'use client'

/**
 * Aperçu de code du mode Dev Web :
 * - WebCodeCard : carte dans le fil de conversation
 * - CodePreviewDialog : onglets fichiers, aperçu live (iframe sandboxée),
 *   bascule mobile/desktop, copie et téléchargement.
 */

import { useMemo, useState } from 'react'
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode,
  Monitor,
  Play,
  Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { downloadText } from '@/lib/lumo/export'
import { buildPreviewSrcDoc } from '@/lib/lumo/codegen'
import type { Artifact, CodeFile } from '@/lib/lumo/types'

function parseFiles(a: Artifact): CodeFile[] {
  if (a.files?.length) return a.files
  const raw = a.meta?.files
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as CodeFile[]
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* méta corrompue */
    }
  }
  return []
}

function fmtLang(f: CodeFile): string {
  return f.lang === 'javascript' ? 'JS' : f.lang === 'typescript' ? 'TS' : f.lang.toUpperCase()
}

/* ------------------------------------------------------------------ */
/* Carte dans le fil                                                   */
/* ------------------------------------------------------------------ */

export function WebCodeCard({ a, onOpen }: { a: Artifact; onOpen: () => void }) {
  const files = parseFiles(a)
  const framework = String(a.meta?.framework ?? 'web')
  const previewable = String(a.meta?.previewable ?? '') === 'oui'
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
      aria-label={`Ouvrir le projet ${framework} (${files.length} fichiers)`}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Code2 className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{a.name}</span>
        <span className="text-[11px] text-muted-foreground">
          Projet {framework} · {files.length} fichier(s) ·{' '}
          {files.map((f) => f.name).join(', ').slice(0, 60)}
          {previewable ? ' · aperçu live' : ' · code seul'}
        </span>
      </span>
      <Eye className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Visionneuse complète                                                */
/* ------------------------------------------------------------------ */

export function CodePreviewDialog({
  artifact,
  open,
  onOpenChange,
}: {
  artifact: Artifact | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { toast } = useToast()
  const files = useMemo(() => (artifact ? parseFiles(artifact) : []), [artifact])
  const [activeFile, setActiveFile] = useState(0)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [copied, setCopied] = useState(false)

  const srcDoc = useMemo(() => (files.length ? buildPreviewSrcDoc(files) : null), [files])
  const previewable = !!srcDoc
  const file = files[Math.min(activeFile, Math.max(0, files.length - 1))]

  function downloadAll() {
    if (!artifact) return
    for (const f of files) downloadText(f.content, f.name)
    toast({ title: 'Fichiers téléchargés', description: `${files.length} fichier(s)` })
  }

  if (!artifact) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92dvh] w-[min(96vw,56rem)] max-w-none! flex-col overflow-hidden p-0 sm:h-[85dvh]">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 truncate font-display text-base">
            <Code2 className="h-4.5 w-4.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{artifact.name}</span>
          </DialogTitle>
          <DialogDescription>
            Projet {String(artifact.meta?.framework ?? 'web')} · {files.length} fichier(s) · généré par{' '}
            {artifact.provider}
          </DialogDescription>
        </DialogHeader>

        {/* Onglets Aperçu / Code + viewport */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/40 px-4 py-2">
          <div className="flex rounded-lg border bg-background p-0.5" role="tablist" aria-label="Mode d’affichage">
            <button
              role="tab"
              aria-selected={tab === 'preview'}
              onClick={() => setTab('preview')}
              disabled={!previewable}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                tab === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Play className="h-3 w-3" /> Aperçu
            </button>
            <button
              role="tab"
              aria-selected={tab === 'code'}
              onClick={() => setTab('code')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'code' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileCode className="h-3 w-3" /> Code
            </button>
          </div>
          {tab === 'preview' && previewable && (
            <div className="flex rounded-lg border bg-background p-0.5" aria-label="Taille d’aperçu">
              <button
                onClick={() => setViewport('mobile')}
                aria-pressed={viewport === 'mobile'}
                aria-label="Aperçu mobile 390 px"
                className={`rounded-md p-1.5 ${viewport === 'mobile' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                <Smartphone className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewport('desktop')}
                aria-pressed={viewport === 'desktop'}
                aria-label="Aperçu bureau"
                className={`rounded-md p-1.5 ${viewport === 'desktop' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Contenu */}
        {tab === 'preview' && previewable ? (
          <div className="min-h-0 flex-1 overflow-auto bg-secondary/60 p-3 sm:p-4">
            <div
              className={`mx-auto h-full overflow-hidden rounded-xl border bg-white shadow-sm ${
                viewport === 'mobile' ? 'w-full max-w-[390px]' : 'w-full'
              }`}
            >
              <iframe
                title="Aperçu du site généré"
                srcDoc={srcDoc ?? undefined}
                sandbox="allow-scripts allow-popups"
                className="h-full min-h-[420px] w-full"
              />
            </div>
          </div>
        ) : tab === 'code' || !previewable ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Liste des fichiers */}
            <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 scrollbar-thin" role="tablist" aria-label="Fichiers du projet">
              {files.map((f, i) => (
                <button
                  key={f.name}
                  role="tab"
                  aria-selected={i === activeFile}
                  onClick={() => setActiveFile(i)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    i === activeFile ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <FileCode className="h-3 w-3" aria-hidden="true" />
                  {f.name}
                  <span className="rounded bg-secondary px-1 text-[9px] uppercase">{fmtLang(f)}</span>
                </button>
              ))}
            </div>
            {file ? (
              <pre className="min-h-0 flex-1 overflow-auto bg-secondary/40 p-4 text-[11px] leading-relaxed scrollbar-thin sm:text-xs">
                <code>{file.content}</code>
              </pre>
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Aucun fichier dans cet artefact.</p>
            )}
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2.5">
          {!previewable && (
            <p className="mr-auto text-[11px] text-muted-foreground">
              Aperçu live disponible pour HTML / JavaScript (les projets React, Next.js et PHP se testent localement).
            </p>
          )}
          {file && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(file.content)
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              Copier {file.name}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={downloadAll}>
            <Download className="h-3.5 w-3.5" /> Tout télécharger
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
