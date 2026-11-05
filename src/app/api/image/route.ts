import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 180

const SIZES = new Set([
  '1024x1024',
  '768x1344',
  '864x1152',
  '1344x768',
  '1152x864',
  '1440x720',
  '720x1440',
])

/** Nettoie le prompt : caractères typographiques qui cassent parfois l'API image */
function sanitizePrompt(raw: string): string {
  return raw
    .replace(/[«»]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Une tentative moteur intégré — lève en cas d'échec */
async function attempt(prompt: string, size: string): Promise<string> {
  const zai = await ZAI.create()
  const response = await zai.images.generations.create({ prompt, size: size as '1024x1024' })
  const base64 = response.data?.[0]?.base64
  if (!base64) throw new Error('Réponse image vide.')
  return base64
}

/**
 * Inférence Hugging Face (modèle choisi dans le bloc Image ou lien général).
 * POST https://router.huggingface.co/hf-inference/models/<id> { inputs: prompt } → image binaire.
 */
async function attemptHf(hfKey: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${hfKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: prompt, parameters: { width: 1024, height: 1024 } }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`HF ${res.status} — ${detail.slice(0, 120) || 'modèle indisponible sur le routeur d’inférence'}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    // Certains endpoints renvoient une erreur JSON avec un statut 200
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error?.slice(0, 140) || 'Réponse HF inattendue.')
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 512) throw new Error('Image HF vide.')
  return buf.toString('base64')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const size = SIZES.has(body.size) ? body.size : '1024x1024'
    const blockHf: string | undefined = typeof body.hfModel === 'string' && body.hfModel.trim() ? body.hfModel.trim() : undefined
    const globalHf: string | undefined = typeof body.globalHf === 'string' && body.globalHf.trim() ? body.globalHf.trim() : undefined

    if (!rawPrompt) {
      return NextResponse.json({ ok: false, error: 'Prompt requis.' }, { status: 400 })
    }

    const prompt = sanitizePrompt(rawPrompt)
    const chain: { source: string; model?: string; ok: boolean; error?: string }[] = []

    /* ---- 1) Modèles Hugging Face : modèle du bloc → lien général ---- */
    if (blockHf || globalHf) {
      const hfKey = (await db.apiKey.findUnique({ where: { provider: 'huggingface' } }).catch(() => null))?.secret
      if (!hfKey) {
        chain.push({ source: 'hf', ok: false, error: 'aucune clé Hugging Face enregistrée' })
      } else {
        for (const [source, model] of [
          ['bloc', blockHf],
          ['général', globalHf],
        ] as const) {
          if (!model || model === blockHf) continue
          try {
            const base64 = await attemptHf(hfKey, model, prompt)
            return NextResponse.json({
              ok: true,
              base64,
              bytes: Math.round((base64.length * 3) / 4),
              engine: `hf:${model}`,
              chain,
              note: source === 'bloc' ? undefined : `Modèle du bloc indisponible → image générée par le lien général (${model}).`,
            })
          } catch (e) {
            chain.push({ source, model, ok: false, error: e instanceof Error ? e.message.slice(0, 160) : 'erreur HF' })
          }
        }
      }
    }

    /* ---- 2) Moteur intégré : 3 tentatives avec backoff croissant ---- */
    let lastError: unknown = null
    for (let i = 0; i < 3; i++) {
      try {
        const base64 = await attempt(prompt, size)
        const failedHf = chain.find((s) => !s.ok)
        return NextResponse.json({
          ok: true,
          base64,
          bytes: Math.round((base64.length * 3) / 4),
          engine: 'lumo-core',
          chain,
          note: failedHf
            ? `Modèle HF indisponible (${failedHf.error ?? 'erreur'}) → image générée par le moteur intégré.`
            : undefined,
        })
      } catch (e) {
        lastError = e
        if (i < 2) await sleep(1200 * (i + 1))
      }
    }

    const detail =
      lastError instanceof Error ? lastError.message.slice(0, 200) : 'La génération d’image a échoué.'
    return NextResponse.json({ ok: false, error: detail, chain }, { status: 502 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'La génération d’image a échoué.' },
      { status: 500 },
    )
  }
}
