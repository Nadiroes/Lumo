'use client'

/**
 * Paramètre « Lien Hugging Face » d'un bloc (ou lien général de Lumo).
 *
 * - Collez un lien : dépôt précis (Qwen/Qwen2.5-Omni-7B), organisation complète
 *   (huggingface.co/deepseek-ai → tous ses modèles) ou simple nom à rechercher.
 * - Les modèles détectés sont listés pour être CHARGÉS puis UTILISÉS dans ce bloc,
 *   indépendamment du lien HF général (qui reste actif comme une connexion API).
 * - Moteur local (llama.cpp CPU) : les fichiers .gguf peuvent être INSTALLÉS sur la
 *   machine (vérification disque, aucune limite de taille) puis LANCÉS dans l'app.
 * - Chaîne de repli à la génération : modèle local → modèle du bloc → lien
 *   général → clés API → Lumo Core.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Cuboid,
  Cpu,
  Database,
  Download,
  Folder,
  HardDrive,
  Link2,
  Loader2,
  Package,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import {
  apiHfDetect,
  apiLocalAction,
  apiLocalStatus,
  apiPipelinesAction,
  apiPipelinesStatus,
  type LocalStatus,
  type PipelineStatus,
} from '@/lib/lumo/api'
import { catalogFor, type CatalogEntry } from '@/lib/lumo/catalog'
import { hfTaskToCaps, type Capability } from '@/lib/lumo/providers'
import { useLumo } from '@/lib/lumo/store'
import {
  MODE_INFO,
  type HfCandidate,
  type HfDetectResult,
  type HfLinkConfig,
  type Mode,
} from '@/lib/lumo/types'

function fmtSize(n: number): string {
  if (!n) return 'taille inconnue'
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} Go`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} Mo`
  return `${Math.max(1, Math.round(n / 1024))} Ko`
}

function fmtDl(n?: number): string {
  if (!n) return ''
  return ` · ${n.toLocaleString('fr-FR')} téléch.`
}

/* ---------------------------------------------------------------- */
/* Rangée « modèle proposé » (organisation / recherche)               */
/* ---------------------------------------------------------------- */

function CandidateRow({
  c,
  caps,
  selected,
  onSelect,
}: {
  c: HfCandidate
  caps: Capability[]
  selected?: boolean
  onSelect: (c: HfCandidate) => void
}) {
  const compatible = caps.length > 0
  return (
    <li className="flex items-start gap-2 rounded-lg border bg-background p-2">
      <Cuboid className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={c.id}>
          {c.id}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {c.task}
          {fmtDl(c.downloads)}
          {c.likes ? ` · ♥ ${c.likes}` : ''}
          {compatible ? '' : ' · hors capacité de ce bloc (relais possible)'}
        </p>
      </div>
      <Button
        size="sm"
        variant={selected ? 'secondary' : 'outline'}
        className="h-7 shrink-0 gap-1 text-[11px]"
        onClick={() => onSelect(c)}
        aria-pressed={selected}
      >
        {selected ? <Check className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
        {selected ? 'Actif' : 'Utiliser'}
      </Button>
    </li>
  )
}

/* ---------------------------------------------------------------- */
/* Dépôt précis : fichiers + sous-dossiers                           */
/* ---------------------------------------------------------------- */

function RepoFiles({
  repoId,
  kind,
  dirs,
  files,
  onOpenDir,
  loadingDir,
  onInstallLocal,
  busyFile,
}: {
  repoId: string
  kind: string
  dirs: string[]
  files: { path: string; size: number; ext: string }[]
  onOpenDir: (dir: string) => void
  loadingDir: boolean
  /** Installe un .gguf sur la machine (runtime CPU) */
  onInstallLocal?: (file: string, size: number) => void
  busyFile?: string | null
}) {
  return (
    <div className="mt-2 space-y-1.5">
      {dirs.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {dirs.map((d) => (
            <li key={d}>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 rounded-full px-2 text-[10px]"
                disabled={loadingDir}
                onClick={() => onOpenDir(d)}
                title={`Explorer le dossier ${d}`}
              >
                <Folder className="h-2.5 w-2.5" /> {d.split('/').pop()}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((f) => {
            const gguf = /\.gguf$/i.test(f.path)
            const weight = /\.(safetensors|gguf|onnx|bin|pth|ckpt|tar|tgz)$/i.test(f.path)
            return (
              <li key={f.path} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={f.path}>
                  {f.path.split('/').pop()}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {weight ? 'poids · ' : 'config · '}
                  {fmtSize(f.size)}
                </span>
                {gguf && onInstallLocal && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 gap-1 px-2 text-[10px]"
                    disabled={busyFile === f.path}
                    onClick={() => onInstallLocal(f.path, f.size)}
                    title="Installer ce modèle sur cette machine (CPU) et l'utiliser dans l'app"
                  >
                    {busyFile === f.path ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : (
                      <Download className="h-2.5 w-2.5" />
                    )}
                    Local
                  </Button>
                )}
                <a
                  href={`https://huggingface.co/${kind === 'dataset' ? 'datasets/' : ''}${repoId}/resolve/main/${f.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary"
                  title="Télécharger ce fichier depuis Hugging Face"
                  aria-label={`Télécharger ${f.path}`}
                >
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </li>
            )
          })}
        </ul>
      ) : (
        dirs.length === 0 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Aucun fichier de poids détecté — le dépôt reste utilisable par son identifiant.
          </p>
        )
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Moteur local : runtime, disque, modèles installés, téléchargements */
/* ---------------------------------------------------------------- */

function LocalModelsSection({
  local,
  busy,
  onSetupRuntime,
  onStart,
  onStop,
  onRemove,
}: {
  local: LocalStatus | null
  busy: string | null
  onSetupRuntime: () => void
  onStart: (id: string) => void
  onStop: (id: string) => void
  onRemove: (id: string) => void
}) {
  const installed = local?.runtime.installed ?? false
  const models = local?.models ?? []
  const dls = (local?.downloads ?? []).filter((d) => d.status !== 'done')

  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          Moteur local — CPU
          {installed && local?.runtime.version && (
            <span className="truncate text-[10px] font-normal text-muted-foreground">
              {local.runtime.version.split('(')[0].trim()}
            </span>
          )}
        </p>
        {local && (
          <p className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground" title="Espace disque libre">
            <HardDrive className="h-3 w-3" aria-hidden="true" />
            {fmtSize(local.disk.freeBytes)} libres
          </p>
        )}
      </div>

      {!installed ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Exécutez les modèles <span className="font-mono">.gguf</span> directement sur cette machine (CPU) :
            aucune donnée envoyée en ligne, aucun quota. Installation une seule fois (~25 Mo).
          </p>
          <Button
            size="sm"
            className="h-7 w-full gap-1 text-[11px]"
            disabled={busy === 'runtime'}
            onClick={onSetupRuntime}
          >
            {busy === 'runtime' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Installer le runtime local (llama.cpp)
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {/* Téléchargements en cours / en erreur */}
          {dls.map((d) => {
            const pct = d.total > 0 ? Math.min(100, Math.round((d.bytes / d.total) * 100)) : null
            return (
              <div key={d.id} className="rounded-md border bg-background px-2 py-1.5">
                <div className="flex items-center gap-2">
                  {d.status === 'download' ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
                  ) : (
                    <TriangleAlert className="h-3 w-3 shrink-0 text-destructive" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{d.file.split('/').pop()}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {pct !== null ? `${pct} % · ${fmtSize(d.bytes)}` : fmtSize(d.bytes)}
                    {d.speed ? ` · ${fmtSize(d.speed)}/s` : ''}
                  </span>
                </div>
                {pct !== null && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                )}
                {d.status === 'error' && <p className="mt-1 text-[10px] text-destructive">{d.error}</p>}
              </div>
            )
          })}

          {/* Modèles installés */}
          {models.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.engine.running ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11px]" title={m.file}>
                  {m.file.split('/').pop()}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {m.repoId} · {fmtSize(m.size)}
                  {m.engine.running ? ` · en cours (port ${m.engine.port})` : ' · prêt'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                {m.engine.running ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={busy === `stop:${m.id}`}
                    onClick={() => onStop(m.id)}
                    aria-label="Arrêter le modèle"
                    title="Arrêter (libère la RAM)"
                  >
                    {busy === `stop:${m.id}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Square className="h-2.5 w-2.5" />
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={busy === `start:${m.id}`}
                    onClick={() => onStart(m.id)}
                    aria-label="Démarrer le modèle"
                    title="Démarrer en local"
                  >
                    {busy === `start:${m.id}` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-2.5 w-2.5" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  disabled={busy === `rm:${m.id}`}
                  onClick={() => onRemove(m.id)}
                  aria-label="Supprimer le modèle local"
                  title="Supprimer du disque"
                >
                  {busy === `rm:${m.id}` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-2.5 w-2.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}

          {models.length === 0 && dls.length === 0 && (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Aucun modèle local — cliquez « Local » à côté d'un fichier <span className="font-mono">.gguf</span>{' '}
              d'un dépôt pour l'installer ici. La vérification du disque est automatique, sans limite de taille.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Catalogue : modèles explicitement branchés dans le projet          */
/* ---------------------------------------------------------------- */

const KIND_LABELS: Record<string, string> = {
  code: 'Code · apps',
  vision: 'Vision',
  chat: 'Chat',
  embedding: 'Embeddings',
  tts: 'Voix',
  image: 'Image',
  music: 'Musique',
}

function fmtGo(n?: number): string {
  if (!n) return '?'
  return `${(n / 1e9).toFixed(1)} Go`
}

/**
 * Section « Catalogue » du panneau HF : les modèles choisis pour le projet.
 *  - llamacpp : téléchargement du .gguf sur le disque (moteur local CPU).
 *  - pipeline : environnement Python + poids (vendor/pipelines), exécutés hors ligne.
 */
function CatalogSection({
  mode,
  onInstallGguf,
  busy,
}: {
  mode?: Mode
  onInstallGguf: (repo: string, file: string, size: number) => void
  busy: string | null
}) {
  const entries = catalogFor(mode)
  const [pipes, setPipes] = useState<PipelineStatus[]>([])
  const [envInstalled, setEnvInstalled] = useState(false)
  const [pipeBusy, setPipeBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const st = await apiPipelinesStatus()
      setPipes(st.pipelines)
      setEnvInstalled(st.env.installed && st.env.ready)
    } catch {
      /* silencieux */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const downloading = pipes.some((p) => p.jobs.some((j) => j.kind === 'download' && j.status === 'run'))
  useEffect(() => {
    if (!downloading) return
    const t = setInterval(() => void refresh(), 2500)
    return () => clearInterval(t)
  }, [downloading, refresh])

  const pipeStatus = (entry: CatalogEntry): PipelineStatus | undefined =>
    pipes.find((p) => p.id === entry.pipelineId)

  const act = async (key: string, fn: () => Promise<unknown>, okTitle: string, okDesc: string) => {
    setPipeBusy(key)
    try {
      await fn()
      await refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setPipeBusy(null)
    }
  }

  if (!entries.length) return null
  return (
    <div className="rounded-lg border p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        <Package className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        Catalogue du projet
        <span className="text-[10px] font-normal text-muted-foreground">— modèles branchés dans Lumo</span>
      </p>
      <ul className="mt-2 space-y-2">
        {entries.map((e) => {
          const pipe = e.engine === 'pipeline' ? pipeStatus(e) : undefined
          const downloadingThis = pipe?.jobs.some((j) => j.kind === 'download' && j.status === 'run')
          const pct =
            pipe && pipe.totalBytes > 0 ? Math.min(100, Math.round((pipe.bytesDownloaded / pipe.totalBytes) * 100)) : 0
          return (
            <li key={e.id} className="rounded-md border bg-background px-2 py-2">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.engine === 'pipeline' ? (pipe?.ready ? 'bg-emerald-500' : 'bg-muted-foreground/40') : ''}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 text-xs font-medium">
                    <span className="truncate">{e.title}</span>
                    <span className="rounded-full bg-secondary px-1.5 text-[9px] font-semibold uppercase tracking-wide text-secondary-foreground">
                      {KIND_LABELS[e.kind] ?? e.kind}
                    </span>
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground" title={e.repo}>
                    {e.repo}
                    {e.engine === 'llamacpp' ? ` · GGUF · ${fmtGo(e.sizeBytes)}` : pipe ? ` · poids ${fmtGo(pipe.totalBytes)}` : ''}
                  </p>
                  {e.note && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{e.note}</p>}
                </div>
              </div>

              {/* Voie llama.cpp : téléchargement du GGUF (quant recommandée + variantes) */}
              {e.engine === 'llamacpp' && e.file && e.sizeBytes && (
                <div className="mt-1.5">
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 gap-1 text-[11px]"
                      disabled={busy?.startsWith('cat:') ?? false}
                      onClick={() => onInstallGguf(e.repo, e.file!, e.sizeBytes!)}
                    >
                      {busy?.startsWith('cat:') ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                      Télécharger ({fmtGo(e.sizeBytes)})
                    </Button>
                    {(e.variants?.length ?? 0) > 1 && (
                      <details className="min-w-0 flex-1">
                        <summary className="cursor-pointer select-none text-[10px] text-muted-foreground hover:text-primary">
                          {e.variants!.length - 1} autres quantifications…
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {e.variants!
                            .filter((v) => v.file !== e.file)
                            .map((v) => (
                              <li key={v.file} className="flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 flex-1 justify-start gap-1 px-2 text-[10px]"
                                  disabled={busy?.startsWith('cat:') ?? false}
                                  onClick={() => onInstallGguf(e.repo, v.file, v.sizeBytes)}
                                >
                                  <Download className="h-2.5 w-2.5" />
                                  {v.label}
                                </Button>
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              )}

              {/* Voie pipeline : environnement Python + poids HF */}
              {e.engine === 'pipeline' && pipe && (
                <div className="mt-1.5 space-y-1">
                  {!envInstalled && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full gap-1 text-[11px]"
                      disabled={pipeBusy !== null}
                      onClick={() =>
                        act(
                          'env',
                          () => apiPipelinesAction({ action: 'setup' }),
                          'Environnement en préparation',
                          'Python, PyTorch CPU et code YuE s’installent — quelques minutes.',
                        )
                      }
                    >
                      {pipeBusy === 'env' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      Installer l’environnement (Python + PyTorch CPU)
                    </Button>
                  )}
                  {downloadingThis ? (
                    <div className="rounded border px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" aria-hidden="true" />
                        <span className="text-[10px] text-muted-foreground">
                          Téléchargement {fmtGo(pipe.bytesDownloaded)} / {fmtGo(pipe.totalBytes)}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ) : pipe.ready ? (
                    <p className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" aria-hidden="true" /> Installé — prêt à générer en local
                    </p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full gap-1 text-[11px]"
                      disabled={pipeBusy !== null || !envInstalled}
                      onClick={() =>
                        act(
                          `dl:${e.id}`,
                          () => apiPipelinesAction({ action: 'download', id: e.pipelineId }),
                          'Téléchargement lancé',
                          `${fmtGo(pipe.totalBytes)} de poids — progression visible ici.`,
                        )
                      }
                      title={envInstalled ? undefined : 'Installez d’abord l’environnement'}
                    >
                      {pipeBusy === `dl:${e.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      Télécharger les poids ({fmtGo(pipe.totalBytes)})
                    </Button>
                  )}
                  {pipe.hardware && !pipe.hardware.diskOk && pipe.bytesDownloaded < pipe.totalBytes && (
                    <p className="flex items-start gap-1 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      Disque : {fmtGo(pipe.hardware.diskFreeBytes)} libres pour {fmtGo(pipe.totalBytes)} requis —
                      libérez de la place ou utilisez un disque plus grand.
                    </p>
                  )}
                  {pipe.hardware && !pipe.hardware.ramOk && (
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      RAM détectée : {fmtGo(pipe.hardware.ramTotalBytes)} (conseillé : {fmtGo(pipe.totalBytes + 8e9)}).
                      {pipe.hardware.gpu ? ' GPU détecté ✓' : e.pipelineId === 'yue' || e.pipelineId === 'moss-image' ? ' Sans GPU, l’inférence sera très lente.' : ''}
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Composant principal                                               */
/* ---------------------------------------------------------------- */

export function BlockHfButton({
  mode,
  variant = 'block',
  trigger,
}: {
  /** Mode du bloc — requis pour la variante « bloc » */
  mode?: Mode
  variant?: 'block' | 'global'
  trigger?: React.ReactNode
}) {
  const isGlobal = variant === 'global'
  const blockHf = useLumo((s) => (isGlobal || !mode ? undefined : s.blockHf[mode]))
  const globalHf = useLumo((s) => s.globalHf)
  const setBlockHf = useLumo((s) => s.setBlockHf)
  const clearBlockHf = useLumo((s) => s.clearBlockHf)
  const setGlobalHf = useLumo((s) => s.setGlobalHf)
  const clearGlobalHf = useLumo((s) => s.clearGlobalHf)
  const hfModels = useLumo((s) => s.hfModels)
  const addHfModel = useLumo((s) => s.addHfModel)
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [link, setLink] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<HfDetectResult | null>(null)
  const [dir, setDir] = useState<string | undefined>(undefined)

  /* ----- état du moteur local ----- */
  const [local, setLocal] = useState<LocalStatus | null>(null)
  const [localBusy, setLocalBusy] = useState<string | null>(null)
  /** Modèle fraîchement installé à démarrer dès que le téléchargement est fini */
  const [pendingStart, setPendingStart] = useState<string | null>(null)

  const refreshLocal = useCallback(async () => {
    try {
      setLocal(await apiLocalStatus())
    } catch {
      /* panneau local indisponible : silencieux */
    }
  }, [])

  useEffect(() => {
    if (open) void refreshLocal()
  }, [open, refreshLocal])

  const hasActiveDownload = local?.downloads.some((d) => d.status === 'download') ?? false
  useEffect(() => {
    if (!open || (!hasActiveDownload && !pendingStart)) return
    const t = setInterval(() => void refreshLocal(), 1500)
    return () => clearInterval(t)
  }, [open, hasActiveDownload, pendingStart, refreshLocal])

  const cfg: HfLinkConfig | null | undefined = isGlobal ? globalHf : blockHf
  const label = isGlobal ? 'Lien HF général' : mode ? `Bloc ${MODE_INFO[mode].label}` : 'Bloc'
  const capability: Capability | undefined = !isGlobal && mode ? MODE_INFO[mode].capability : undefined

  async function detect(target?: string, targetDir?: string) {
    const value = (target ?? link).trim()
    if (!value) return
    setLoading(true)
    try {
      const r = await apiHfDetect(value, targetDir)
      setResult(r)
      setDir(targetDir)

      if (r.kind === 'model' || r.kind === 'dataset') {
        const m = r.model
        if (!m) return
        // Résultat « heuristique » = le Hub n'a pas répondu : on n'active PAS un dépôt non vérifié
        const verified = m.source === 'api'
        // Lien précis : on enregistre le lien + le modèle (auto-sélection si vérifié et exécutable)
        const cfgNew: HfLinkConfig = {
          link: value,
          kind: r.kind,
          repoId: m.id,
          models: [{ id: m.id, task: m.task, downloads: m.downloads, likes: m.likes }],
          selected: r.kind === 'model' && verified ? m.id : undefined,
          local: cfg?.repoId === m.id ? cfg?.local : undefined,
          status:
            r.kind === 'dataset'
              ? 'Jeu de données reconnu — consultation/téléchargement uniquement (non exécutable).'
              : verified
                ? `Modèle actif : ${m.id}`
                : 'Dépôt non vérifié (Hub momentanément injoignable) — recliquez « Détecter » pour confirmer.',
          updatedAt: Date.now(),
        }
        // Bibliothèque (affichage sélecteur) : entrée HfModel complète
        addHfModel(m)
        if (isGlobal) setGlobalHf({ ...cfgNew })
        else if (mode) setBlockHf(mode, cfgNew)
        toast({
          title: r.kind === 'dataset' ? 'Jeu de données reconnu' : verified ? (isGlobal ? 'Lien général prêt' : 'Modèle chargé dans le bloc') : 'Dépôt non vérifié',
          description:
            r.kind === 'dataset'
              ? `${m.id} — un dataset n'est pas exécutable comme modèle.`
              : verified
                ? `${m.id}${isGlobal ? ' servira de relais général.' : ` travaille maintenant dans le bloc ${mode ? MODE_INFO[mode].label : ''}.`}`
                : `${m.id} — le Hub n'a pas répondu : recliquez « Détecter ».`,
        })
      } else if (r.kind === 'org' && r.models?.length) {
        toast({
          title: `Organisation ${r.query} — ${r.models.length} modèles`,
          description: 'Choisissez le modèle à utiliser dans la liste.',
        })
      } else if (r.kind === 'search' && r.models?.length) {
        toast({
          title: `${r.models.length} modèles trouvés`,
          description: `Le dépôt exact « ${r.query} » n'existe pas — choisissez une proposition.`,
        })
      }
    } catch (e) {
      toast({
        title: 'Détection impossible',
        description: e instanceof Error ? e.message : 'Vérifiez le lien.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  /** Charge un modèle proposé (organisation / recherche) dans le bloc ou en relais général */
  function useCandidate(c: HfCandidate) {
    const cfgNew: HfLinkConfig = {
      link: result?.query ?? c.id,
      kind: result?.kind === 'org' ? 'org' : 'search',
      repoId: result?.kind === 'org' ? result.query : c.id.split('/')[0],
      models: result?.models ?? [c],
      selected: c.id,
      local: cfg?.repoId === c.id ? cfg?.local : undefined,
      status: `Modèle actif : ${c.id}`,
      updatedAt: Date.now(),
    }
    if (isGlobal) {
      setGlobalHf(cfgNew)
      toast({ title: 'Relais général activé', description: `${c.id} prendra le relais dans tous les blocs.` })
    } else if (mode) {
      setBlockHf(mode, cfgNew)
      // Ajout à la bibliothèque pour le sélecteur multi-capacités
      addHfModel({ id: c.id, task: c.task, downloads: c.downloads, likes: c.likes, source: 'api', addedAt: Date.now(), kind: 'model' })
      toast({
        title: `Modèle chargé — bloc ${MODE_INFO[mode].label}`,
        description: `${c.id} travaille dans ce bloc. En cas de quota, le lien général prend le relais.`,
      })
    }
  }

  function clear() {
    if (isGlobal) {
      clearGlobalHf()
      toast({ title: 'Lien général désactivé' })
    } else if (mode) {
      clearBlockHf(mode)
      toast({ title: `Lien du bloc ${MODE_INFO[mode].label} désactivé`, description: 'Le lien général et les clés API restent actifs.' })
    }
    setResult(null)
    setLink('')
  }

  function resetSelection() {
    if (isGlobal) {
      if (globalHf) {
        setGlobalHf({ ...globalHf, selected: undefined, status: 'Modèle en attente — choisissez dans la liste.' })
      }
    } else if (mode) {
      const cur = blockHf
      if (cur) setBlockHf(mode, { ...cur, selected: undefined, status: 'Modèle en attente — choisissez dans la liste.' })
    }
  }

  /* ----- actions du moteur local ----- */

  const setupRuntime = async () => {
    setLocalBusy('runtime')
    try {
      await apiLocalAction({ action: 'setup-runtime' })
      await refreshLocal()
      toast({
        title: 'Runtime local installé',
        description: 'llama.cpp est prêt — installez un .gguf depuis un dépôt pour travailler hors ligne.',
      })
    } catch (e) {
      toast({
        title: 'Installation impossible',
        description: e instanceof Error ? e.message : 'Réessayez.',
        variant: 'destructive',
      })
    } finally {
      setLocalBusy(null)
    }
  }

  /** Installe un .gguf du dépôt détecté sur la machine (disque vérifié côté serveur) */
  const installLocal = async (file: string, size: number) => {
    const repoId = result?.model?.id ?? cfg?.repoId ?? link.trim()
    if (!repoId.includes('/')) return
    const id = `${repoId}::${file}`
    setLocalBusy(`dl:${file}`)
    try {
      await apiLocalAction({ action: 'download', repoId, file, sizeBytes: size })
      setPendingStart(id)
      void refreshLocal()
      toast({
        title: 'Installation locale lancée',
        description: `${file.split('/').pop()} (${fmtSize(size)}) — progression dans « Moteur local ». Le démarrage est automatique à la fin.`,
      })
    } catch (e) {
      toast({
        title: 'Installation impossible',
        description: e instanceof Error ? e.message : 'Vérifiez l’espace disque.',
        variant: 'destructive',
      })
    } finally {
      setLocalBusy(null)
    }
  }

  /** Installe un .gguf du catalogue du projet (repo explicite, quant au choix) */
  const installCatalogGguf = async (repo: string, file: string, size: number) => {
    const id = `${repo}::${file}`
    setLocalBusy(`cat:${file.split('/').pop()}`)
    try {
      await apiLocalAction({ action: 'download', repoId: repo, file, sizeBytes: size })
      setPendingStart(id)
      void refreshLocal()
      toast({
        title: 'Installation du catalogue lancée',
        description: `${file.split('/').pop()} (${fmtSize(size)}) — progression dans « Moteur local » ; le modèle sera automatiquement actif dans ce bloc.`,
      })
    } catch (e) {
      toast({
        title: 'Téléchargement refusé',
        description: e instanceof Error ? e.message : 'Vérifiez l’espace disque.',
        variant: 'destructive',
      })
    } finally {
      setLocalBusy(null)
    }
  }

  const startLocal = async (id: string) => {
    setLocalBusy(`start:${id}`)
    try {
      await apiLocalAction({ action: 'start', id })
      await refreshLocal()
      const m = local?.models.find((x) => x.id === id)
      // Le bloc adopte le modèle local : priorité maximale dans la chaîne de repli
      if (!isGlobal && mode) {
        const repoId = m?.repoId ?? id.split('::')[0]
        const file = m?.file ?? id.split('::')[1] ?? id
        const cur: HfLinkConfig =
          cfg ?? {
            link: `https://huggingface.co/${repoId}`,
            kind: 'model',
            repoId,
            models: [],
            status: '',
            updatedAt: Date.now(),
          }
        setBlockHf(mode, {
          ...cur,
          repoId: cur.repoId ?? repoId,
          local: id,
          status: `Modèle local actif : ${file.split('/').pop()} (CPU) — prioritaire dans ce bloc.`,
          updatedAt: Date.now(),
        })
      }
      toast({
        title: 'Modèle lancé en local',
        description: isGlobal
          ? 'Le modèle tourne sur cette machine.'
          : `${m?.file.split('/').pop() ?? id} travaille dans le bloc ${mode ? MODE_INFO[mode].label : ''} — priorité sur les liens HF.`,
      })
    } catch (e) {
      toast({
        title: 'Démarrage impossible',
        description: e instanceof Error ? e.message : 'Le modèle n’a pas pu être chargé en RAM.',
        variant: 'destructive',
      })
    } finally {
      setPendingStart(null)
      setLocalBusy(null)
    }
  }

  const stopLocal = async (id: string) => {
    setLocalBusy(`stop:${id}`)
    try {
      await apiLocalAction({ action: 'stop', id })
      await refreshLocal()
      toast({ title: 'Modèle arrêté', description: 'La RAM est libérée — il reste installé sur le disque.' })
    } catch (e) {
      toast({ title: 'Arrêt impossible', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLocalBusy(null)
    }
  }

  const removeLocal = async (id: string) => {
    setLocalBusy(`rm:${id}`)
    try {
      await apiLocalAction({ action: 'remove', id })
      await refreshLocal()
      if (!isGlobal && mode && cfg?.local === id) {
        setBlockHf(mode, { ...cfg, local: undefined, status: 'Modèle local supprimé — retour au lien du bloc.' })
      }
      toast({ title: 'Modèle supprimé', description: 'Le disque est libéré.' })
    } catch (e) {
      toast({ title: 'Suppression impossible', description: e instanceof Error ? e.message : '', variant: 'destructive' })
    } finally {
      setLocalBusy(null)
    }
  }

  /* Démarrage auto après installation : le modèle apparaît dans la liste → on le lance */
  useEffect(() => {
    if (!pendingStart || !local) return
    const done = local.models.find((m) => m.id === pendingStart)
    if (done) {
      setPendingStart(null)
      void startLocal(done.id)
      return
    }
    const dl = local.downloads.find((d) => d.id === pendingStart)
    if (dl?.status === 'error') {
      setPendingStart(null)
      toast({
        title: 'Téléchargement interrompu',
        description: dl.error,
        variant: 'destructive',
      })
    }
  }, [local, pendingStart])

  const capsFor = (c: HfCandidate) => hfTaskToCaps(c.task, c.id).filter((x) => (capability ? x === capability : true))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="sm"
            className={`h-8 max-w-48 gap-1.5 text-xs ${cfg?.selected || cfg?.local ? 'border-primary/50 text-primary' : ''}`}
            aria-label={`${label} : ${cfg?.local ? `modèle local actif (${cfg.local.split('::').pop()})` : cfg?.selected ? `actif (${cfg.selected})` : 'non configuré'}. Configurer le lien Hugging Face.`}
          >
            {cfg?.kind === 'dataset' ? (
              <Database className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            ) : cfg?.local ? (
              <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {isGlobal ? 'HF général' : `HF · ${mode ? MODE_INFO[mode].label : ''}`}
              {cfg?.local
                ? ` : ${cfg.local.split('::').pop()?.replace(/\.gguf$/i, '')}`
                : cfg?.selected
                  ? ` : ${cfg.selected.split('/').pop()}`
                  : ''}
            </span>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg?.local ? 'bg-emerald-500' : cfg?.selected ? 'bg-emerald-500' : cfg ? 'bg-amber-500' : 'bg-muted-foreground/40'}`}
              aria-hidden="true"
            />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] p-0">
        <div className="border-b px-3 py-2.5">
          <p className="text-xs font-semibold">{isGlobal ? 'Lien HF général — relais de Lumo' : `Lien HF du ${label.toLowerCase()}`}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {isGlobal
              ? 'Exploite tout le contenu d’un lien (ex. une organisation DeepSeek). Il reste actif partout et prend le relais quand un lien de bloc tombe.'
              : 'Ce bloc travaille avec ce lien et ses modèles — indépendamment du lien général, qui reste le relais en cas de quota.'}
          </p>
        </div>

        <div className="max-h-[32rem] space-y-3 overflow-y-auto p-3 scrollbar-thin">
          {/* Lien actif */}
          {cfg && (
            <div className="rounded-lg border bg-primary/5 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    {cfg.local ? (
                      <Cpu className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    )}
                    <span className="truncate">{cfg.local ?? cfg.selected ?? cfg.repoId ?? cfg.link}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {cfg.local
                      ? 'modèle local (CPU) · prioritaire dans ce bloc'
                      : isGlobal
                        ? 'relais général'
                        : 'prioritaire dans ce bloc'}{' '}
                    · {cfg.kind}
                    {cfg.selected || cfg.local ? '' : ' — aucun modèle actif'}
                  </p>
                  {cfg.status && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{cfg.status}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {(cfg.selected || cfg.local) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-primary"
                      aria-label="Changer de modèle"
                      title="Changer de modèle"
                      onClick={resetSelection}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    aria-label={isGlobal ? 'Désactiver le lien général' : 'Désactiver le lien du bloc'}
                    title="Désactiver ce lien"
                    onClick={clear}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Saisie du lien */}
          <div className="flex gap-1.5">
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && detect()}
              placeholder="https://huggingface.co/Qwen/Qwen2.5-Omni-7B ou huggingface.co/deepseek-ai"
              className="h-8 text-[11px]"
              aria-label="Lien Hugging Face"
            />
            <Button size="sm" className="h-8 shrink-0 gap-1 text-[11px]" disabled={loading || !link.trim()} onClick={() => detect()}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              Détecter
            </Button>
          </div>

          {/* Résultats */}
          {result && (
            <div className="space-y-2">
              {(result.kind === 'org' || result.kind === 'search') && (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {result.kind === 'org'
                    ? `Modèles de ${result.query} (${result.models?.length ?? 0})`
                    : `Propositions pour « ${result.query} » (${result.models?.length ?? 0})`}
                </p>
              )}
              {(result.kind === 'org' || result.kind === 'search') &&
                (result.models?.length ? (
                  <ul className="space-y-1.5">
                    {result.models.map((c) => (
                      <CandidateRow
                        key={c.id}
                        c={c}
                        caps={capsFor(c)}
                        selected={cfg?.selected === c.id}
                        onSelect={useCandidate}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-dashed p-2.5 text-[11px] text-muted-foreground">
                    Aucun modèle public répertorié pour « {result.query} ».
                  </p>
                ))}

              {(result.kind === 'model' || result.kind === 'dataset') && result.model && (
                <div className="rounded-lg border p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    {result.kind === 'dataset' ? (
                      <Database className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                    ) : (
                      <Cuboid className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    )}
                    <span className="truncate">{result.model.id}</span>
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {result.model.task}
                    {fmtDl(result.model.downloads)}
                  </p>
                  {result.kind === 'dataset' && (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                      Un dataset ne peut pas être exécuté comme modèle : téléchargez ses fichiers ou importez un modèle.
                    </p>
                  )}
                  <RepoFiles
                    repoId={result.model.id}
                    kind={result.kind}
                    dirs={result.model.dirs ?? []}
                    files={result.model.files ?? []}
                    loadingDir={loading}
                    onInstallLocal={installLocal}
                    busyFile={localBusy?.startsWith('dl:') ? localBusy.slice(3) : null}
                    onOpenDir={(d) => {
                      const base = (result.model?.id ?? link).trim()
                      void detect(base, d)
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {!result && !cfg && (
            <p className="rounded-lg border border-dashed p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Exemples : <span className="font-mono">Qwen/Qwen2.5-Omni-7B</span> (modèle précis),{' '}
              <span className="font-mono">huggingface.co/deepseek-ai</span> (toute l’organisation),{' '}
              <span className="font-mono">Wan2.2</span> (recherche). {hfModels.length > 0 && `${hfModels.length} modèle(s) déjà dans la bibliothèque.`}
            </p>
          )}

          {/* Catalogue du projet : modèles branchés (llama.cpp + pipelines locaux) */}
          <CatalogSection mode={isGlobal ? undefined : mode} onInstallGguf={installCatalogGguf} busy={localBusy} />

          {/* Moteur local : runtime, disque, modèles installés */}
          <LocalModelsSection
            local={local}
            busy={localBusy}
            onSetupRuntime={setupRuntime}
            onStart={startLocal}
            onStop={stopLocal}
            onRemove={removeLocal}
          />
        </div>

        <div className="border-t bg-muted/40 px-3 py-2">
          <p className="text-[10px] leading-snug text-muted-foreground">
            <strong>Chaîne de repli :</strong> modèle local (CPU) → modèle du bloc → lien général → clés API (Mistral,
            Agnes…) → moteur Lumo. En cas de quota épuisé ou d'absence de réseau, le relais s'active automatiquement et
            la note s'affiche sous la réponse.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
