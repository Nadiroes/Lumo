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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const size = SIZES.has(body.size) ? body.size : '1024x1024'

    if (!prompt) {
      return NextResponse.json({ ok: false, error: 'Prompt requis.' }, { status: 400 })
    }

    const zai = await ZAI.create()
    const response = await zai.images.generations.create({ prompt, size })
    const base64 = response.data?.[0]?.base64

    if (!base64) {
      return NextResponse.json({ ok: false, error: 'Réponse image vide.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, base64, bytes: Math.round((base64.length * 3) / 4) })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'La génération d’image a échoué.' },
      { status: 500 },
    )
  }
}
