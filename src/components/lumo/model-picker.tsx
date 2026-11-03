'use client'

/**
 * Sélecteur de modèles + Hub de modèles (import Hugging Face par lien).
 * La couche « Provider » abstraite du cahier des charges : le choix est
 * enregistré par session et par capacité (texte / image / vidéo / audio).
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { apiHfLookup } from '@/lib/lumo/api'
import {
  BUILTIN_PROVIDERS,
  getProvider,
  hfTaskToCaps,
  providersFor,
  type Capability,
  type ProviderInfo,
} from '@/lib/lumo/providers'
import { useLumo } from '@/lib/lumo/store'
import { MODE_INFO, type Mode, type Session } from '@/lib/lumo/types'
import { Check, ChevronDown, Cuboid, Import, Loader2, Trash2 } from 'lucide-react'

const CAP_LABEL: Record<Capability, string> = {
  text: 'Texte',
  image: 'Image',
  video: 'Vidéo',
  audio: 'Audio',
}

export function CapBadges({ caps, className = '' }: { caps: Capability[]; className?: string }) {
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
  const { toast } = useToast()
  const [link, setLink] = useState('')
  const [loading, setLoading] = useState(false)

  async function importModel() {
    const value = link.trim()
    if (!value) return
    setLoading(true)
    try {
      const model = await apiHfLookup(value)
      addHfModel(model)
      setLink('')
      toast({
        title: 'Modèle importé',
        description: `${model.id} reconnu (${model.task}${model.source === 'api' ? ', via le Hub' : ', heuristique'}).`,
      })
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
            Collez le lien d’un modèle Hugging Face : Lumo le reconnaît, l’ajoute à votre bibliothèque et le rend
            sélectionnable selon sa tâche.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importModel()}
            placeholder="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0"
            aria-label="Lien du modèle Hugging Face"
          />
          <Button onClick={importModel} disabled={loading || !link.trim()} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Import className="h-4 w-4" />}
            Importer
          </Button>
        </div>

        <div className="max-h-80 space-y-4 overflow-y-auto pr-1 scrollbar-thin">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fournisseurs intégrés
            </p>
            {BUILTIN_PROVIDERS.map((p) => (
              <ProviderRow key={p.id} p={p} />
            ))}
          </div>

          {hfModels.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Modèles importés ({hfModels.length})
              </p>
              {hfModels.map((m) => (
                <ProviderRow
                  key={m.id}
                  p={{
                    id: `hf:${m.id}`,
                    name: m.id.split('/').pop() || m.id,
                    vendor: m.id.split('/')[0] || 'HF',
                    caps: hfTaskToCaps(m.task),
                    description: `Modèle HF · ${m.task}`,
                    kind: 'hf',
                  }}
                  onRemove={() => {
                    removeHfModel(m.id)
                    toast({ title: 'Modèle retiré', description: m.id })
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- */
/* Sélecteur (par session et capacité)                               */
/* ---------------------------------------------------------------- */

export function ModelPicker({ session }: { session: Session }) {
  const hfModels = useLumo((s) => s.hfModels)
  const setSessionModel = useLumo((s) => s.setSessionModel)
  const [hubOpen, setHubOpen] = useState(false)

  const capability = MODE_INFO[session.mode].capability
  const current = getProvider(hfModels, session.models[capability]) ?? providersFor(hfModels, capability)[0]
  const options = providersFor(hfModels, capability)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 max-w-44 gap-1.5 text-xs"
            aria-label={`Modèle actif : ${current?.name ?? 'aucun'}. Changer de modèle.`}
          >
            <Cuboid className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span className="truncate">{current?.name ?? 'Modèle'}</span>
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>
            Modèles {CAP_LABEL[capability].toLowerCase()} — {MODE_INFO[session.mode].label}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => setSessionModel(session.id, capability, p.id)}
              className="gap-2"
            >
              <Check
                className={`h-3.5 w-3.5 ${p.id === current?.id ? 'opacity-100' : 'opacity-0'}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.description}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setHubOpen(true) }}>
            <Import className="h-3.5 w-3.5" />
            Importer depuis Hugging Face…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ModelHubDialog open={hubOpen} onOpenChange={setHubOpen} />
    </>
  )
}
