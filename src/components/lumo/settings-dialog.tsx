'use client'

/**
 * Paramètres Lumo : apparence, clés API (Mistral, Agnes AI, OpenAI, OpenRouter,
 * Groq, Hugging Face, endpoint local), agents auto-apprenants, données locales.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  apiClearMemory,
  apiDeleteKey,
  apiListKeys,
  apiListMemory,
  apiSaveKey,
  type ApiKeyRow,
  type MemoryRow,
} from '@/lib/lumo/api'
import { clearArtifactStore } from '@/lib/lumo/artifact-store'
import {
  BadgeCheck,
  Brain,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useHydrated } from '@/hooks/use-hydrated'

const KEY_PROVIDERS = [
  { value: 'mistral', label: 'Mistral AI', hint: 'clé depuis console.mistral.ai' },
  { value: 'agnes', label: 'Agnes AI', hint: 'clé depuis platform.agnes-ai.com' },
  { value: 'openai', label: 'OpenAI', hint: 'clé depuis platform.openai.com' },
  { value: 'openrouter', label: 'OpenRouter', hint: 'clé multi-modèles' },
  { value: 'groq', label: 'Groq', hint: 'clé depuis console.groq.com' },
  { value: 'huggingface', label: 'Hugging Face', hint: 'token depuis hf.co/settings/tokens' },
  { value: 'custom', label: 'Endpoint personnalisé', hint: 'llama.cpp, LM Studio, Ollama… (.gguf)' },
]

const SUCCESS_TOAST = 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'

function ApiKeysSection() {
  const { toast } = useToast()
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [provider, setProvider] = useState('mistral')
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setKeys(await apiListKeys())
    } catch {
      /* silencieux */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const r = await apiSaveKey(provider, key, provider === 'custom' ? baseUrl : undefined)
      /* ✅ Popup de réussite — couleur verte */
      toast({
        title: 'Clé validée et sauvegardée ✅',
        description: r.detail,
        className: SUCCESS_TOAST,
      })
      setKey('')
      setBaseUrl('')
      await refresh()
    } catch (e) {
      /* ❌ Popup d’échec — couleur rouge */
      toast({
        title: 'Clé incorrecte ❌',
        description: e instanceof Error ? e.message : 'La clé a été refusée.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await apiDeleteKey(id)
      await refresh()
      toast({ title: 'Clé supprimée' })
    } catch (e) {
      toast({
        title: 'Suppression impossible',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      })
    }
  }

  const isCustom = provider === 'custom'

  return (
    <div>
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="h-4 w-4 text-primary" /> Vos clés API
      </Label>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Utilisez vos propres modèles quand Lumo Core est indisponible. Les clés sont validées en direct
        auprès du fournisseur, puis stockées uniquement sur votre machine.
      </p>

      <div className="mt-2.5 space-y-2">
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger size="sm" className="h-9 text-xs" aria-label="Fournisseur">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KEY_PROVIDERS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="text-xs">
                {p.label} — <span className="text-muted-foreground">{p.hint}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isCustom && (
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:8080/v1 (llama.cpp, LM Studio…)"
            className="h-9 text-xs"
            aria-label="URL de base de l’endpoint"
          />
        )}

        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              type={showKey ? 'text' : 'password'}
              placeholder="Collez votre clé API…"
              className="h-9 pr-9 text-xs"
              aria-label="Clé API"
              onKeyDown={(e) => e.key === 'Enter' && key.trim() && save()}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? 'Masquer la clé' : 'Afficher la clé'}
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Button size="sm" className="h-9 gap-1 text-xs" disabled={saving || key.trim().length < 8} onClick={save}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}
            Valider
          </Button>
        </div>
      </div>

      {/* Clés enregistrées */}
      <div className="mt-3 space-y-1.5">
        {loading ? (
          <p className="py-1 text-xs text-muted-foreground">Chargement…</p>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
            Aucune clé enregistrée — Lumo Core reste votre moteur principal.
          </p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5">
              {k.status === 'valid' ? (
                <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Clé validée" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Clé invalide" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">
                <span className="font-medium">{k.name}</span>{' '}
                <span className="font-mono text-[11px] text-muted-foreground">{k.maskedKey}</span>
              </span>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  k.status === 'valid'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {k.status === 'valid' ? 'Validée' : 'Invalide'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Supprimer la clé ${k.name}`}
                onClick={() => remove(k.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function MemorySection() {
  const { toast } = useToast()
  const [count, setCount] = useState(0)
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const r = await apiListMemory()
      setCount(r.count)
      setMemories(r.memories.slice(0, 8))
    } catch {
      /* silencieux */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function purge() {
    try {
      await apiClearMemory()
      await refresh()
      toast({ title: 'Mémoire effacée', description: 'Les agents repartent de zéro.' })
    } catch {
      toast({ title: 'Purge impossible', variant: 'destructive' })
    }
  }

  return (
    <div>
      <Label className="flex items-center gap-1.5 text-sm font-medium">
        <Brain className="h-4 w-4 text-primary" /> Agents auto-apprenants
      </Label>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Lumo mémorise vos préférences, vos retours (👍/👎) et ce que vous lui confiez
        (« retiens que… », « je préfère… »), puis s’en sert pour mieux répondre.
      </p>
      <div className="mt-2 rounded-lg border bg-card px-3 py-2 text-xs">
        <span className="font-semibold text-foreground">{count}</span> apprentissage(s) en mémoire
        {loading && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
      </div>
      {memories.length > 0 && (
        <ScrollArea className="mt-1.5 max-h-28 rounded-lg border border-dashed px-3 py-1.5">
          <ul className="space-y-1">
            {memories.map((m) => (
              <li key={m.id} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold uppercase ${
                    m.kind === 'fact'
                      ? 'bg-primary/10 text-primary'
                      : m.kind === 'feedback'
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-secondary text-secondary-foreground'
                  }`}
                >
                  {m.kind}
                </span>
                <span className="min-w-0 flex-1">{m.content}</span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
      {count > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="mt-1.5 h-7 gap-1 text-xs text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3 w-3" /> Effacer la mémoire
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Effacer toute la mémoire ?</AlertDialogTitle>
              <AlertDialogDescription>
                Les agents Lumo oublieront les préférences et apprentissages accumulés. Vos sessions ne sont pas touchées.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction onClick={purge}>Effacer</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

export function SettingsDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { theme, setTheme } = useTheme()
  const mounted = useHydrated()

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label="Paramètres">
            <Settings className="h-4.5 w-4.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Paramètres</DialogTitle>
          <DialogDescription>
            Lumo v0.2 — studio multimodal local. Sessions, clés et mémoire restent sur votre machine.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1 scrollbar-thin">
          <div>
            <Label className="text-sm font-medium">Apparence</Label>
            <RadioGroup
              value={mounted ? theme : 'light'}
              onValueChange={setTheme}
              className="mt-2 grid grid-cols-3 gap-2"
            >
              {[
                { value: 'light', label: 'Clair' },
                { value: 'dark', label: 'Sombre' },
                { value: 'system', label: 'Système' },
              ].map((opt) => (
                <Label
                  key={opt.value}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-accent has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent"
                >
                  <RadioGroupItem value={opt.value} className="sr-only" />
                  {opt.label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <Separator />
          <ApiKeysSection />

          <Separator />
          <MemorySection />

          <Separator />

          <div>
            <Label className="text-sm font-medium">Données locales</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Supprime toutes les sessions, modèles importés et artefacts stockés sur cet appareil.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="mt-2">
                  Réinitialiser toutes les données
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Tout réinitialiser ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cette action supprime définitivement vos sessions et artefacts locaux. Pensez à exporter
                    vos travaux importants en .zip avant de continuer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        localStorage.removeItem('lumo-store-v1')
                        await clearArtifactStore()
                      } finally {
                        window.location.reload()
                      }
                    }}
                  >
                    Réinitialiser
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
