'use client'

/**
 * Paramètre « Lien Hugging Face » d'un bloc (ou lien général de Lumo).
 *
 * - Collez un lien : dépôt précis (Qwen/Qwen2.5-Omni-7B), organisation complète
 *   (huggingface.co/deepseek-ai → tous ses modèles) ou simple nom à rechercher.
 * - Les modèles détectés sont listés pour être CHARGÉS puis UTILISÉS dans ce bloc,
 *   indépendamment du lien HF général (qui reste actif comme une connexion API).
 * - Chaîne de repli à la génération : modèle du bloc → lien général → clés API → Lumo Core.
 */

import { useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Cuboid,
  Database,
  Folder,
  Link2,
  Loader2,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import { apiHfDetect } from '@/lib/lumo/api'
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
}: {
  repoId: string
  kind: string
  dirs: string[]
  files: { path: string; size: number; ext: string }[]
  onOpenDir: (dir: string) => void
  loadingDir: boolean
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

  const capsFor = (c: HfCandidate) => hfTaskToCaps(c.task, c.id).filter((x) => (capability ? x === capability : true))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="sm"
            className={`h-8 max-w-48 gap-1.5 text-xs ${cfg?.selected ? 'border-primary/50 text-primary' : ''}`}
            aria-label={`${label} : ${cfg?.selected ? `actif (${cfg.selected})` : 'non configuré'}. Configurer le lien Hugging Face.`}
          >
            {cfg?.kind === 'dataset' ? (
              <Database className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
            ) : (
              <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="truncate">
              {isGlobal ? 'HF général' : `HF · ${mode ? MODE_INFO[mode].label : ''}`}
              {cfg?.selected ? ` : ${cfg.selected.split('/').pop()}` : ''}
            </span>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg?.selected ? 'bg-emerald-500' : cfg ? 'bg-amber-500' : 'bg-muted-foreground/40'}`}
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

        <div className="max-h-[26rem] space-y-3 overflow-y-auto p-3 scrollbar-thin">
          {/* Lien actif */}
          {cfg && (
            <div className="rounded-lg border bg-primary/5 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                    <span className="truncate">{cfg.selected ?? cfg.repoId ?? cfg.link}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {isGlobal ? 'relais général' : 'prioritaire dans ce bloc'} · {cfg.kind}
                    {cfg.selected ? '' : ' — aucun modèle actif'}
                  </p>
                  {cfg.status && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{cfg.status}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {cfg.selected && (
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
        </div>

        <div className="border-t bg-muted/40 px-3 py-2">
          <p className="text-[10px] leading-snug text-muted-foreground">
            <strong>Chaîne de repli :</strong> modèle du bloc → lien général → clés API (Mistral, Agnes…) → moteur Lumo.
            En cas de quota épuisé, le relais s'active automatiquement et la note s'affiche sous la réponse.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
