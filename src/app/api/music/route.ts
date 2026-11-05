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

const SPACE_V2 = 'https://aslp-lab-diffrhythm2.hf.space'
const SPACE_V1 = 'https://aslp-lab-diffrhythm.hf.space'
const ENGINE = 'DiffRhythm 2'

/** Erreur typique ZeroGPU : quota gratuit épuisé (repérable pour message clair + repli). */
function isQuotaError(msg: string): boolean {
  return /zerogpu|gpu quota|exceeded your/i.test(msg)
}

/** Extrait « Try again in 21:41:07 » d'un message de quota ZeroGPU. */
function quotaResetIn(msg: string): string | undefined {
  return msg.match(/try again in ([\d:]+)/i)?.[1]
}

/* Mémoire courte (module) : index du dernier chemin studio gagnant, valable 10 min. */
let lastGoodAttempt = -1
let lastGoodAt = 0

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
  /** Instrumental : DiffRhythm compose sans paroles chantées */
  instrumental?: boolean
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

async function getUserHfToken(): Promise<`hf_${string}` | undefined> {
  try {
    const key = await db.apiKey.findFirst({ where: { provider: 'huggingface' }, select: { secret: true } })
    return (key?.secret || undefined) as `hf_${string}` | undefined
  } catch {
    return undefined
  }
}

interface LyricsResult {
  title: string
  lrc: string
}

/** Nettoie un lrc parsé : « \\n » littéraux → retours ligne, backslashes parasites, espaces. */
function sanitizeLrc(raw: string): string {
  return raw
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n') // « \n » écrit littéralement par le modèle
    .replace(/\\(?!["\\/bfnrtu])/g, '') // backslash isolé parasite
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse la réponse du parolier avec tolérance :
 * 1. JSON strict extrait du texte ; 2. réparation des échappements invalides
 * et caractères de contrôle ; 3. extraction par regex du champ lrc en dernier recours.
 */
function tolerantParseLyrics(raw: string): { title: string; lrc: string } | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  const chunk = raw.slice(start, end + 1)

  try {
    const parsed = JSON.parse(chunk) as { title?: string; lrc?: string }
    if (parsed?.lrc) return { title: String(parsed.title ?? ''), lrc: String(parsed.lrc) }
  } catch {
    /* réparation ci-dessous */
  }

  try {
    const repaired = chunk
      .replace(/\\(?!["\\/bfnrtu])/g, '\\\\') // \x invalide → \\x
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ') // contrôles bruts
    const parsed = JSON.parse(repaired) as { title?: string; lrc?: string }
    if (parsed?.lrc) return { title: String(parsed.title ?? ''), lrc: String(parsed.lrc) }
  } catch {
    /* extraction regex ci-dessous */
  }

  const lrcMatch = chunk.match(/"lrc"\s*:\s*"([\s\S]*)/) // jusqu'à la fin, on déséchappe à la main
  if (lrcMatch) {
    let body = lrcMatch[1]
    const lastQuote = body.lastIndexOf('"')
    if (lastQuote > 0) body = body.slice(0, lastQuote)
    const unescaped = body
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
    const titleMatch = chunk.match(/"title"\s*:\s*"([^"]*)"/)
    return { title: titleMatch?.[1] ?? '', lrc: unescaped }
  }
  return undefined
}

function parseLyricsJson(raw: string, what: string): LyricsResult {
  const parsed = tolerantParseLyrics(raw)
  if (!parsed) throw new Error(`${what} : réponse illisible`)
  const lrc = sanitizeLrc(parsed.lrc)
  if (!lrc || !hasV2Sections(lrc)) throw new Error(`${what} : sections absentes`)
  return { title: parsed.title.trim() || 'Chanson Lumo', lrc }
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
  // 1re tentative, puis 1 reprise avec consigne renforcée si le JSON est inexploitable
  for (let essai = 0; essai < 2; essai++) {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: sys },
        {
          role: 'user',
          content:
            essai === 0
              ? user
              : user +
                '\n\nATTENTION : ta réponse précédente était un JSON invalide. Réponds avec un UNIQUE objet JSON valide ' +
                '(échappements \" et \\n corrects, aucun backslash superflu), sans texte autour.',
        },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    try {
      return parseLyricsJson(raw, 'Parolier')
    } catch (e) {
      if (essai === 1) throw e
    }
  }
  throw new Error('Parolier : réponse illisible')
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
  for (let essai = 0; essai < 2; essai++) {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: sys },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
    })
    const raw = completion.choices[0]?.message?.content ?? ''
    try {
      return parseLyricsJson(raw, 'Arrangeur')
    } catch (e) {
      if (essai === 1) throw e
    }
  }
  throw new Error('Arrangeur : réponse illisible')
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

interface AudioResult {
  base64: string
  bytes: number
  mime: string
  engine: string
}

/** Shape minimal du client Gradio utilisé ici. */
interface GradioClient {
  predict: (endpoint: string, params?: unknown) => Promise<{ data: unknown }>
}

/**
 * Appel Space avec reconnexion automatique (nouvelle session Gradio à chaque essai).
 * « 404: Session not found » = session périmée : le Space ZeroGPU a redémarré entre
 * la connexion et l'appel — une reconnexion fraîche suffit presque toujours.
 */
async function predictWithRetry(
  connect: () => Promise<GradioClient>,
  endpoint: string,
  params: Record<string, unknown>,
  timeoutMs = 240_000,
  tries = 3,
): Promise<{ data: unknown }> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const client = await connect()
      return (await Promise.race([
        client.predict(endpoint, params),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`Délai du studio dépassé (${Math.round(timeoutMs / 1000)} s)`)), timeoutMs),
        ),
      ])) as { data: unknown }
    } catch (e) {
      lastErr = e
      const msg = e instanceof Error ? e.message : String(e)
      const transient =
        /session not found|connection closed|fetch failed|network|econnreset|socket|502|503|overloaded/i.test(msg)
      if (!transient || i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

/** Prompt de style consolidé (tags préréglés + tags libres + thème [+ instrumental]). */
function buildTextPrompt(body: MusicBody): string {
  const preset = STYLE_TAGS[body.style ?? 'auto'] ?? ''
  const base = [preset, (body.tags ?? '').trim(), body.prompt].filter(Boolean).join(', ').slice(0, 260)
  return body.instrumental ? `${base ? base + ', ' : ''}instrumental, no vocals, music only`.slice(0, 300) : base
}

/** Paramètres de l'endpoint /infer_music du Space DiffRhythm 2. */
function buildV2Params(lrc: string, body: MusicBody): Record<string, unknown> {
  return {
    lrc,
    audio_prompt: null,
    text_prompt: buildTextPrompt(body) || (body.instrumental ? 'instrumental' : 'pop, piano, warm vocals'),
    seed: 0,
    randomize_seed: true,
    steps: 16,
    cfg_strength: 1.3,
    file_type: body.format ?? 'mp3',
    odeint_method: 'euler',
  }
}

/**
 * Paramètres du Space DiffRhythm 1 : convertit les paroles à sections en LRC
 * horodaté (~4,2 s par ligne, chant régulier), durée plafonnée à 95 s.
 */
function buildV1Params(lrc: string, body: MusicBody): Record<string, unknown> {
  const lines = lrc
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('['))
  const START = 12
  const PER_LINE = 4.2
  let t = START
  const stamped = lines.map((line) => {
    const mm = String(Math.floor(t / 60)).padStart(2, '0')
    const ss = (t % 60).toFixed(3).padStart(6, '0')
    const out = `[${mm}:${ss}] ${line}`
    t += PER_LINE
    return out
  })
  const duration = Math.max(30, Math.min(95, Math.round(START + lines.length * PER_LINE + 8)))
  return {
    /* v1 chante chaque ligne : en instrumental on laisse une seule ligne de vocalise minimale */
    lrc: body.instrumental && stamped.length === 0 ? '[00:12.000] ♪' : stamped.join('\n'),
    ref_audio_path: null,
    text_prompt: buildTextPrompt(body) || (body.instrumental ? 'instrumental' : 'pop, piano, warm vocals'),
    seed: 0,
    randomize_seed: true,
    steps: 32,
    cfg_strength: 4.0,
    file_type: body.format ?? 'mp3',
    odeint_method: 'euler',
    preference_infer: 'quality first',
    Music_Duration: duration,
  }
}

/** Appel du Space DiffRhythm 2 (avec ou sans token HF) et téléchargement du morceau. */
async function callSpaceV2(
  lrc: string,
  body: MusicBody,
  token?: `hf_${string}`,
): Promise<AudioResult> {
  const { Client } = await import('@gradio/client')
  const format = body.format ?? 'mp3'

  const result = await predictWithRetry(
    () => Client.connect(SPACE_V2, token ? { token } : undefined) as Promise<GradioClient>,
    '/infer_music',
    buildV2Params(lrc, body),
  )

  const first = Array.isArray(result.data) ? result.data[0] : result.data
  const url = (first as { url?: string })?.url
  if (!url) throw new Error('Le studio n’a pas renvoyé de fichier audio')

  const dl = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  if (!dl.ok) throw new Error(`Téléchargement du morceau impossible (${dl.status})`)
  const buf = await dl.arrayBuffer()
  return {
    base64: Buffer.from(buf).toString('base64'),
    bytes: buf.byteLength,
    mime: format === 'mp3' ? 'audio/mpeg' : format === 'ogg' ? 'audio/ogg' : 'audio/wav',
    engine: token ? 'DiffRhythm 2 · compte HF' : 'DiffRhythm 2 · accès public',
  }
}

/**
 * Dernier recours : Space officiel DiffRhythm 1 (95 s max, LRC avec timestamps).
 * Convertit les paroles à sections en LRC horodaté (~4,2 s par ligne, chant régulier).
 */
async function callSpaceV1(lrc: string, body: MusicBody): Promise<AudioResult> {
  const { Client } = await import('@gradio/client')
  const format = body.format ?? 'mp3'

  const result = await predictWithRetry(
    () => Client.connect(SPACE_V1, {}) as Promise<GradioClient>,
    '/infer_music',
    buildV1Params(lrc, body),
  )

  const first = Array.isArray(result.data) ? result.data[0] : result.data
  const url = (first as { url?: string })?.url
  if (!url) throw new Error('Le studio n’a pas renvoyé de fichier audio')

  const dl = await fetch(url, { signal: AbortSignal.timeout(90_000) })
  if (!dl.ok) throw new Error(`Téléchargement du morceau impossible (${dl.status})`)
  const buf = await dl.arrayBuffer()
  return {
    base64: Buffer.from(buf).toString('base64'),
    bytes: buf.byteLength,
    mime: format === 'mp3' ? 'audio/mpeg' : format === 'ogg' ? 'audio/ogg' : 'audio/wav',
    engine: 'DiffRhythm 1 · accès public',
  }
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
        if (body.instrumental) {
          /* Instrumental : pas de parolier — LRC minimal, le prompt « no vocals » dirige le style.
           * DiffRhythm 2 génère alors une pièce musicale sans voix. */
          title = fallbackTitle(body, '')
          lrc = '[start]'
          safeEmit({ stage: 'lyrics', source: 'instrumental', title, lrc })
        } else if (userLyrics && hasV2Sections(userLyrics)) {
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

        /* ---- 2. Studio DiffRhythm — chaîne de repli (quota ZeroGPU ≠ par compte) ----
         *  a) DiffRhythm 2 avec le token HF de l'utilisateur (quota personnel)
         *  b) DiffRhythm 2 en accès public (seau de quota anonyme, distinct)
         *  c) DiffRhythm 1 en accès public (95 s max, LRC horodaté)
         * On ne bascule vers la synthèse locale qu'en dernier ressort. */
        safeEmit({ stage: 'studio', engine: ENGINE })
        const token = await getUserHfToken()
        const attempts: { label: string; run: () => Promise<AudioResult> }[] = [
          ...(token ? [{ label: 'votre compte Hugging Face', run: () => callSpaceV2(lrc, body, token) }] : []),
          { label: 'l’accès public DiffRhythm 2', run: () => callSpaceV2(lrc, body) },
          { label: 'DiffRhythm 1 (extraits ≤ 95 s)', run: () => callSpaceV1(lrc, body) },
        ]

        /* On commence directement par le chemin qui a fonctionné récemment
         * (évite de refaire échouer les tentatives en quota mort à chaque génération). */
        if (lastGoodAttempt > 0 && lastGoodAttempt < attempts.length && Date.now() - lastGoodAt < 10 * 60_000) {
          const [good] = attempts.splice(lastGoodAttempt, 1)
          attempts.unshift(good)
        }

        let audio: AudioResult | undefined
        let lastReason = 'studio indisponible'
        for (let i = 0; i < attempts.length; i++) {
          const attempt = attempts[i]
          try {
            safeEmit({ stage: 'studio-attempt', label: attempt.label })
            audio = await attempt.run()
            lastGoodAttempt = i
            lastGoodAt = Date.now()
            break
          } catch (e) {
            const raw = e instanceof Error ? e.message : String(e)
            lastReason = isQuotaError(raw)
              ? `Quota GPU Hugging Face épuisé pour ${attempt.label}` + (quotaResetIn(raw) ? ` (réinitialisation dans ${quotaResetIn(raw)})` : '')
              : /session not found/i.test(raw)
                ? `session du studio expirée (${attempt.label}) — le Space a redémarré, nouvelles tentatives effectuées`
                : raw.slice(0, 180)
            safeEmit({ stage: 'studio-retry', label: attempt.label, reason: lastReason })
          }
        }

        if (audio) {
          const durationSec = audio.mime === 'audio/mpeg' ? Math.round((audio.bytes * 8) / 128_000) : 0
          safeEmit({
            stage: 'done',
            engine: audio.engine,
            title,
            lrc,
            base64: audio.base64,
            bytes: audio.bytes,
            mime: audio.mime,
            durationSec,
          })
        } else {
          /* Tous les chemins serveur sont morts (quotas IP serveur, Space en redémarrage).
           * Dernière carte : le navigateur de l'utilisateur appelle lui-même le Space —
           * sa connexion possède son propre seau de quota ZeroGPU, indépendant du serveur. */
          safeEmit({
            stage: 'client-studio',
            reason: lastReason,
            title,
            lrc,
            attempts: [
              { space: SPACE_V2, label: 'DiffRhythm 2', params: buildV2Params(lrc, body) },
              { space: SPACE_V1, label: 'DiffRhythm 1 (≤ 95 s)', params: buildV1Params(lrc, body) },
            ],
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
