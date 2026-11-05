'use client'

/**
 * Studio App Design — éditeur WYSIWYG de Lumo :
 * écrans → éléments → propriétés, palette, assistant de conception à chaque
 * étape, et export de code : HTML, React, FlutterFlow (Dart + JSON).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  ImageIcon,
  LayoutDashboard,
  Loader2,
  Monitor,
  Palette,
  Plus,
  SendHorizontal,
  Smartphone,
  Sparkles,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { apiChat } from '@/lib/lumo/api'
import {
  DEFAULT_PALETTE,
  EL_CATALOG,
  coerceDoc,
  elLabel,
  emptyDoc,
  generateFlutterFlow,
  generateHtml,
  generateReact,
  makeEl,
  uid,
  type DesignDoc,
  type DesignEl,
  type DesignScreen,
  type ElType,
} from '@/lib/lumo/codegen'
import { downloadText } from '@/lib/lumo/export'
import { apiImage } from '@/lib/lumo/api'
import { ICON_LIBRARY, PHOTO_LIBRARY, illustrationUrl, photoUrl } from '@/lib/lumo/visuals'
import { useLumo } from '@/lib/lumo/store'
import type { Artifact } from '@/lib/lumo/types'

/* ------------------------------------------------------------------ */
/* Config des propriétés par type d’élément                            */
/* ------------------------------------------------------------------ */

interface FieldDef {
  key: string
  label: string
  multiline?: boolean
  options?: string[]
}

const PROPERTY_FIELDS: Record<ElType, FieldDef[]> = {
  navbar: [
    { key: 'text', label: 'Nom de la marque' },
    { key: 'links', label: 'Liens (séparés par des virgules)' },
  ],
  hero: [
    { key: 'title', label: 'Titre' },
    { key: 'subtitle', label: 'Sous-titre', multiline: true },
    { key: 'cta', label: 'Texte du bouton' },
  ],
  text: [
    { key: 'text', label: 'Contenu', multiline: true },
    { key: 'size', label: 'Taille', options: ['sm', 'md', 'lg'] },
  ],
  button: [
    { key: 'text', label: 'Libellé' },
    { key: 'variant', label: 'Variante', options: ['primary', 'outline'] },
  ],
  input: [
    { key: 'label', label: 'Étiquette' },
    { key: 'placeholder', label: 'Texte indicatif' },
  ],
  image: [{ key: 'alt', label: 'Description de l’image' }],
  list: [{ key: 'items', label: 'Points (un par ligne)', multiline: true }],
  card: [
    { key: 'title', label: 'Titre de la carte' },
    { key: 'text', label: 'Contenu', multiline: true },
  ],
  badge: [{ key: 'text', label: 'Texte de l’étiquette' }],
  divider: [],
  footer: [{ key: 'text', label: 'Texte du pied de page' }],
}

/* ------------------------------------------------------------------ */
/* Carte dans le fil de conversation                                   */
/* ------------------------------------------------------------------ */

export function DesignCard({ a, onOpen }: { a: Artifact; onOpen: () => void }) {
  const screens = String(a.meta?.screens ?? '?')
  const elements = String(a.meta?.elements ?? '?')
  const appName = String(a.meta?.appName ?? 'maquette')
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
      aria-label={`Ouvrir le studio visuel de ${appName}`}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <LayoutDashboard className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{appName}</span>
        <span className="text-[11px] text-muted-foreground">
          Maquette WYSIWYG · {screens} écran(s) · {elements} éléments — cliquez pour éditer et exporter le code
        </span>
      </span>
      <SquarePen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Rendu WYSIWYG d’un élément                                          */
/* ------------------------------------------------------------------ */

function ElView({ el, palette, selected, onSelect }: { el: DesignEl; palette: DesignDoc['palette']; selected: boolean; onSelect: () => void }) {
  const p = el.props
  const ring = selected ? 'outline-2 outline-offset-2 outline-primary' : 'hover:outline-2 hover:outline-offset-2 hover:outline-primary/40'
  const common = `cursor-pointer transition-all ${ring}`
  switch (el.type) {
    case 'navbar':
      return (
        <header onClick={onSelect} className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 shadow-sm ${common}`} role="presentation">
          <span className="font-bold" style={{ color: palette.primary }}>{p.text || 'Mon app'}</span>
          <span className="flex flex-wrap gap-3 text-xs opacity-75">
            {(p.links ?? '').split(/[,\n]/).map((l) => l.trim()).filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}
          </span>
        </header>
      )
    case 'hero':
      return (
        <section onClick={onSelect} className={`flex flex-col items-center gap-2 rounded-2xl bg-white p-6 text-center shadow-sm sm:p-9 ${common}`} role="presentation">
          <h3 className="text-xl font-bold sm:text-2xl" style={{ color: palette.text }}>{p.title}</h3>
          <p className="max-w-md text-xs opacity-70 sm:text-sm">{p.subtitle}</p>
          <span className="rounded-full px-5 py-2 text-xs font-semibold text-white" style={{ background: palette.primary }}>{p.cta}</span>
        </section>
      )
    case 'text':
      return (
        <p
          onClick={onSelect}
          className={`px-1 opacity-90 ${common} ${p.size === 'lg' ? 'text-base font-medium sm:text-lg' : p.size === 'sm' ? 'text-[11px]' : 'text-xs sm:text-sm'}`}
          role="presentation"
        >
          {p.text}
        </p>
      )
    case 'button':
      return (
        <p className="px-1" role="presentation">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:text-sm ${common} ${
              p.variant === 'outline' ? 'border-2 bg-transparent' : 'text-white'
            }`}
            style={p.variant === 'outline' ? { borderColor: palette.primary, color: palette.primary } : { background: palette.primary }}
          >
            {p.text}
          </button>
        </p>
      )
    case 'input':
      return (
        <label onClick={onSelect} className={`flex cursor-pointer flex-col gap-1 rounded-xl bg-white/60 px-1 py-1 text-[11px] ${common}`} role="presentation">
          <span className="opacity-70">{p.label}</span>
          <span className="rounded-lg border border-black/15 bg-white px-3 py-2 text-muted-foreground">{p.placeholder}</span>
        </label>
      )
    case 'image': {
      const src = p.src ?? ''
      if (src.startsWith('icon:')) {
        const iconName = src.slice(5)
        const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[iconName]
        return (
          <div
            onClick={onSelect}
            className={`grid min-h-24 place-items-center rounded-2xl sm:min-h-32 ${common}`}
            style={{ background: `color-mix(in srgb, ${palette.primary} 14%, white)` }}
            role="presentation"
          >
            {Icon ? (
              <Icon className="h-12 w-12" />
            ) : (
              <span className="text-2xl">⬟</span>
            )}
            <span className="sr-only">{p.alt || iconName}</span>
          </div>
        )
      }
      if (src && /^(https?:|data:)/.test(src)) {
        return (
          <div onClick={onSelect} className={`overflow-hidden rounded-2xl ${common}`} role="presentation">
            <img
              src={src}
              alt={p.alt || 'Illustration'}
              className="h-36 w-full object-cover sm:h-44"
              loading="lazy"
            />
          </div>
        )
      }
      return (
        <div
          onClick={onSelect}
          className={`grid min-h-24 place-items-center rounded-2xl text-xs opacity-80 sm:min-h-32 ${common}`}
          style={{ background: `color-mix(in srgb, ${palette.primary} 16%, white)` }}
          role="presentation"
        >
          🖼 {p.alt || 'Image — choisissez-en une dans les propriétés'}
        </div>
      )
    }
    case 'list':
      return (
        <ul onClick={onSelect} className={`list-disc space-y-1 rounded-2xl bg-white p-4 pl-8 text-xs shadow-sm sm:text-sm ${common}`} role="presentation">
          {(p.items ?? '').split(/\n/).map((i) => i.trim()).filter(Boolean).map((i, k) => <li key={k}>{i}</li>)}
        </ul>
      )
    case 'card':
      return (
        <div onClick={onSelect} className={`rounded-2xl bg-white p-4 shadow-sm ${common}`} role="presentation">
          <p className="mb-1 text-sm font-semibold" style={{ color: palette.primary }}>{p.title}</p>
          <p className="text-xs opacity-75">{p.text}</p>
        </div>
      )
    case 'badge':
      return (
        <p className="px-1" role="presentation">
          <span onClick={onSelect} className={`inline-block cursor-pointer rounded-full px-3 py-1 text-[10px] font-semibold sm:text-xs ${common}`} style={{ background: `color-mix(in srgb, ${palette.primary} 18%, white)`, color: palette.primary }}>
            {p.text}
          </span>
        </p>
      )
    case 'divider':
      return <hr onClick={onSelect} className={`cursor-pointer border-black/10 ${common}`} role="presentation" />
    case 'footer':
      return (
        <p onClick={onSelect} className={`cursor-pointer pt-2 text-center text-[11px] opacity-60 ${common}`} role="presentation">
          {p.text}
        </p>
      )
    default:
      return null
  }
}

/* ------------------------------------------------------------------ */
/* Panneau Écrans + palette                                            */
/* ------------------------------------------------------------------ */

function ScreensPanel({
  doc,
  setDoc,
  activeScreenId,
  setActiveScreenId,
}: {
  doc: DesignDoc
  setDoc: (fn: (d: DesignDoc) => DesignDoc) => void
  activeScreenId: string
  setActiveScreenId: (id: string) => void
}) {
  const { toast } = useToast()
  function addScreen() {
    const s: DesignScreen = { id: uid(), name: `Écran ${doc.screens.length + 1}`, elements: [makeEl('text')] }
    setDoc((d) => ({ ...d, screens: [...d.screens, s] }))
    setActiveScreenId(s.id)
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Écrans ({doc.screens.length})</p>
      <ul className="space-y-1">
        {doc.screens.map((s) => (
          <li key={s.id} className="group flex items-center gap-1">
            <button
              onClick={() => setActiveScreenId(s.id)}
              className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                s.id === activeScreenId ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
              }`}
              aria-current={s.id === activeScreenId}
            >
              {s.name}
              <span className="ml-1 text-[10px] text-muted-foreground">({s.elements.length})</span>
            </button>
            <button
              onClick={() => {
                if (doc.screens.length <= 1) {
                  toast({ title: 'Au moins un écran est requis', variant: 'destructive' })
                  return
                }
                setDoc((d) => ({ ...d, screens: d.screens.filter((x) => x.id !== s.id) }))
              }}
              className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              aria-label={`Supprimer l’écran ${s.name}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" className="gap-1" onClick={addScreen}>
        <Plus className="h-3.5 w-3.5" /> Ajouter un écran
      </Button>

      <p className="mt-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Palette className="h-3 w-3" /> Palette
      </p>
      {(
        [
          ['primary', 'Principale'],
          ['bg', 'Fond'],
          ['text', 'Texte'],
          ['card', 'Cartes'],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="flex items-center justify-between gap-2 text-xs">
          <span>{label}</span>
          <input
            type="color"
            value={doc.palette[k]}
            onChange={(e) => setDoc((d) => ({ ...d, palette: { ...d.palette, [k]: e.target.value } }))}
            className="h-7 w-10 cursor-pointer rounded border bg-transparent"
            aria-label={`Couleur ${label}`}
          />
        </label>
      ))}
      <label className="flex items-center justify-between gap-2 text-xs">
        <span>App</span>
        <Input
          value={doc.appName}
          onChange={(e) => setDoc((d) => ({ ...d, appName: e.target.value.slice(0, 60) }))}
          className="h-7 w-36 text-xs"
          aria-label="Nom de l’application"
        />
      </label>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sélecteur d'images : icônes, photos, illustrations, upload, IA       */
/* ------------------------------------------------------------------ */

type ImgTab = 'icons' | 'photos' | 'illus' | 'upload' | 'ai'

function ImagePickerDialog({
  open,
  onOpenChange,
  onPick,
  elementAlt,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onPick: (src: string, label: string) => void
  elementAlt: string
}) {
  const { toast } = useToast()
  const [tab, setTab] = useState<ImgTab>('icons')
  const [customUrl, setCustomUrl] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function pick(src: string, label: string) {
    onPick(src, label)
    onOpenChange(false)
  }

  async function generateAi() {
    const q = aiPrompt.trim() || elementAlt || 'illustration moderne et colorée'
    setAiBusy(true)
    try {
      const r = await apiImage(q, '864x1152')
      pick(`data:${r.base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png'};base64,${r.base64}`, `IA : ${q.slice(0, 40)}`)
    } catch {
      toast({ title: 'Génération IA impossible', description: 'Réessayez — le service image met 30 à 60 s.', variant: 'destructive' })
    } finally {
      setAiBusy(false)
    }
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 2_000_000) {
      toast({ title: 'Image trop lourde', description: 'Maximum 2 Mo pour un import local.', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => pick(String(reader.result ?? ''), `Import : ${f.name}`)
    reader.readAsDataURL(f)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <ImageIcon className="h-4 w-4 text-primary" aria-hidden="true" /> Insérer une image
          </DialogTitle>
          <DialogDescription>
            Icônes, photos libres, illustrations, import local ou génération IA — embellissez votre maquette.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ImgTab)}>
          <TabsList className="w-full flex-wrap">
            <TabsTrigger value="icons" className="gap-1 text-xs">Icônes</TabsTrigger>
            <TabsTrigger value="photos" className="gap-1 text-xs">Photos</TabsTrigger>
            <TabsTrigger value="illus" className="gap-1 text-xs">Illustrations</TabsTrigger>
            <TabsTrigger value="upload" className="gap-1 text-xs">Import</TabsTrigger>
            <TabsTrigger value="ai" className="gap-1 text-xs">IA ✨</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="max-h-80 overflow-y-auto pr-1 scrollbar-thin">
          {tab === 'icons' && (
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {ICON_LIBRARY.map((ic) => {
                const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[ic.name]
                return (
                  <button
                    key={ic.name}
                    onClick={() => pick(`icon:${ic.name}`, `Icône : ${ic.label}`)}
                    className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border bg-card p-1 transition-colors hover:border-primary/50 hover:bg-accent"
                    title={ic.label}
                    aria-label={`Icône ${ic.label}`}
                  >
                    {Icon ? <Icon className="h-5 w-5 text-primary" aria-hidden="true" /> : <span className="text-lg">⬟</span>}
                    <span className="w-full truncate text-center text-[8px] leading-none text-muted-foreground">{ic.label}</span>
                  </button>
                )
              })}
            </div>
          )}

          {tab === 'photos' && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {PHOTO_LIBRARY.map((ph) => (
                  <button
                    key={ph.seed}
                    onClick={() => pick(photoUrl(ph.seed), `Photo : ${ph.label}`)}
                    className="group overflow-hidden rounded-lg border transition-colors hover:border-primary/50"
                    aria-label={`Photo ${ph.label}`}
                  >
                    <img src={photoUrl(ph.seed, 240, 168)} alt={ph.label} className="aspect-[10/7] w-full object-cover" loading="lazy" />
                    <span className="block truncate px-1 py-0.5 text-[9px] text-muted-foreground">{ph.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="…ou collez l’URL d’une image (https://…)"
                  aria-label="URL d’image personnalisée"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  className="h-8 shrink-0 text-xs"
                  disabled={!/^https?:\/\//.test(customUrl.trim())}
                  onClick={() => pick(customUrl.trim(), 'URL personnalisée')}
                >
                  Utiliser
                </Button>
              </div>
            </div>
          )}

          {tab === 'illus' && (
            <div className="grid grid-cols-3 gap-1.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  onClick={() => pick(illustrationUrl(i), `Illustration ${i + 1}`)}
                  className="overflow-hidden rounded-lg border transition-colors hover:border-primary/50"
                  aria-label={`Illustration ${i + 1}`}
                >
                  <img src={illustrationUrl(i)} alt={`Illustration ${i + 1}`} className="aspect-[3/2] w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}

          {tab === 'upload' && (
            <div className="grid place-items-center rounded-xl border border-dashed p-8 text-center">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUpload} aria-hidden="true" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Importez votre visuel</p>
                <p className="text-xs text-muted-foreground">PNG, JPG, WebP — 2 Mo max, conservé localement</p>
                <Button size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
                  <ImageIcon className="h-3.5 w-3.5" /> Choisir un fichier
                </Button>
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-2.5">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Générez un visuel unique avec l’IA image de Lumo (30 à 60 s). L’image est insérée dans la maquette.
              </p>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={`Décrivez l’image… (ex. : « bannière chaleureuse pour une boulangerie »)`}
                aria-label="Prompt de génération IA"
                rows={2}
                className="min-h-16 text-xs"
              />
              <Button size="sm" disabled={aiBusy} onClick={() => void generateAi()} className="gap-1.5">
                {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {aiBusy ? 'Génération…' : 'Générer avec l’IA'}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau Propriétés de l’élément sélectionné                         */
/* ------------------------------------------------------------------ */

function PropsPanel({
  doc,
  setDoc,
  activeScreenId,
  selected,
  setSelected,
}: {
  doc: DesignDoc
  setDoc: (fn: (d: DesignDoc) => DesignDoc) => void
  activeScreenId: string
  selected: DesignEl | null
  setSelected: (id: string | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const screen = doc.screens.find((s) => s.id === activeScreenId)
  function patchProp(key: string, value: string) {
    if (!selected || !screen) return
    setDoc((d) => ({
      ...d,
      screens: d.screens.map((s) =>
        s.id === screen.id
          ? {
              ...s,
              elements: s.elements.map((e) => (e.id === selected.id ? { ...e, props: { ...e.props, [key]: value } } : e)),
            }
          : s,
      ),
    }))
  }
  function move(dir: -1 | 1) {
    if (!selected || !screen) return
    const idx = screen.elements.findIndex((e) => e.id === selected.id)
    const to = idx + dir
    if (to < 0 || to >= screen.elements.length) return
    const els = [...screen.elements]
    ;[els[idx], els[to]] = [els[to], els[idx]]
    setDoc((d) => ({
      ...d,
      screens: d.screens.map((s) => (s.id === screen.id ? { ...s, elements: els } : s)),
    }))
  }
  function duplicate() {
    if (!selected || !screen) return
    setDoc((d) => ({
      ...d,
      screens: d.screens.map((s) =>
        s.id === screen.id ? { ...s, elements: [...s.elements, { ...selected, id: uid() }] } : s,
      ),
    }))
  }
  function remove() {
    if (!selected || !screen) return
    setDoc((d) => ({
      ...d,
      screens: d.screens.map((s) => (s.id === screen.id ? { ...s, elements: s.elements.filter((e) => e.id !== selected.id) } : s)),
    }))
    setSelected(null)
  }

  if (!selected) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-center text-xs leading-relaxed text-muted-foreground">
        Cliquez un élément de la maquette pour l’éditer, ou ajoutez-en un depuis le catalogue sous l’aperçu.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {elLabel(selected.type)}
        </p>
        <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground" aria-label="Désélectionner">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {selected.type === 'image' && (
        <div className="rounded-xl border bg-secondary/40 p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-foreground">Visuel de l’élément</p>
          <p className="mb-2 truncate text-[10px] text-muted-foreground">
            {selected.props.src
              ? selected.props.src.startsWith('icon:')
                ? `Icône : ${selected.props.src.slice(5)}`
                : selected.props.src.startsWith('data:')
                  ? 'Image locale (importée / IA)'
                  : 'Image distante (URL)'
              : 'Aucune image choisie'}
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 flex-1 gap-1 text-[11px]" onClick={() => setPickerOpen(true)}>
              <ImageIcon className="h-3 w-3" /> Choisir une image
            </Button>
            {selected.props.src && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 gap-1 text-[11px] text-muted-foreground"
                onClick={() => patchProp('src', '')}
                aria-label="Retirer l’image"
              >
                <X className="h-3 w-3" /> Retirer
              </Button>
            )}
          </div>
        </div>
      )}
      {PROPERTY_FIELDS[selected.type].map((f) =>
        f.options ? (
          <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0">{f.label}</span>
            <select
              value={selected.props[f.key] ?? f.options[0]}
              onChange={(e) => patchProp(f.key, e.target.value)}
              className="h-8 w-36 rounded-md border bg-background px-2 text-xs"
              aria-label={f.label}
            >
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
        ) : f.multiline ? (
          <label key={f.key} className="block space-y-1 text-xs">
            <span>{f.label}</span>
            <Textarea
              value={selected.props[f.key] ?? ''}
              onChange={(e) => patchProp(f.key, e.target.value)}
              className="min-h-16 text-xs"
              aria-label={f.label}
            />
          </label>
        ) : (
          <label key={f.key} className="block space-y-1 text-xs">
            <span>{f.label}</span>
            <Input
              value={selected.props[f.key] ?? ''}
              onChange={(e) => patchProp(f.key, e.target.value)}
              className="h-8 text-xs"
              aria-label={f.label}
            />
          </label>
        ),
      )}
      {PROPERTY_FIELDS[selected.type].length === 0 && (
        <p className="text-xs text-muted-foreground">Cet élément n’a pas de propriété.</p>
      )}
      <div className="flex flex-wrap gap-1.5 border-t pt-2.5">
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => move(-1)} aria-label="Monter l’élément">
          <ArrowUp className="h-3 w-3" /> Monter
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => move(1)} aria-label="Descendre l’élément">
          <ArrowDown className="h-3 w-3" /> Descendre
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={duplicate} aria-label="Dupliquer l’élément">
          <Plus className="h-3 w-3" /> Dupliquer
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px] text-destructive" onClick={remove} aria-label="Supprimer l’élément">
          <Trash2 className="h-3 w-3" /> Supprimer
        </Button>
      </div>
      <ImagePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        elementAlt={selected.props.alt ?? ''}
        onPick={(src) => patchProp('src', src)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Guide pas à pas (assistant à chacun des pas)                        */
/* ------------------------------------------------------------------ */

function nextStep(doc: DesignDoc): { title: string; hint: string } {
  const avgEls = doc.screens.reduce((n, s) => n + s.elements.length, 0) / Math.max(1, doc.screens.length)
  if (doc.screens.length < 2)
    return { title: 'Structurez l’arborescence', hint: 'Ajoutez un second écran (ex. : Détail, Profil, Contact) pour dessiner la navigation.' }
  if (avgEls < 4)
    return { title: 'Enrichissez les écrans', hint: 'Chaque écran gagne à avoir 4 à 10 éléments : héro, texte, liste, carte, bouton d’action.' }
  if (doc.palette.primary === DEFAULT_PALETTE.primary)
    return { title: 'Personnalisez la palette', hint: 'Choisissez une couleur principale et un fond qui racontent votre marque (contraste AA).' }
  return { title: 'Exportez le code', hint: 'Votre maquette est prête : onglet Code → choisissez HTML, React ou FlutterFlow.' }
}

function StepsGuide({ doc }: { doc: DesignDoc }) {
  const checks = [
    { label: 'Nom & identité définis', ok: doc.appName.trim().length > 2 && doc.appName !== 'Mon application' },
    { label: 'Au moins 2 écrans', ok: doc.screens.length >= 2 },
    { label: 'Écrans garnis (≥ 4 éléments en moyenne)', ok: doc.screens.reduce((n, s) => n + s.elements.length, 0) / Math.max(1, doc.screens.length) >= 4 },
    { label: 'Palette personnalisée', ok: doc.palette.primary !== DEFAULT_PALETTE.primary },
  ]
  const step = nextStep(doc)
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Progression</p>
      {checks.map((c) => (
        <p key={c.label} className={`flex items-start gap-1.5 text-xs ${c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
          <span className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${c.ok ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground/40'}`} aria-hidden="true">
            {c.ok && <Check className="h-2.5 w-2.5" />}
          </span>
          {c.label}
        </p>
      ))}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-2.5">
        <p className="text-xs font-semibold text-primary">Prochain pas : {step.title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{step.hint}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau Assistant (chat de conception)                              */
/* ------------------------------------------------------------------ */

const QUICK_PROMPTS = [
  'Propose une palette chaleureuse',
  'Ajoute un écran de profil',
  'Améliore l’écran d’accueil',
  'Rends la navigation plus claire',
]

function AssistantPanel({ doc, setDoc }: { doc: DesignDoc; setDoc: (fn: (d: DesignDoc) => DesignDoc) => void }) {
  const [input, setInput] = useState('')
  const [log, setLog] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log])

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setInput('')
    setLog((l) => [...l, { role: 'user', content: question }])
    try {
      const system =
        'Tu es l’assistant de conception WYSIWYG de Lumo. Voici le design actuel (JSON) :\n' +
        JSON.stringify(doc) +
        '\n\nL’utilisateur demande : « ' + question + ' ».\n' +
        'Modifie le design en conséquence et réponds en DEUX parties :\n' +
        '1. Une ou deux phrases sur ce que tu as changé.\n' +
        '2. Un UNIQUE bloc ```json avec le design COMPLET mis à jour — même schéma, types autorisés : navbar, hero, text, button, input, image, list, card, badge, divider, footer. Rien d’autre.'
      const reply = await apiChat([{ role: 'user', content: question }], system)
      const m = reply.match(/```json\s*([\s\S]*?)```/) ?? reply.match(/\{[\s\S]*\}/)
      let applied = false
      if (m) {
        try {
          const parsed = coerceDoc(JSON.parse(m[0].replace(/^```json\s*|\s*```$/g, '')))
          if (parsed) {
            setDoc(() => parsed)
            applied = true
          }
        } catch {
          /* JSON invalide */
        }
      }
      const text = reply.replace(/```json[\s\S]*?```/, '').trim()
      setLog((l) => [...l, { role: 'assistant', content: text + (applied ? '\n\n✅ Maquette mise à jour dans le studio.' : '') }])
      toast({ title: applied ? 'Conception appliquée' : 'Suggestion reçue', className: applied ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100' : undefined })
    } catch (e) {
      setLog((l) => [...l, { role: 'assistant', content: `Désolé, l’assistant est indisponible : ${e instanceof Error ? e.message : 'erreur'}. Réessayez ou ajustez manuellement.` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <StepsGuide doc={doc} />
      <div ref={logRef} className="min-h-24 flex-1 space-y-2 overflow-y-auto rounded-xl border bg-secondary/40 p-2.5 scrollbar-thin" aria-label="Conversation avec l’assistant de conception" aria-live="polite">
        {log.length === 0 && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Demandez une modification : l’assistant restructure la maquette à chaque étape. Ex. : « ajoute un écran de
            connexion avec un champ e-mail ».
          </p>
        )}
        {log.map((l, i) => (
          <p key={i} className={`whitespace-pre-wrap rounded-lg px-2 py-1.5 text-[11px] leading-relaxed ${l.role === 'user' ? 'ml-6 bg-primary/10 text-foreground' : 'mr-2 bg-background'}`}>
            <span className="mb-0.5 block font-semibold">{l.role === 'user' ? 'Vous' : 'Lumo · assistant design'}</span>
            {l.content}
          </p>
        ))}
        {busy && <p className="px-2 text-[11px] text-primary">L’assistant réfléchit…</p>}
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            onClick={() => void ask(q)}
            disabled={busy}
            className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void ask(input)
            }
          }}
          placeholder="Demandez à l’assistant de conception…"
          aria-label="Message à l’assistant de conception"
          rows={2}
          className="min-h-9 flex-1 resize-none text-xs"
        />
        <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => void ask(input)} disabled={busy || !input.trim()} aria-label="Envoyer à l’assistant">
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau Code (export HTML / React / FlutterFlow)                    */
/* ------------------------------------------------------------------ */

function CodePanel({ doc }: { doc: DesignDoc }) {
  const [framework, setFramework] = useState<'html' | 'react' | 'flutterflow'>('html')
  const [files, setFiles] = useState<{ name: string; content: string }[] | null>(null)
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  function generate() {
    const out =
      framework === 'html'
        ? [generateHtml(doc)]
        : framework === 'react'
          ? [generateReact(doc)]
          : generateFlutterFlow(doc)
    setFiles(out)
    setActive(0)
    toast({ title: `Code ${framework} généré`, description: `${out.length} fichier(s)` })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={framework}
          onChange={(e) => setFramework(e.target.value as 'html' | 'react' | 'flutterflow')}
          className="h-9 rounded-md border bg-background px-2.5 text-xs"
          aria-label="Framework d’export"
        >
          <option value="html">HTML + CSS (responsive)</option>
          <option value="react">React (Tailwind)</option>
          <option value="flutterflow">FlutterFlow (Flutter/Dart)</option>
        </select>
        <Button size="sm" className="gap-1.5" onClick={generate}>
          <Sparkles className="h-3.5 w-3.5" /> Générer le code
        </Button>
      </div>
      {framework === 'flutterflow' && (
        <p className="rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
          Format FlutterFlow : <strong>main.dart</strong> (écrans en StatelessWidget) +{' '}
          <strong>flutterflow_design.json</strong> à importer dans FlutterFlow (Custom Code / structure des pages).
        </p>
      )}
      {files ? (
        <>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-thin" role="tablist" aria-label="Fichiers générés">
            {files.map((f, i) => (
              <button
                key={f.name}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium ${
                  i === active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
          <pre className="min-h-32 flex-1 overflow-auto rounded-xl border bg-secondary/40 p-3 text-[11px] leading-relaxed scrollbar-thin">
            <code>{files[active]?.content}</code>
          </pre>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(files[active]?.content ?? '')
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} Copier
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                for (const f of files) downloadText(f.content, f.name)
                toast({ title: 'Fichiers téléchargés', description: `${files.length} fichier(s) ${framework}` })
              }}
            >
              <Download className="h-3.5 w-3.5" /> Télécharger
            </Button>
          </div>
        </>
      ) : (
        <div className="grid min-h-32 flex-1 place-items-center rounded-xl border border-dashed text-center text-xs text-muted-foreground">
          Choisissez un framework puis générez le code de la maquette — responsive inclus.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mode Aperçu : navigation interactive entre les écrans               */
/* ------------------------------------------------------------------ */

function PreviewEl({ el, palette, onNavigate }: { el: DesignEl; palette: DesignDoc['palette']; onNavigate: (name: string) => void }) {
  const p = el.props
  switch (el.type) {
    case 'navbar':
      return (
        <header className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white p-3 shadow-sm">
          <span className="font-bold" style={{ color: palette.primary }}>{p.text || 'Mon app'}</span>
          <span className="flex flex-wrap gap-2 text-xs">
            {(p.links ?? '').split(/[,\n]/).map((l) => l.trim()).filter(Boolean).map((l, i) => (
              <button
                key={i}
                onClick={() => onNavigate(l)}
                className="rounded-full px-2 py-0.5 opacity-75 transition-colors hover:bg-accent hover:opacity-100"
                title={`Aller à l’écran « ${l} »`}
              >
                {l}
              </button>
            ))}
          </span>
        </header>
      )
    case 'hero':
      return (
        <section className="flex flex-col items-center gap-2 rounded-2xl bg-white p-6 text-center shadow-sm sm:p-9">
          <h3 className="text-xl font-bold sm:text-2xl" style={{ color: palette.text }}>{p.title}</h3>
          <p className="max-w-md text-xs opacity-70 sm:text-sm">{p.subtitle}</p>
          <button
            onClick={() => onNavigate(p.cta ?? '')}
            className="rounded-full px-5 py-2 text-xs font-semibold text-white shadow-sm transition-transform hover:scale-105"
            style={{ background: palette.primary }}
          >
            {p.cta}
          </button>
        </section>
      )
    case 'button':
      return (
        <p className="px-1">
          <span
            className={`inline-block rounded-full px-4 py-2 text-xs font-semibold sm:text-sm ${p.variant === 'outline' ? 'border-2' : 'text-white'}`}
            style={p.variant === 'outline' ? { borderColor: palette.primary, color: palette.primary } : { background: palette.primary }}
          >
            {p.text}
          </span>
        </p>
      )
    default:
      // Les autres éléments partagent le rendu d’édition, sans sélection ni clic
      return <ElViewStatic el={el} palette={palette} />
  }
}

function ElViewStatic({ el, palette }: { el: DesignEl; palette: DesignDoc['palette'] }) {
  return <ElView el={el} palette={palette} selected={false} onSelect={() => {}} />
}

function PreviewCanvas({
  doc,
  screenIndex,
  onScreenChange,
  onClose,
}: {
  doc: DesignDoc
  screenIndex: number
  onScreenChange: (i: number) => void
  onClose: () => void
}) {
  const screen = doc.screens[screenIndex]
  if (!screen) return null

  function navigate(name: string) {
    const target = doc.screens.findIndex((s) => s.name.toLowerCase().includes(name.toLowerCase().trim()) || name.toLowerCase().includes(s.name.toLowerCase()))
    if (target >= 0) onScreenChange(target)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-secondary/50">
      <div className="flex items-center justify-between gap-2 border-b bg-background px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs font-semibold">
          Aperçu — {screen.name} <span className="font-normal text-muted-foreground">({screenIndex + 1}/{doc.screens.length})</span>
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" disabled={screenIndex === 0} onClick={() => onScreenChange(screenIndex - 1)} aria-label="Écran précédent">
            ← Précédent
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-[11px]"
            disabled={screenIndex >= doc.screens.length - 1}
            onClick={() => onScreenChange(screenIndex + 1)}
            aria-label="Écran suivant"
          >
            Suivant →
          </Button>
          <Button size="sm" variant="secondary" className="h-7 gap-1 text-[11px]" onClick={onClose} aria-label="Quitter l’aperçu">
            <X className="h-3 w-3" /> Quitter
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        <div
          className="mx-auto flex min-h-full w-full max-w-[560px] flex-col gap-3 rounded-3xl border p-3 shadow-sm"
          style={{ background: doc.palette.bg, color: doc.palette.text }}
        >
          {screen.elements.map((el) => (
            <PreviewEl key={el.id} el={el} palette={doc.palette} onNavigate={navigate} />
          ))}
        </div>
      </div>
      {/* Puces de navigation entre écrans */}
      <div className="flex items-center justify-center gap-1.5 border-t bg-background py-2">
        {doc.screens.map((s, i) => (
          <button
            key={s.id}
            onClick={() => onScreenChange(i)}
            className={`h-2 rounded-full transition-all ${i === screenIndex ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/40 hover:bg-muted-foreground/70'}`}
            aria-label={`Aller à l’écran ${s.name}`}
            title={s.name}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Visionneuse / studio complet                                        */
/* ------------------------------------------------------------------ */

export function DesignStudioDialog({
  artifact,
  open,
  onOpenChange,
}: {
  artifact: Artifact | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { toast } = useToast()
  const sessions = useLumo((s) => s.sessions)
  const updateMessage = useLumo((s) => s.updateMessage)
  const [doc, setDocState] = useState<DesignDoc>(() => emptyDoc())
  const [activeScreenId, setActiveScreenId] = useState(doc.screens[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)

  /* Chargement d’un artefact — ajustement de état pendant le rendu (pattern React officiel) */
  const loadKey = open && artifact ? artifact.id : null
  if (loadKey && loadKey !== loadedKey) {
    let next: DesignDoc | null = null
    if (artifact?.text) {
      try {
        next = coerceDoc(JSON.parse(artifact.text))
      } catch {
        next = null
      }
    }
    setDocState(next ?? emptyDoc())
    setActiveScreenId(next?.screens[0]?.id ?? '')
    setSelectedId(null)
    setLoadedKey(loadKey)
  }

  const setDoc = (fn: (d: DesignDoc) => DesignDoc) => setDocState((d) => fn(d))
  const activeScreen = doc.screens.find((s) => s.id === activeScreenId) ?? doc.screens[0]
  const selected = activeScreen?.elements.find((e) => e.id === selectedId) ?? null

  function addElement(type: ElType) {
    if (!activeScreen) return
    const el = makeEl(type)
    setDoc((d) => ({
      ...d,
      screens: d.screens.map((s) => (s.id === activeScreen.id ? { ...s, elements: [...s.elements, el] } : s)),
    }))
    setSelectedId(el.id)
  }

  function renameScreen(name: string) {
    if (!activeScreen) return
    setDoc((d) => ({ ...d, screens: d.screens.map((s) => (s.id === activeScreen.id ? { ...s, name: name.slice(0, 40) } : s)) }))
  }

  function saveToArtifact() {
    if (!artifact) return
    for (const sess of sessions) {
      const msg = sess.messages.find((m) => m.artifacts?.some((a) => a.id === artifact.id))
      if (msg) {
        updateMessage(sess.id, msg.id, {
          artifacts: msg.artifacts?.map((a) =>
            a.id === artifact.id
              ? {
                  ...a,
                  text: JSON.stringify(doc),
                  meta: { ...a.meta, appName: doc.appName, screens: doc.screens.length, elements: doc.screens.reduce((n, s) => n + s.elements.length, 0) },
                }
              : a,
          ),
        })
        toast({ title: 'Maquette enregistrée', description: 'Les modifications sont conservées dans la session.' })
        return
      }
    }
    toast({ title: 'Enregistrement local', description: 'Maquette conservée jusqu’à la fermeture du studio.' })
  }

  const canvas = activeScreen && (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={activeScreen.name}
            onChange={(e) => renameScreen(e.target.value)}
            className="h-8 w-40 text-xs font-semibold sm:w-52"
            aria-label="Nom de l’écran"
          />
          <span className="text-[10px] text-muted-foreground">{activeScreen.elements.length} éléments</span>
        </div>
        <div className="flex rounded-lg border bg-background p-0.5" aria-label="Taille de la maquette">
          <button onClick={() => setViewport('mobile')} aria-pressed={viewport === 'mobile'} aria-label="Maquette mobile 390 px" className={`rounded-md p-1.5 ${viewport === 'mobile' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
            <Smartphone className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setViewport('desktop')} aria-pressed={viewport === 'desktop'} aria-label="Maquette bureau" className={`rounded-md p-1.5 ${viewport === 'desktop' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
            <Monitor className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border bg-secondary/50 p-3 scrollbar-thin">
        <div
          className={`mx-auto flex min-h-full flex-col gap-3 rounded-3xl border p-3 shadow-sm transition-all ${
            viewport === 'mobile' ? 'w-full max-w-[390px]' : 'w-full'
          }`}
          style={{ background: doc.palette.bg, color: doc.palette.text }}
        >
          {activeScreen.elements.length === 0 && (
            <p className="py-10 text-center text-xs text-muted-foreground">Écran vide — ajoutez un élément ci-dessous.</p>
          )}
          {activeScreen.elements.map((el) => (
            <ElView key={el.id} el={el} palette={doc.palette} selected={el.id === selectedId} onSelect={() => setSelectedId(el.id)} />
          ))}
        </div>
      </div>
      {/* Catalogue d’éléments */}
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin" aria-label="Ajouter un élément">
        {EL_CATALOG.map((c) => (
          <button
            key={c.type}
            onClick={() => addElement(c.type)}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            aria-label={`Ajouter : ${c.label}`}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[94dvh] w-[min(97vw,1400px)] max-w-none! flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh]">
        <DialogHeader className="border-b px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex min-w-0 items-center gap-2 font-display text-base">
              <LayoutDashboard className="h-4.5 w-4.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">Studio visuel — {doc.appName}</span>
            </DialogTitle>
            <Button
              size="sm"
              variant={previewing ? 'secondary' : 'outline'}
              className="h-7 shrink-0 gap-1 text-[11px]"
              onClick={() => {
                if (!previewing) {
                  setPreviewIndex(Math.max(0, doc.screens.findIndex((s) => s.id === activeScreenId)))
                  setSelectedId(null)
                }
                setPreviewing((v) => !v)
              }}
              aria-pressed={previewing}
            >
              <Eye className="h-3 w-3" /> {previewing ? 'Revenir à l’édition' : 'Aperçu'}
            </Button>
          </div>
          <DialogDescription>
            WYSIWYG responsive · aperçu interactif · assistant à chaque étape · export HTML, React ou FlutterFlow
          </DialogDescription>
        </DialogHeader>

        {/* Mode aperçu : navigation entre les écrans, liens et CTA cliquables */}
        {previewing ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <PreviewCanvas
              doc={doc}
              screenIndex={previewIndex}
              onScreenChange={setPreviewIndex}
              onClose={() => setPreviewing(false)}
            />
          </div>
        ) : (
        <>
        {/* Bureau : 3 colonnes */}
        <div className="hidden min-h-0 flex-1 gap-0 lg:grid lg:grid-cols-[230px_minmax(0,1fr)_320px]">
          <aside className="min-h-0 overflow-y-auto border-r p-3 scrollbar-thin">
            <ScreensPanel doc={doc} setDoc={setDoc} activeScreenId={activeScreen?.id ?? ''} setActiveScreenId={(id) => { setActiveScreenId(id); setSelectedId(null) }} />
            <div className="mt-4 border-t pt-3">
              <StepsGuide doc={doc} />
            </div>
          </aside>
          <section className="flex min-h-0 flex-col p-3">{canvas}</section>
          <aside className="flex min-h-0 flex-col gap-3 border-l p-3">
            <Tabs defaultValue="edit" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="w-full">
                <TabsTrigger value="edit" className="flex-1 gap-1 text-xs"><SquarePen className="h-3 w-3" /> Éditer</TabsTrigger>
                <TabsTrigger value="assistant" className="flex-1 gap-1 text-xs"><Sparkles className="h-3 w-3" /> Assistant</TabsTrigger>
                <TabsTrigger value="code" className="flex-1 gap-1 text-xs"><Code2 className="h-3 w-3" /> Code</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                <PropsPanel doc={doc} setDoc={setDoc} activeScreenId={activeScreen?.id ?? ''} selected={selected} setSelected={setSelectedId} />
              </TabsContent>
              <TabsContent value="assistant" className="flex min-h-0 flex-1 flex-col">
                <AssistantPanel doc={doc} setDoc={setDoc} />
              </TabsContent>
              <TabsContent value="code" className="flex min-h-0 flex-1 flex-col">
                <CodePanel doc={doc} />
              </TabsContent>
            </Tabs>
          </aside>
        </div>

        {/* Mobile / tablette : onglets empilés */}
        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          <Tabs defaultValue="canvas" className="flex min-h-0 flex-1 flex-col px-3 pb-2">
            <TabsList className="mt-1 w-full justify-start overflow-x-auto">
              <TabsTrigger value="canvas" className="gap-1 text-xs"><LayoutDashboard className="h-3 w-3" /> Maquette</TabsTrigger>
              <TabsTrigger value="screens" className="gap-1 text-xs"><ChevronRight className="h-3 w-3" /> Écrans</TabsTrigger>
              <TabsTrigger value="edit" className="gap-1 text-xs"><SquarePen className="h-3 w-3" /> Éditer</TabsTrigger>
              <TabsTrigger value="assistant" className="gap-1 text-xs"><Sparkles className="h-3 w-3" /> Assistant</TabsTrigger>
              <TabsTrigger value="code" className="gap-1 text-xs"><Code2 className="h-3 w-3" /> Code</TabsTrigger>
            </TabsList>
            <TabsContent value="canvas" className="flex min-h-0 flex-1 flex-col">{canvas}</TabsContent>
            <TabsContent value="screens" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              <ScreensPanel doc={doc} setDoc={setDoc} activeScreenId={activeScreen?.id ?? ''} setActiveScreenId={(id) => { setActiveScreenId(id); setSelectedId(null) }} />
            </TabsContent>
            <TabsContent value="edit" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              <PropsPanel doc={doc} setDoc={setDoc} activeScreenId={activeScreen?.id ?? ''} selected={selected} setSelected={setSelectedId} />
            </TabsContent>
            <TabsContent value="assistant" className="flex min-h-0 flex-1 flex-col">
              <AssistantPanel doc={doc} setDoc={setDoc} />
            </TabsContent>
            <TabsContent value="code" className="flex min-h-0 flex-1 flex-col">
              <CodePanel doc={doc} />
            </TabsContent>
          </Tabs>
        </div>
        </>
        )}

        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            Tout est responsive : vérifiez la maquette en vue mobile 390 px avant l’export.
          </p>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button size="sm" variant="outline" className="flex-1 gap-1.5 sm:flex-none" onClick={saveToArtifact}>
              <Download className="h-3.5 w-3.5" /> Enregistrer la maquette
            </Button>
            <Button size="sm" variant="secondary" className="flex-1 sm:hidden" onClick={() => onOpenChange(false)}>
              Fermer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
