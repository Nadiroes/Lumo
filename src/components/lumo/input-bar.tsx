'use client'

/**
 * Zone de saisie adaptative : elle change selon le mode actif.
 * Le mode est un point de départ, pas une contrainte (bascule dans l’en-tête).
 */

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useLumo, type SendOptions } from '@/lib/lumo/store'
import type { Session } from '@/lib/lumo/types'
import { AudioLines, FileUp, Loader2, Mic, SendHorizontal, Square, Wand2 } from 'lucide-react'

const RATIOS = [
  { value: '1024x1024', label: 'Carré 1:1' },
  { value: '1344x768', label: 'Paysage 16:9' },
  { value: '768x1344', label: 'Portrait 9:16' },
  { value: '1440x720', label: 'Bandeau 2:1' },
]
const VOICES = ['Chloé', 'Louis', 'Nova', 'Marc']
const DURATIONS = ['4 s', '8 s', '12 s']

const PLACEHOLDERS: Record<Session['mode'], string> = {
  text: 'Demandez quelque chose à Lumo…',
  free: 'Demandez quelque chose à Lumo… (texte, idées, visuels…)',
  image: 'Décrivez l’image à générer…',
  video: 'Décrivez le clip à produire…',
  audio: 'Texte à transformer en voix…',
  book: 'Que dois écrire Lumo ? (chapitre, scène, dialogue…)',
  project: 'Décrivez votre livrable, Lumo le décompose…',
}

export function InputBar({
  session,
  generating,
  onStop,
}: {
  session: Session
  generating: boolean
  onStop: () => void
}) {
  const sendMessage = useLumo((s) => s.sendMessage)
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [ratio, setRatio] = useState('1024x1024')
  const [variations, setVariations] = useState(1)
  const [voice, setVoice] = useState('Chloé')
  const [duration, setDuration] = useState('8 s')
  const [audioTab, setAudioTab] = useState<'voice' | 'transcript'>('voice')
  const [micActive, setMicActive] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const mode = session.mode

  function resize() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function submit() {
    if (generating) return
    const value = text.trim()
    if (!value) return
    const opts: SendOptions = { imageSize: ratio, variations, voice, duration }
    setText('')
    requestAnimationFrame(resize)
    await sendMessage(session.id, value, opts)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  function fakeMic() {
    if (micActive) {
      setMicActive(false)
      return
    }
    setMicActive(true)
    toast({
      title: 'Dictée simulée',
      description: 'Branchez Scribe v2 (ElevenLabs) ou Voxtral pour une transcription temps réel.',
    })
    setTimeout(() => setMicActive(false), 3200)
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    await sendMessage(session.id, '', {
      audioTab: 'transcript',
      file: { name: f.name, size: f.size },
    })
    e.target.value = ''
  }

  /* ---- Transcription de fichier (mode audio) ---- */
  if (mode === 'audio' && audioTab === 'transcript') {
    return (
      <div className="border-t bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <Tabs value={audioTab} onValueChange={(v) => setAudioTab(v as 'voice' | 'transcript')}>
            <TabsList className="mb-2.5 h-8">
              <TabsTrigger value="voice" className="gap-1 text-xs"><AudioLines className="h-3.5 w-3.5" /> Voix</TabsTrigger>
              <TabsTrigger value="transcript" className="gap-1 text-xs"><FileUp className="h-3.5 w-3.5" /> Transcription</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 rounded-2xl border bg-card p-2.5">
            <p className="flex-1 px-1 text-sm text-muted-foreground">
              Joignez un fichier audio pour le transcrire (MP3, WAV, M4A…).
            </p>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={onFile} aria-hidden="true" />
            <Button onClick={() => fileRef.current?.click()} className="gap-1.5">
              <FileUp className="h-4 w-4" /> Choisir un fichier
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Démo locale — brancher Voxtral ou Agnes AI pour la transcription réelle.
          </p>
        </div>
      </div>
    )
  }

  /* ---- Modes standard ---- */
  const isImage = mode === 'image'
  const isVideo = mode === 'video'

  return (
    <div className="border-t bg-background/90 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        {mode === 'audio' && (
          <Tabs value={audioTab} onValueChange={(v) => setAudioTab(v as 'voice' | 'transcript')}>
            <TabsList className="mb-2.5 h-8">
              <TabsTrigger value="voice" className="gap-1 text-xs"><AudioLines className="h-3.5 w-3.5" /> Voix</TabsTrigger>
              <TabsTrigger value="transcript" className="gap-1 text-xs"><FileUp className="h-3.5 w-3.5" /> Transcription</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:border-primary/60">
          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              resize()
            }}
            onKeyDown={onKeyDown}
            placeholder={PLACEHOLDERS[mode]}
            aria-label="Message pour Lumo"
            rows={1}
            className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 focus-visible:ring-0"
          />

          <div className="flex shrink-0 items-center gap-1.5">
            {isImage && (
              <>
                <Select value={ratio} onValueChange={setRatio}>
                  <SelectTrigger size="sm" className="h-9 w-[7.5rem] text-xs" aria-label="Format de l’image">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RATIOS.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="text-xs">
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant={variations === 4 ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-9 gap-1 text-xs"
                  onClick={() => setVariations(variations === 4 ? 1 : 4)}
                  aria-pressed={variations === 4}
                  title="Générer 4 variations en parallèle"
                >
                  <Wand2 className="h-3.5 w-3.5" /> 4 variations
                </Button>
              </>
            )}
            {isVideo && (
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger size="sm" className="h-9 w-20 text-xs" aria-label="Durée du clip">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {mode === 'audio' && (
              <>
                <Select value={voice} onValueChange={setVoice}>
                  <SelectTrigger size="sm" className="h-9 w-24 text-xs" aria-label="Choix de la voix">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VOICES.map((v) => (
                      <SelectItem key={v} value={v} className="text-xs">
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-9 w-9 ${micActive ? 'text-primary' : 'text-muted-foreground'}`}
                  onClick={fakeMic}
                  aria-label="Dictée vocale (simulée)"
                >
                  <Mic className="h-4 w-4" />
                </Button>
              </>
            )}

            {generating ? (
              <Button size="icon" variant="destructive" className="h-10 w-10" onClick={onStop} aria-label="Arrêter la génération">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button size="icon" className="h-10 w-10" onClick={() => void submit()} disabled={!text.trim()} aria-label="Envoyer">
                <SendHorizontal className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-3 text-center text-[11px] text-muted-foreground">
          <span>
            <kbd className="rounded border bg-secondary px-1">Entrée</kbd> envoyer ·{' '}
            <kbd className="rounded border bg-secondary px-1">Maj+Entrée</kbd> nouvelle ligne
          </span>
          <span aria-hidden="true">·</span>
          <span>Démo locale — vos données restent sur votre machine</span>
          {generating && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> Lumo travaille…
            </span>
          )}
        </p>
      </div>
    </div>
  )
}
