'use client'

/**
 * Assistant « Livre » — fenêtre de direction artistique en 4 étapes.
 * 1. Fondations  2. Ton & narration  3. Univers & personnages  4. Structure
 * À la validation, Lumo crée la session puis génère la Bible de l’œuvre.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BookBrief } from '@/lib/lumo/types'
import { ArrowLeft, ArrowRight, BookOpen, Loader2, Sparkles } from 'lucide-react'

const GENRES = [
  'Science-Fiction',
  'Fantasy',
  'Policier / Thriller',
  'Romance',
  'Historique',
  'Jeunesse / Conte',
  'Développement personnel',
  'Essai',
  'Autre',
]
const AUDIENCES = ['Jeunesse', 'Young Adult', 'Adulte', 'Tous publics']
const TONES = [
  'Sombre',
  'Optimiste',
  'Poétique',
  'Humoristique',
  'Réaliste',
  'Épique',
  'Mystérieux',
  'Doux',
]
const POVS = ['Première personne', 'Troisième personne limitée', 'Omniscient']
const TENSES = ['Présent', 'Passé']
const LENGTHS = [
  'Nouvelle (~5 000 mots)',
  'Roman court (~25 000 mots)',
  'Roman (~90 000 mots)',
  'Illimité — l’œuvre fixe sa propre taille',
]
const STRUCTURES = ['Trois actes', 'Voyage du héros', 'Voyage de l’héroïne', 'Kishōtenketsu', 'Libre']

const STEPS = ['Fondations', 'Ton & narration', 'Univers', 'Structure']

function ChipGroup({
  options,
  value,
  onChange,
  multi = false,
}: {
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  multi?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() =>
              multi
                ? onChange(active ? value.filter((v) => v !== opt) : [...value, opt])
                : onChange([opt])
            }
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-foreground hover:border-primary/50 hover:bg-accent'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

export function BookWizard({
  open,
  onOpenChange,
  onFinish,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onFinish: (brief: BookBrief) => Promise<void>
}) {
  const [step, setStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [pages, setPages] = useState('')
  const [brief, setBrief] = useState<BookBrief>({
    title: '',
    genre: '',
    subgenre: '',
    audience: 'Adulte',
    tones: [],
    themes: '',
    pov: 'Troisième personne limitée',
    tense: 'Passé',
    setting: '',
    protagonist: '',
    worldRules: '',
    length: LENGTHS[1],
    structure: 'Trois actes',
  })

  const set = <K extends keyof BookBrief>(key: K, value: BookBrief[K]) =>
    setBrief((b) => ({ ...b, [key]: value }))

  const canNext =
    step === 0
      ? brief.genre !== ''
      : step === 1
        ? brief.tones.length > 0
        : true

  async function create() {
    if (creating) return
    setCreating(true)
    const targetPages = pages.trim() ? `~${pages.trim()} pages` : brief.length
    try {
      await onFinish({ ...brief, title: brief.title?.trim() || undefined, length: targetPages })
    } finally {
      setCreating(false)
      setStep(0)
      setPages('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !creating && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
            Direction artistique — votre livre
          </DialogTitle>
          <DialogDescription>
            Quelques questions pour poser l’identité de l’œuvre. Lumo en tirera une Bible de l’œuvre
            qui guidera toute l’écriture.
          </DialogDescription>
        </DialogHeader>

        {/* Fil d’Ariane */}
        <ol className="flex items-center gap-1.5" aria-label="Étapes">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-1 items-center gap-1.5">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  i < step
                    ? 'bg-primary text-primary-foreground'
                    : i === step
                      ? 'border-2 border-primary text-primary'
                      : 'border text-muted-foreground'
                }`}
                aria-current={i === step ? 'step' : undefined}
              >
                {i + 1}
              </span>
              <span
                className={`hidden text-xs sm:inline ${
                  i === step ? 'font-medium text-foreground' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden="true" />}
            </li>
          ))}
        </ol>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1 scrollbar-thin sm:max-h-[46vh]">
          {step === 0 && (
            <>
              <div>
                <Label htmlFor="bw-title">Titre (optionnel)</Label>
                <Input
                  id="bw-title"
                  value={brief.title}
                  onChange={(e) => set('title', e.target.value)}
                  placeholder="Le Dernier Phare"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Genre *</Label>
                <div className="mt-1.5">
                  <ChipGroup options={GENRES} value={brief.genre ? [brief.genre] : []} onChange={(v) => set('genre', v[0] ?? '')} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="bw-subgenre">Sous-genre</Label>
                  <Input
                    id="bw-subgenre"
                    value={brief.subgenre}
                    onChange={(e) => set('subgenre', e.target.value)}
                    placeholder="Space opera, cyberpunk…"
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <Label>Public cible</Label>
                  <div className="mt-1.5">
                    <ChipGroup options={AUDIENCES} value={[brief.audience]} onChange={(v) => set('audience', v[0] ?? 'Adulte')} />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <Label>Ton (plusieurs choix possibles) *</Label>
                <div className="mt-1.5">
                  <ChipGroup options={TONES} value={brief.tones} onChange={(v) => set('tones', v)} multi />
                </div>
              </div>
              <div>
                <Label htmlFor="bw-themes">Thèmes & motifs</Label>
                <Textarea
                  id="bw-themes"
                  value={brief.themes}
                  onChange={(e) => set('themes', e.target.value)}
                  placeholder="Identité, deuil, mémoire des lieux…"
                  className="mt-1.5 min-h-16"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Point de vue</Label>
                  <div className="mt-1.5">
                    <ChipGroup options={POVS} value={[brief.pov]} onChange={(v) => set('pov', v[0] ?? 'Troisième personne limitée')} />
                  </div>
                </div>
                <div>
                  <Label>Temps</Label>
                  <div className="mt-1.5">
                    <ChipGroup options={TENSES} value={[brief.tense]} onChange={(v) => set('tense', v[0] ?? 'Passé')} />
                  </div>
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <Label htmlFor="bw-setting">Lieu & époque</Label>
                <Textarea
                  id="bw-setting"
                  value={brief.setting}
                  onChange={(e) => set('setting', e.target.value)}
                  placeholder="Une île atlantique en 2062, après la montée des eaux…"
                  className="mt-1.5 min-h-16"
                />
              </div>
              <div>
                <Label htmlFor="bw-protagonist">Personnage principal</Label>
                <Textarea
                  id="bw-protagonist"
                  value={brief.protagonist}
                  onChange={(e) => set('protagonist', e.target.value)}
                  placeholder="Eléna, 34 ans, gardienne de phare ; motivation : retrouver son frère disparu ; défaut : ne fait jamais confiance."
                  className="mt-1.5 min-h-16"
                />
              </div>
              <div>
                <Label htmlFor="bw-rules">Règles du monde (magie, technologie…)</Label>
                <Textarea
                  id="bw-rules"
                  value={brief.worldRules}
                  onChange={(e) => set('worldRules', e.target.value)}
                  placeholder="La lumière du phare peut réveiller les souvenirs des marins morts…"
                  className="mt-1.5 min-h-16"
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <Label>Longueur cible</Label>
                <div className="mt-1.5">
                  <ChipGroup options={LENGTHS} value={[brief.length]} onChange={(v) => set('length', v[0] ?? LENGTHS[1])} />
                </div>
                <div className="mt-2">
                  <Label htmlFor="bw-pages" className="text-xs text-muted-foreground">
                    Ou fixez vous-même la cible (optionnel) — nombre de pages
                  </Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input
                      id="bw-pages"
                      value={pages}
                      onChange={(e) => setPages(e.target.value.replace(/[^0-9]/g, ''))}
                      placeholder="ex. : 180"
                      inputMode="numeric"
                      className="h-9 w-32"
                    />
                    <span className="text-xs text-muted-foreground">
                      {pages ? `La Bible visera ~${pages} pages` : 'Laissez vide pour utiliser la longueur choisie ci-dessus'}
                    </span>
                  </div>
                </div>
              </div>
              <div>
                <Label>Structure narrative</Label>
                <div className="mt-1.5">
                  <ChipGroup options={STRUCTURES} value={[brief.structure]} onChange={(v) => set('structure', v[0] ?? 'Trois actes')} />
                </div>
              </div>
              <div className="rounded-lg border bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
                À la validation, Lumo génère la <strong className="text-foreground">Bible de l’œuvre</strong> —
                titre, pitch, voix narrative, personnages, structure en chapitres. Elle sera attachée à la
                conversation comme contexte permanent et incluse dans vos exports .zip.
                <br />
                <strong className="text-foreground">Pages illimitées :</strong> si vous choisissez « Illimité »,
                la structure s’étend librement (séquences, tomes) — et à chaque étape d’écriture, Lumo vous
                proposera une cible de pages que vous pourrez ajuster ou laisser libre.
              </div>
            </>
          )}
        </div>

        {/* Pied du wizard */}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))} disabled={creating}>
            <ArrowLeft className="h-4 w-4" />
            {step === 0 ? 'Annuler' : 'Retour'}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
              Continuer
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Créer la Bible de l’œuvre
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
