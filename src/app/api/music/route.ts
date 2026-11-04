import { NextRequest } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Studio musical Lumo — génération de chansons complètes façon Suno.
 *
 * Chaîne de production (serveur) :
 *   1. Paroles  : GLM écrit des paroles structurées (format DiffRhythm 2)
 *                 ou restructure celles fournies par l'utilisateur.
 *   2. Musique  : appel du Space officiel Hugging Face « ASLP-lab/DiffRhythm2 »
 *                 (modèle semi-autorégressif à blocs — voix + accompagnement),
 *                 avec le token HF de l'utilisateur s'il est enregistré (quota ZeroGPU).
 *   3. Repli    : si le studio est indisponible, on prévient le client
 *                 (event « fallback ») qui bascule sur sa synthèse locale.
 *
 * Le flux de réponse est du NDJSON : un objet {stage:...} par ligne, ce qui
 * permet à l'interface d'afficher chaque étape en temps réel.
 */

const SPACE_URL = 'https://aslp-lab-diffrhythm2.hf.space'
const ENGINE = 'DiffRhythm 2'

interface MusicBody {
  prompt: string
  /** Paroles fournies : format DiffRhythm 2, texte brut, ou timestamps [mm:ss] (nettoyés) */
  lyrics?: string
  /** Tags de style libres (text_prompt pour le modèle) */
  tags?: string
  /** Style préréglé de l'interface : auto | lofi | electro | ... */
  style?: string
  /** Durée cible approximative (s) — pilote le volume de paroles écrit */
  duration?: number
  format?: 'mp3' | 'wav' | 'ogg'
}

/** Traduction des préréglages UI en tags de style anglais (compris par MuQMuLan) */
const STYLE_TAGS: Record<string, string> = {
  auto: '',
  lofi: 'lo-fi chill, soft beats, vinyl warmth, cozy',
  electro: 'electronic dance, bright synths, driving beat',
  cinematic: 'cinematic orchestral, epic strings, emotional',
  rock: 'energetic rock, electric guitars, live drums',
  jazz: 'smooth jazz, saxophone, double bass, swing',
  ambient: 'ambient atmospheric, ethereal pads, slow',
  pop: 'catchy pop, bright vocals, modern production',
  funk: 'groovy funk, slap bass, brass section, dance',
}

/** Nombre de couplets selon la durée cible (le modèle v2 adapte la durée au volume de paroles) */
function structureHint(duration: number): string {
  if (duration <= 60) return '1 couplet + 1 refrain — chanson très courte (~1 min)'
  if (duration <= 120) return '2 couplets + 2 refrains (~2 min)'
  if (duration <= 200) return '3 couplets, 2-3 refrains, 1 pont (~3 min)'
  return '4-5 couplets, refrains, 1 pont, final longue (~4 min et plus)'
}

function jsonEvent(controller: ReadableStreamDefaultController<Uint8Array>, enc: TextEncoder, obj: unknown) {
  controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
}

/** Nettoie des paroles : retire les timestamps [mm:ss.xx], les séparateurs, normalise */
function cleanUserLyrics(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*/, '').trim()) // timestamps v1
    .filter((l) => l.length > 0 && !/^[#>/*-]{1,6}\s*$/.test(l)) // vides / séparateurs
    .join('\n')
    .trim()
}

/** Détecte si les paroles suivent déjà le format à sections de DiffRhythm 2 */
function hasV2Sections(raw: string): boolean {
  return /^\s*\[(?:start|intro|verse|chorus|bridge|outro)\]/im.test(raw)
}

async function getUserHfToken(): Promise<string | undefined> {
  try {
    const key = await db.apiKey.findFirst({ where: { provider: 'huggingface' }, select: { secret: true } })
    return key?.secret || undefined
  } catch {
    return undefined
  }
}

interface LyricsResult {
  title: string
  lrc: string
}

function parseLyricsJson(raw: string, what: string): LyricsResult {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`${what} : réponse illisible`)
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { title?: string; lrc?: string }
  const lrc = String(parsed.lrc ?? '').trim()
  if (!lrc || !hasV2Sections(lrc)) throw new Error(`${what} : sections absentes`)
  return { title: String(parsed.title ?? '').trim() || 'Chanson Lumo', lrc }
}

/** Appel GLM : écrit des paroles complètes pour DiffRhythm 2. */
async function generateLyrics(body: MusicBody): Promise<LyricsResult> {
  const preset = STYLE_TAGS[body.style ?? 'auto'] ?? ''
  const freeTags = (body.tags ?? '').trim()
  const styleLine = [preset, freeTags].filter(Boolean).join(', ') || 'au choix selon le thème'
  const target = Math.min(Math.max(body.duration ?? 120, 30), 285)

  const sys =
    'Tu es un parolier professionnel travaillant pour un studio de génération musicale IA (DiffRhythm 2). ' +
    'Tu écris des chansons riches, imagées, émotionnellement progressives. ' +
    'Tu réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni commentaire.'

  const user = [
    `Écris une chanson complète sur le thème : « ${body.prompt} ».`,
    `Style musical : ${styleLine}.`,
    `Structure visée : ${structureHint(target)}.`,
    'Les paroles doivent être dans la même langue que le thème (français si le thème est en français).',
    '',
    'FORMAT LRC STRICT (champ "lrc" du JSON) :',
    '- Première ligne : [start]',
    '- Sections autorisées entre crochets, une par ligne : [intro] [verse] [chorus] [bridge] [outro]',
    '- Chaque phrase de la chanson sur sa propre ligne (sans timestamp, sans annotation)',
    '- Utilise [verse] pour chaque couplet et répète [chorus] à l’identique',
    '- Aucun texte entre parenthèses, aucune indication (pas de « (couplet 2) », pas de « Solo »)',
    '- Longueurs de lignes naturellement variées',
    '',
    'Le JSON final : {"title": "titre court et évocateur (3-6 mots)", "lrc": "le texte complet avec \\n"}',
  ].join('\n')

  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: sys },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  })
  const raw = completion.choices[0]?.message?.content ?? ''
  return parseLyricsJson(raw, 'Parolier')
}

/** Structure des paroles fournies par l'utilisateur (préserve ses mots). */
async function structureUserLyrics(body: MusicBody, cleaned: string): Promise<LyricsResult> {
  const preset = STYLE_TAGS[body.style ?? 'auto'] ?? ''
  const sys =
    'Tu es un arrangeur musical. On te donne les paroles d’une chanson (éventuellement désordonnées). ' +
    'Tu les organises au format DiffRhythm 2 SANS réécrire le texte : tu ne fais qu’ajouter les balises de sections, ' +
    'regrouper les lignes en couplets cohérents, répéter un refrain si certains vers reviennent. ' +
    'Tu ne supprimes ni ne modifie les mots de l’auteur (tu peux retirer des doublons de lignes évidents). ' +
    'Réponds UNIQUEMENT avec un JSON {"title": "...", "lrc": "..."} — lrc commence par [start], ' +
    'sections parmi [intro] [verse] [chorus] [bridge] [outro], une ligne par phrase, aucun commentaire.'
  const user = `Thème/contexte : « ${body.prompt} ». Style : ${[preset, body.tags ?? ''].filter(Boolean).join(', ') || 'libre'}.\n\nParoles à organiser :\n${cleaned}`
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: sys },
      { role: 'user', content: user },
    ],
    thinking: { type: 'disabled' },
  })
  const raw = completion.choices[0]?.message?.content ?? ''
  return parseLyricsJson(raw, 'Arrangeur')
}

/** Titre de secours dérivé du prompt ou de la première ligne de paroles. */
function fallbackTitle(body: MusicBody, lrc: string): string {
  const firstLine =
    lrc
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('[')) ?? body.prompt
  const words = (firstLine || 'Chanson Lumo').split(/\s+/).slice(0, 6).join(' ')
  return (words || 'Chanson Lumo').slice(0, 60)
}

/** Appel du Space DiffRhythm 2 et téléchargement du morceau. */
async function callDiffRhythm(
  lrc: string,
  body: MusicBody,
  token?: string,
): Promise<{ base64: string; bytes: number; mime: string }> {
  const { Client } = await import('@gradio/client')
  const client = await Client.connect(SPACE_URL, token ? ({ token } as never) : ({} as never))

  const preset = STYLE_TAGS[body.style ?? 'auto'] ?? ''
  const textPrompt = [preset, (body.tags ?? '').trim(), body.prompt].filter(Boolean).join(', ').slice(0, 300)
  const format = body.format ?? 'mp3'

  const result = (await Promise.race([
    client.predict('/infer_music', {
      lrc,
      audio_prompt: null,
      text_prompt: textPrompt || 'pop, piano, warm vocals',
      seed: 0,
      randomize_seed: true,
      steps: 16,
      cfg_strength: 1.3,
      file_type: format,
      odeint_method: 'euler',
    }),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Délai du studio dépassé (240 s)')), 240_000)),
  ])) as { data: unknown }

  const first = Array.isArray(result.data) ? result.data[0] : result.data
  const url = (first as { url?: string })?.url
  if (!url) throw new Error('Le studio n’a pas renvoyé de fichier audio')

  const dl = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  if (!dl.ok) throw new Error(`Téléchargement du morceau impossible (${dl.status})`)
  const buf = await dl.arrayBuffer()
  const bytes = buf.byteLength
  const base64 = Buffer.from(buf).toString('base64')
  return { base64, bytes, mime: format === 'mp3' ? 'audio/mpeg' : format === 'ogg' ? 'audio/ogg' : 'audio/wav' }
}

export async function POST(req: NextRequest) {
  const enc = new TextEncoder()
  let body: MusicBody
  try {
    body = (await req.json()) as MusicBody
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Corps de requête invalide' }), { status: 400 })
  }
  const prompt = (body.prompt ?? '').trim()
  const userLyrics = (body.lyrics ?? '').trim()
  if (!prompt && !userLyrics) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Décrivez au moins le thème de la chanson' }),
      { status: 400 },
    )
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEmit = (obj: unknown) => {
        if (!closed) controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
      }
      try {
        /* ---- 1. Paroles ---- */
        let title: string
        let lrc: string
        if (userLyrics && hasV2Sections(userLyrics)) {
          title = fallbackTitle(body, userLyrics)
          lrc = userLyrics.startsWith('[start]') ? userLyrics : `[start]\n${userLyrics}`
          safeEmit({ stage: 'lyrics', source: 'user', title, lrc })
        } else {
          try {
            const res = userLyrics
              ? await structureUserLyrics(body, cleanUserLyrics(userLyrics))
              : await generateLyrics(body)
            title = res.title
            lrc = res.lrc
            safeEmit({ stage: 'lyrics', source: userLyrics ? 'user-structured' : 'glm', title, lrc })
          } catch (e) {
            if (userLyrics) {
              title = fallbackTitle(body, userLyrics)
              lrc = `[start]\n[verse]\n${cleanUserLyrics(userLyrics)}`
              safeEmit({ stage: 'lyrics', source: 'user-raw', title, lrc })
            } else {
              throw e
            }
          }
        }

        /* ---- 2. Studio DiffRhythm 2 ---- */
        safeEmit({ stage: 'studio', engine: ENGINE })
        const token = await getUserHfToken()
        try {
          const audio = await callDiffRhythm(lrc, body, token)
          const durationSec = audio.mime === 'audio/mpeg' ? Math.round((audio.bytes * 8) / 128_000) : 0
          safeEmit({
            stage: 'done',
            engine: ENGINE,
            title,
            lrc,
            base64: audio.base64,
            bytes: audio.bytes,
            mime: audio.mime,
            durationSec,
          })
        } catch (e) {
          safeEmit({
            stage: 'fallback',
            reason: e instanceof Error ? e.message.slice(0, 180) : 'studio indisponible',
          })
        }
      } catch (e) {
        safeEmit({
          stage: 'fallback',
          reason: e instanceof Error ? e.message.slice(0, 180) : 'erreur inattendue',
        })
      } finally {
        closed = true
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
