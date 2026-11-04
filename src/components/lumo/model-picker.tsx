'use client'

/**
 * Sélecteur de modèles multi-capacités + Hub de modèles Hugging Face.
 * - Chaque capacité (Texte / Image / Vidéo / Audio) garde SON modèle :
 *   vous pouvez charger plusieurs modèles pour un usage groupé
 *   (ex. Qwen pour le texte + Wan 2 pour la vidéo + LTX pour la vidéo).
 * - Import par lien HF : détection des fichiers .safetensors / .gguf / .tar / .json,
 *   branchement au projet ou téléchargement direct. Les datasets sont reconnus.
 */

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Cuboid,
  Database,
  Download,
  Import,
  Link2,
  Loader2,
  Plug,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import { apiHfLookup, hfResolveUrl } from '@/lib/lumo/api'
import {
  BUILTIN_PROVIDERS,
  hfTaskToCaps,
  providersFor,
  type Capability,
  type ProviderInfo,
} from '@/lib/lumo/providers'
import { useLumo } from '@/lib/lumo/store'
import { MODE_INFO, type HfModel, type ModelSelection, type Mode, type Session } from '@/lib/lumo/types'

const CAPS: Capability[] = ['text', 'image', 'video', 'audio']
const CAP_LABEL: Record<Capability, string> = {
  text: 'Texte',
  image: 'Image',
  video: 'Vidéo',
  audio: 'Audio',
}

function fmtSize(n: number): string {
  if (!n) return 'taille inconnue'
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} Go`
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} Mo`
  return `${Math.max(1, Math.round(n / 1024))} Ko`
}

export function CapBadges({ caps, className = '' }: { caps: Capability[]; className?: string }) {
  if (caps.length === 0) return null
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {caps.map((c) => (
        <span
          key={c}
          className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
        >
          {CAP_LABEL[c]}
        </span>
      ))}
    </span>
  )
}

/* ---------------------------------------------------------------- */
/* Hub de modèles                                                    */
/* ---------------------------------------------------------------- */

function providerIdFor(m: HfModel, file?: string): string {
  return `hf:${m.id}${file ? `::${file}` : ''}`
}

function FileRow({
  m,
  path,
  size,
  onConnect,
  busy,
}: {
  m: HfModel
  path: string
  size: number
  onConnect: (file: string) => void
  busy: boolean
}) {
  const isDataset = m.kind === 'dataset'
  const weight = /\.(safetensors|gguf|onnx|bin|pth|ckpt|tar|tar\.gz|tgz)$/i.test(path)
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium font-mono">{path.split('/').pop()}</span>
        <span className="text-[10px] text-muted-foreground">
          {weight ? 'poids du modèle · ' : 'configuration · '}
          {fmtSize(size)}
        </span>
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 gap-1 text-[11px]"
        disabled={busy || isDataset}
        title={isDataset ? 'Un dataset ne peut pas être branché comme modèle' : 'Connecter ce fichier au projet'}
        onClick={() => onConnect(path)}
      >
        <Plug className="h-3 w-3" /> Connecter
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0 gap-1 text-[11px]"
        onClick={() => {
          window.open(hfResolveUrl(m.id, path, m.kind), '_blank', 'noopener')
        }}
        title="Télécharger ce fichier depuis Hugging Face"
      >
        <Download className="h-3 w-3" /> Télécharger
      </Button>
    </li>
  )
}

export function ModelHubDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open?: boolean
  onOpenChange?: (v: boolean) => void
  trigger?: React.ReactNode
}) {
  const hfModels = useLumo((s) => s.hfModels)
  const addHfModel = useLumo((s) => s.addHfModel)
  const removeHfModel = useLumo((s) => s.removeHfModel)
  const activeId = useLumo((s) => s.activeId)
  const sessions = useLumo((s) => s.sessions)
  const setSessionModel = useLumo((s) => s.setSessionModel)
  const { toast } = useToast()
  const [link, setLink] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyFile, setBusyFile] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  /** Connecte un modèle (et un fichier précis) à la bibliothèque + à la session active */
  function connect(m: HfModel, file?: string) {
    const model: HfModel = { ...m, file, sizeBytes: file ? (m.files?.find((f) => f.path === file)?.size ?? m.sizeBytes) : m.sizeBytes }
    addHfModel(model)
    // Si une session est ouverte, on assigne automatiquement selon sa capacité
    const session = sessions.find((s) => s.id === activeId)
    if (session) {
      const caps = hfTaskToCaps(model.task, model.id)
      const sessionCap = MODE_INFO[session.mode].capability
      const cap = caps.includes(sessionCap) ? sessionCap : caps[0]
      if (cap) {
        setSessionModel(session.id, cap, providerIdFor(model, file))
        toast({
          title: 'Modèle connecté au projet',
          description: `${model.id}${file ? ` · ${file.split('/').pop()}` : ''} → capacité ${CAP_LABEL[cap]}.`,
        })
        return
      }
    }
    toast({
      title: 'Modèle ajouté à la bibliothèque',
      description: `${model.id}${file ? ` · ${file.split('/').pop()}` : ''} — sélectionnez-le dans le sélecteur.`,
    })
  }

  async function importModel() {
    const value = link.trim()
    if (!value) return
    setLoading(true)
    try {
      const model = await apiHfLookup(value)
      addHfModel(model)
      setLink('')
      const nFiles = model.files?.length ?? 0
      toast({
        title: model.kind === 'dataset' ? 'Jeu de données reconnu' : 'Modèle reconnu',
        description:
          `${model.id} (${model.task}${model.source === 'api' ? ', via le Hub' : ', heuristique'})` +
          (nFiles ? ` — ${nFiles} fichier(s) détecté(s)` : ''),
      })
      setExpanded(model.id)
    } catch (e) {
      toast({
        title: 'Import impossible',
        description: e instanceof Error ? e.message : 'Vérifiez le lien du modèle.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Hub de modèles</DialogTitle>
          <DialogDescription>
            Collez un lien Hugging Face : Lumo détecte les fichiers (.safetensors, .gguf, .tar, .json), puis vous
            choisissez de <strong>connecter</strong> un modèle au projet ou de le <strong>télécharger</strong>. Plusieurs
            modèles peuvent cohabiter — un par capacité (texte, image, vidéo, audio).
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importModel()}
            placeholder="https://huggingface.co/Qwen/Qwen2.5-Omni-7B (ou lien dataset)"
            aria-label="Lien du modèle Hugging Face"
          />
          <Button onClick={importModel} disabled={loading || !link.trim()} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Import className="h-4 w-4" />}
            Détecter
          </Button>
        </div>

        <div className="max-h-96 space-y-4 overflow-y-auto pr-1 scrollbar-thin">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Modèles importés ({hfModels.length})
            </p>
            {hfModels.length === 0 && (
              <p className="rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
                Aucun modèle importé pour l’instant. Exemples : Qwen/Qwen2.5-Omni-7B (texte + image), Wan-AI/Wan2.2-T2V-A14B
                (vidéo), LTX-Video (vidéo), stabilityai/sdxl (image), openai/whisper (audio).
              </p>
            )}
            {hfModels.map((m) => (
              <div key={`${m.id}::${m.file ?? ''}`} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {m.kind === 'dataset' ? (
                      <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                      <Cuboid className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.id.split('/').pop()}
                        {m.file ? <span className="ml-1 font-mono text-xs text-muted-foreground">{m.file.split('/').pop()}</span> : null}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{m.id.split('/')[0]}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.kind === 'dataset' ? 'Jeu de données — consultation / téléchargement uniquement' : `Modèle HF · ${m.task}`}
                        {m.sizeBytes ? ` · ${fmtSize(m.sizeBytes)}` : ''}
                      </p>
                      <CapBadges caps={m.kind === 'dataset' ? [] : hfTaskToCaps(m.task, m.id)} className="mt-1" />
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      aria-label="Afficher les fichiers détectés"
                      onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Retirer ${m.id}`}
                      onClick={() => removeHfModel(m.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {m.kind === 'dataset' && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    Un dataset n’est pas exécutable comme modèle : téléchargez ses fichiers ou importez un modèle.
                  </p>
                )}

                {expanded === m.id && (
                  <div className="mt-2.5">
                    {m.files && m.files.length > 0 ? (
                      <ul className="space-y-1.5">
                        {m.files.map((f) => (
                          <FileRow
                            key={f.path}
                            m={m}
                            path={f.path}
                            size={f.size}
                            busy={busyFile}
                            onConnect={(file) => connect(m, file)}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Aucun fichier de poids détecté à la racine (ou Hub injoignable). Utilisez « Détecter » à nouveau
                        pour rafraîchir.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fournisseurs intégrés
            </p>
            {BUILTIN_PROVIDERS.map((p) => (
              <ProviderRow key={p.id} p={p} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProviderRow({ p, onRemove }: { p: ProviderInfo; onRemove?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Cuboid className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {p.name}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">{p.vendor}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{p.description}</p>
          <CapBadges caps={p.caps} className="mt-1" />
        </div>
      </div>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Retirer ${p.name}`}
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Sélecteur multi-capacités (usage groupé)                          */
/* ---------------------------------------------------------------- */

export function ModelPicker({ session }: { session: Session }) {
  const hfModels = useLumo((s) => s.hfModels)
  const setSessionModel = useLumo((s) => s.setSessionModel)
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [hubOpen, setHubOpen] = useState(false)
  const sessionCap = MODE_INFO[session.mode].capability
  const [tab, setTab] = useState<Capability>(sessionCap)

  const current = useMemo(() => session.models[tab], [session.models, tab])
  const options = useMemo(() => providersFor(hfModels, tab), [hfModels, tab])
  const activeProvider = options.find((p) => p.id === current)
  const usedCount = CAPS.filter((c) => !!session.models[c as keyof ModelSelection]).length

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-w-44 gap-1.5 text-xs"
            aria-label={`Modèle ${CAP_LABEL[sessionCap]} : ${activeProvider?.name ?? 'aucun'}. Changer de modèle.`}
          >
            <Cuboid className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className="truncate">{activeProvider?.name ?? 'Modèle'}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b px-3 py-2">
            <p className="text-xs font-semibold">Modèles de la session</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {usedCount} capacité(s) dotée(s) d’un modèle — usage groupé activé.
            </p>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Capability)} className="w-full">
            <div className="px-2 pt-2">
              <TabsList className="w-full">
                {CAPS.map((c) => (
                  <TabsTrigger key={c} value={c} className="flex-1 gap-0.5 px-1 text-[11px]">
                    {CAP_LABEL[c]}
                    <Check
                      className={`h-2.5 w-2.5 ${session.models[c] ? 'opacity-100 text-emerald-500' : 'opacity-0'}`}
                      aria-hidden="true"
                    />
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 scrollbar-thin">
              {options.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  Aucun modèle {CAP_LABEL[tab].toLowerCase()} disponible — importez-en un depuis Hugging Face.
                </p>
              )}
              {options.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSessionModel(session.id, tab, p.id)
                    toast({
                      title: `${CAP_LABEL[tab]} → ${p.name}`,
                      description: 'Chaque capacité garde son propre modèle : les autres restent actifs.',
                    })
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    p.id === current ? 'bg-primary/10' : 'hover:bg-accent'
                  }`}
                  aria-pressed={p.id === current}
                >
                  <Check
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${p.id === current ? 'text-primary opacity-100' : 'opacity-0'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{p.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{p.description}</span>
                    <CapBadges caps={p.caps} className="mt-1" />
                  </span>
                </button>
              ))}
            </div>
          </Tabs>
          <div className="border-t p-2">
            <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={() => setHubOpen(true)}>
              <Import className="h-3.5 w-3.5" /> Importer depuis Hugging Face…
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <ModelHubDialog open={hubOpen} onOpenChange={setHubOpen} />
    </>
  )
}
