import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

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

/** Une tentative de génération — lève en cas d'échec */
async function attempt(prompt: string, size: string): Promise<string> {
  const zai = await ZAI.create()
  const response = await zai.images.generations.create({ prompt, size })
  const base64 = response.data?.[0]?.base64
  if (!base64) throw new Error('Réponse image vide.')
  return base64
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rawPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const size = SIZES.has(body.size) ? body.size : '1024x1024'

    if (!rawPrompt) {
      return NextResponse.json({ ok: false, error: 'Prompt requis.' }, { status: 400 })
    }

    const prompt = sanitizePrompt(rawPrompt)

    // 3 tentatives avec backoff croissant — le service image peut être fugacement indisponible
    let lastError: unknown = null
    for (let i = 0; i < 3; i++) {
      try {
        const base64 = await attempt(prompt, size)
        return NextResponse.json({ ok: true, base64, bytes: Math.round((base64.length * 3) / 4) })
      } catch (e) {
        lastError = e
        if (i < 2) await sleep(1200 * (i + 1))
      }
    }

    const detail =
      lastError instanceof Error
        ? lastError.message.slice(0, 200)
        : 'La génération d’image a échoué.'
    return NextResponse.json({ ok: false, error: detail }, { status: 502 })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'La génération d’image a échoué.' },
      { status: 500 },
    )
  }
}
