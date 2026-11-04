'use client'

/**
 * Zone de saisie adaptative : elle change selon le mode actif.
 * Pièces jointes dans tous les modes, édition des messages, onglets Voix /
 * Musique / Transcription pour l’audio. Le mode est un point de départ.
 */

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useLumo, type SendOptions } from '@/lib/lumo/store'
import type { Attachment, Session } from '@/lib/lumo/types'
import {
  AudioLines,
  Check,
  FileAudio,
  FileText,
  FileUp,
  LayoutDashboard,
  Loader2,
  Mic,
  Music,
  Music2,
  Paperclip,
  PencilLine,
  SendHorizontal,
  Square,
  Wand2,
  X,
} from 'lucide-react'
import { WEB_FRAMEWORKS, type WebFramework } from '@/lib/lumo/types'

const RATIOS = [
  { value: '1024x1024', label: 'Carré 1:1' },
  { value: '1344x768', label: 'Paysage 16:9' },
  { value: '768x1344', label: 'Portrait 9:16' },
  { value: '1440x720', label: 'Bandeau 2:1' },
]
const VOICES = ['Chloé', 'Louis', 'Nova', 'Marc']
const DURATIONS = ['4 s', '8 s', '12 s']

const MUSIC_STYLES = [
  { value: 'auto', label: 'Auto ✨' },
  { value: 'lofi', label: 'Lo-fi' },
  { value: 'electro', label: 'Électro' },
  { value: 'cinematic', label: 'Cinématique' },
  { value: 'rock', label: 'Rock' },
  { value: 'jazz', label: 'Jazz' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'pop', label: 'Pop' },
  { value: 'funk', label: 'Funk' },
]
const MUSIC_DURATIONS = [
  { value: '60', label: '~1 min' },
  { value: '120', label: '~2 min' },
  { value: '180', label: '~3 min' },
  { value: '285', label: '~4 min 45' },
]

const PLACEHOLDERS: Record<Session['mode'], string> = {
  text: 'Demandez quelque chose à Lumo…',
  free: 'Demandez quelque chose à Lumo… (texte, idées, visuels…)',
  image: 'Décrivez l’image à générer…',
  video: 'Décrivez le clip à produire…',
  audio: 'Décrivez la chanson ou le texte à transformer…',
  book: 'Que dois écrire Lumo ? (chapitre, scène, dialogue…)',
  project: 'Décrivez votre livrable, Lumo le décompose…',
  webdev: 'Décrivez le site ou l’app web à coder… (ex. : « la vitrine d’un fleuriste avec galerie et contact »)',
  appdesign: 'Décrivez l’application à concevoir… (ex. : « une app de réservation de coach sportif »)',
}

const TEXT_EXT = /\.(txt|md|markdown|csv|json|ts|tsx?|jsx?|py|html?|css|xml|ya?ml|log|sql|rs|go|java|c|cpp|sh|ini|toml)$/i

function isTextLike(f: File): boolean {
  return (
    f.type.startsWith('text/') ||
    /json|xml|javascript|csv|yaml|x-sh/.test(f.type) ||
    TEXT_EXT.test(f.name)
  )
}

async function fileToAttachment(f: File): Promise<Attachment> {
  if (isTextLike(f) && f.size <= 200_000) {
    try {
      const text = await f.text()
      return { name: f.name, size: f.size, type: f.type || 'text/plain', text }
    } catch {
      /* lecture impossible → méta seulement */
    }
  }
  return { name: f.name, size: f.size, type: f.type || 'application/octet-stream' }
}

function attachmentIcon(a: Attachment) {
  if (a.type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|flac)$/i.test(a.name)) return <FileAudio className="h-3 w-3" />
  return <FileText className="h-3 w-3" />
}

function fmtKo(n: number): string {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`
}

type AudioTab = 'voice' | 'transcript' | 'music'

function AudioTabs({ audioTab, setAudioTab }: { audioTab: AudioTab; setAudioTab: (v: AudioTab) => void }) {
  return (
    <Tabs value={audioTab} onValueChange={(v) => setAudioTab(v as AudioTab)}>
      <TabsList className="mb-2.5 h-8">
        <TabsTrigger value="voice" className="gap-1 text-xs">
          <AudioLines className="h-3.5 w-3.5" /> Voix
        </TabsTrigger>
        <TabsTrigger value="music" className="gap-1 text-xs">
          <Music className="h-3.5 w-3.5" /> Musique
        </TabsTrigger>
        <TabsTrigger value="transcript" className="gap-1 text-xs">
          <FileUp className="h-3.5 w-3.5" /> Transcription
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

/* ------------------------------------------------------------------ */
/* Enveloppe : gère l’onglet transcription et l’injection de l’édition */
/* ------------------------------------------------------------------ */

export function InputBar({
  session,
  generating,
  onStop,
}: {
  session: Session
  generating: boolean
  onStop: () => void
}) {
  const editingMsg = useLumo((s) => s.editingMsg)
  const [audioTab, setAudioTab] = useState<AudioTab>('voice')
  const fileRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  const isEditing = editingMsg?.sessionId === session.id
  const mode = session.mode

  async function onFileTranscript(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    // Le fichier audio part en base64 vers /api/asr (plafond ~9 Mo)
    if (f.size > 9_000_000) {
      toast({
        title: 'Fichier trop lourd',
        description: 'Maximum ≈ 9 Mo pour la transcription. Convertissez-le en MP3 ou coupez-le.',
        variant: 'destructive',
      })
      e.target.value = ''
      return
    }
    try {
      const buf = await f.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
      }
      const b64 = btoa(bin)
      await useLumo.getState().sendMessage(session.id, '', {
        audioTab: 'transcript',
        file: { name: f.name, size: f.size },
        fileBase64: b64,
      })
    } catch {
      toast({ title: 'Lecture du fichier impossible', variant: 'destructive' })
    }
    e.target.value = ''
  }

  /* --- Branche transcription (mode audio) --- */
  if (mode === 'audio' && audioTab === 'transcript' && !isEditing) {
    return (
      <div className="border-t bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-3xl">
          <AudioTabs audioTab={audioTab} setAudioTab={setAudioTab} />
          <div className="flex items-center gap-2 rounded-2xl border bg-card p-2.5">
            <p className="flex-1 px-1 text-sm text-muted-foreground">
              Joignez un fichier audio pour le transcrire (MP3, WAV, M4A…).
            </p>
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={onFileTranscript} aria-hidden="true" />
            <Button onClick={() => fileRef.current?.click()} className="gap-1.5">
              <FileUp className="h-4 w-4" /> Choisir un fichier
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Transcription réelle et horodatée — maximum ≈ 9 Mo (MP3, WAV, M4A…).
          </p>
        </div>
      </div>
    )
  }

  const editTarget = isEditing
    ? session.messages.find((m) => m.id === editingMsg!.msgId)
    : undefined

  return (
    <Composer
      key={isEditing ? editingMsg!.msgId : 'fresh'}
      session={session}
      generating={generating}
      onStop={onStop}
      audioTab={audioTab}
      setAudioTab={setAudioTab}
      isEditing={isEditing}
      initialText={editTarget?.content ?? ''}
      initialAttachments={(editTarget?.attachments ?? []).map((a) => ({ ...a }))}
      toastError={(title, description) => toast({ title, description, variant: 'destructive' })}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Composer : saisie, pièces jointes, envoi / édition                  */
/* ------------------------------------------------------------------ */

function Composer({
  session,
  generating,
  onStop,
  audioTab,
  setAudioTab,
  isEditing,
  initialText,
  initialAttachments,
  toastError,
}: {
  session: Session
  generating: boolean
  onStop: () => void
  audioTab: AudioTab
  setAudioTab: (v: AudioTab) => void
  isEditing: boolean
  initialText: string
  initialAttachments: Attachment[]
  toastError: (title: string, description?: string) => void
}) {
  const sendMessage = useLumo((s) => s.sendMessage)
  const editMessage = useLumo((s) => s.editMessage)
  const editingMsg = useLumo((s) => s.editingMsg)
  const setEditingMsg = useLumo((s) => s.setEditingMsg)
  const { toast } = useToast()
  const [text, setText] = useState(initialText)
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments)
  const [ratio, setRatio] = useState('1024x1024')
  const [variations, setVariations] = useState(1)
  const [voice, setVoice] = useState('Chloé')
  const [duration, setDuration] = useState('8 s')
  const [musicStyle, setMusicStyle] = useState('auto')
  const [musicDuration, setMusicDuration] = useState('120')
  const [musicLyrics, setMusicLyrics] = useState('')
  const [instrumental, setInstrumental] = useState(false)
  const [framework, setFramework] = useState<WebFramework>('html')
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
    if (!value && attachments.length === 0) return

    /* --- Mode édition : régénérer à partir du message modifié --- */
    if (isEditing && editingMsg) {
      const target = editingMsg.msgId
      setEditingMsg(null)
      await editMessage(session.id, target, value || attachments[0]?.name || '', attachments)
      return
    }

    const opts: SendOptions = {
      imageSize: ratio,
      variations,
      voice,
      duration,
      audioTab,
      attachments: attachments.length ? attachments : undefined,
      musicStyle,
      musicDuration: Number(musicDuration),
      musicLyrics: musicLyrics.trim() || undefined,
      instrumental,
      framework,
    }
    setText('')
    setAttachments([])
    requestAnimationFrame(resize)
    await sendMessage(session.id, value || attachments[0]?.name || '', opts)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
    if (e.key === 'Escape' && isEditing) {
      setEditingMsg(null)
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

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    if (attachments.length + files.length > 5) {
      toastError('Maximum 5 fichiers')
      return
    }
    const parsed = await Promise.all(files.map(fileToAttachment))
    setAttachments((prev) => [...prev, ...parsed])
  }

  const attachButton = (
    <>
      <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} aria-hidden="true" />
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary"
        onClick={() => fileRef.current?.click()}
        aria-label="Joindre des fichiers (texte, audio, image…)"
        title="Joindre des fichiers"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
    </>
  )

  const attachmentChips = attachments.length > 0 && (
    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Fichiers joints">
      {attachments.map((a, i) => (
        <span
          key={`${a.name}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-2.5 py-1 text-xs"
        >
          {attachmentIcon(a)}
          <span className="max-w-40 truncate font-medium">{a.name}</span>
          <span className="text-[10px] text-muted-foreground">{fmtKo(a.size)}</span>
          {a.text && <span className="text-[10px] text-primary">lu</span>}
          <button
            onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
            aria-label={`Retirer ${a.name}`}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  )

  const isImage = mode === 'image'
  const isVideo = mode === 'video'
  const isMusic = mode === 'audio' && audioTab === 'music'
  const isWebdev = mode === 'webdev'
  const isAppDesign = mode === 'appdesign'
  const placeholder = isEditing
    ? 'Modifiez votre message…'
    : isMusic
      ? 'Décrivez la chanson à créer… (ex. : « une pop mélancolique sur la fin de l’été »)'
      : PLACEHOLDERS[mode]

  return (
    <div className="border-t bg-background/90 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-3xl">
        {mode === 'audio' && <AudioTabs audioTab={audioTab} setAudioTab={setAudioTab} />}

        {/* Bandeau d’édition */}
        {isEditing && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <PencilLine className="h-3.5 w-3.5" />
              Modification du message — les réponses suivantes seront régénérées avec vos nouveaux éléments.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setEditingMsg(null)}
            >
              <X className="h-3 w-3" /> Annuler
            </Button>
          </div>
        )}

        {attachmentChips}

        {isMusic && (
          <div className="mb-2 rounded-xl border bg-muted/30 p-2">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
              <label htmlFor="lyrics-input" className="text-[11px] leading-tight text-muted-foreground">
                Paroles <span className="hidden sm:inline">(optionnel)</span> — vides : Lumo les écrit ·
                sections <code className="rounded bg-secondary px-1">[verse]</code>
                /<code className="rounded bg-secondary px-1">[chorus]</code> : utilisées telles quelles
              </label>
              <Button
                variant={instrumental ? 'secondary' : 'ghost'}
                size="sm"
                className="h-6 gap-1 px-2 text-[11px]"
                onClick={() => setInstrumental((v) => !v)}
                aria-pressed={instrumental}
                title="Instrumental : synthèse locale sans voix chantée (DiffRhythm 2 chante le texte)"
              >
                <Music2 className="h-3 w-3" /> Instrumental
              </Button>
            </div>
            <Textarea
              id="lyrics-input"
              value={musicLyrics}
              onChange={(e) => setMusicLyrics(e.target.value)}
              placeholder={'[verse]\nUne ligne par phrase…\n[chorus]\nLe refrain inoubliable'}
              aria-label="Paroles de la chanson (optionnel)"
              rows={2}
              className="min-h-14 max-h-32 resize-none border-0 bg-transparent px-2 py-1 text-xs focus-visible:ring-0"
            />
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:border-primary/60">
          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              resize()
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={isEditing ? 'Modifier votre message' : 'Message pour Lumo'}
            rows={1}
            className="max-h-40 min-h-10 w-full min-w-44 flex-1 resize-none border-0 bg-transparent px-2 py-2 focus-visible:ring-0"
          />

          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            {attachButton}
            {isWebdev && (
              <Select value={framework} onValueChange={(v) => setFramework(v as WebFramework)}>
                <SelectTrigger size="sm" className="h-9 w-[7.5rem] text-xs" aria-label="Framework de développement">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEB_FRAMEWORKS.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isAppDesign && (
              <span className="hidden items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary sm:inline-flex">
                <LayoutDashboard className="h-3 w-3" aria-hidden="true" />
                Studio WYSIWYG à chaque réponse
              </span>
            )}
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
            {mode === 'audio' && !isMusic && (
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
            )}
            {isMusic && (
              <>
                <Select value={musicStyle} onValueChange={setMusicStyle}>
                  <SelectTrigger size="sm" className="h-9 w-28 text-xs" aria-label="Style musical">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MUSIC_STYLES.map((s) => (
                      <SelectItem key={s.value} value={s.value} className="text-xs">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={musicDuration} onValueChange={setMusicDuration}>
                  <SelectTrigger size="sm" className="h-9 w-20 text-xs" aria-label="Durée de la musique">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MUSIC_DURATIONS.map((d) => (
                      <SelectItem key={d.value} value={d.value} className="text-xs">
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            {mode === 'audio' && !isMusic && (
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 ${micActive ? 'text-primary' : 'text-muted-foreground'}`}
                onClick={fakeMic}
                aria-label="Dictée vocale (simulée)"
              >
                <Mic className="h-4 w-4" />
              </Button>
            )}

            {generating ? (
              <Button size="icon" variant="destructive" className="h-10 w-10" onClick={onStop} aria-label="Arrêter la génération">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className={`h-10 w-10 ${isEditing ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
                onClick={() => void submit()}
                disabled={!text.trim() && attachments.length === 0}
                aria-label={isEditing ? 'Enregistrer et régénérer' : 'Envoyer'}
              >
                {isEditing ? <Check className="h-4 w-4" /> : <SendHorizontal className="h-4 w-4" />}
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
          <span>{isEditing ? 'Échap pour annuler la modification' : 'Textes joints lus par Lumo · tout reste local'}</span>
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
