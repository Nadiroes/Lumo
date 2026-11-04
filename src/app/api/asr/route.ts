import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 180

const MAX_BASE64 = 12 * 1024 * 1024 // ~12 Mo encodés (~9 Mo de fichier audio)

/**
 * Découpe la transcription brute en segments horodatés (phrases),
 * durée totale estimée à partir du rythme de parole moyen (~15 caractères/s).
 */
function toSegments(text: string, audioBytes: number): { start: number; end: number; text: string }[] {
  const sentences = text.match(/[^.!?…\n]+[.!?…]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [text]
  // Approximation de la durée : taille WAV 24 kHz mono 16 bits ≈ 48 Ko/s, sinon estimation textuelle
  const estBySize = audioBytes > 0 ? audioBytes / 48_000 : 0
  const estByText = text.length / 15
  const total = Math.max(2, Math.round(Math.max(estBySize, estByText)))
  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1
  let cursor = 0
  return sentences.map((s) => {
    const dur = (s.length / totalChars) * total
    const seg = { start: Math.round(cursor), end: Math.round(cursor + dur), text: s }
    cursor += dur
    return seg
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const base64 = typeof body.base64 === 'string' ? body.base64.replace(/^data:[^,]+,/, '') : ''
    if (!base64) {
      return NextResponse.json({ ok: false, error: 'Fichier audio requis (base64).' }, { status: 400 })
    }
    if (base64.length > MAX_BASE64) {
      return NextResponse.json(
        { ok: false, error: 'Fichier audio trop lourd (maximum ≈ 9 Mo). Convertissez-le en MP3 ou coupez-le.' },
        { status: 413 },
      )
    }

    const audioBytes = Math.round((base64.length * 3) / 4)
    const zai = await ZAI.create()

    let text = ''
    let lastErr: unknown = null
    for (let i = 0; i < 3 && !text.trim(); i++) {
      try {
        const response = await zai.audio.asr.create({ file_base64: base64 })
        text = String(response.text ?? '').trim()
        if (!text) throw new Error('Transcription vide')
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 900 * (i + 1)))
      }
    }
    if (!text.trim()) {
      throw new Error(
        lastErr instanceof Error
          ? `Transcription indisponible (${lastErr.message.slice(0, 120)})`
          : 'Transcription indisponible.',
      )
    }

    const segments = toSegments(text, audioBytes)
    return NextResponse.json({ ok: true, text, segments, bytes: audioBytes })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'La transcription a échoué.' },
      { status: 502 },
    )
  }
}
