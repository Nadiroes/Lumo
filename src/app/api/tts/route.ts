import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { isPipelineReady, runPipeline } from '@/lib/lumo/pipelines'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Voie locale : pipeline Audio8-TTS-Realistic-Air (0.6B, 23 langues, Apache 2.0)
 * installé sur la machine (vendor/pipelines/audio8-tts). Tourne sur CPU.
 * Retourne un Buffer WAV ou undefined si le pipeline n'est pas prêt / échoue.
 */
async function attemptAudio8(text: string): Promise<{ buf: Buffer; note: string } | undefined> {
  try {
    if (!(await isPipelineReady('audio8-tts'))) return undefined
    const dir = await mkdtemp(join(tmpdir(), 'lumo-tts8-'))
    const final = (await runPipeline('audio8-tts', { text, outputDir: dir })) as Record<string, unknown>
    const audio = String(final.audioBase64 ?? '')
    if (!audio) return undefined
    const buf = Buffer.from(audio, 'base64')
    if (buf.byteLength < 1000) return undefined
    return {
      buf,
      note: 'Synthèse locale Audio8 TTS (0.6B · Realistic Air) — aucune donnée envoyée en ligne.',
    }
  } catch {
    return undefined // bascule silencieuse sur le moteur intégré
  }
}

/** Voix Lumo → voix du moteur TTS (multilingues, lisent le français) */
const VOICE_MAP: Record<string, string> = {
  'Chloé': 'tongtong',
  'Louis': 'jam',
  'Nova': 'luodo',
  'Marc': 'kazi',
  tongtong: 'tongtong',
  chuichui: 'chuichui',
  xiaochen: 'xiaochen',
  jam: 'jam',
  kazi: 'kazi',
  douji: 'douji',
  luodo: 'luodo',
}

const MAX_CHARS = 900 // limite par requête (plafond moteur : 1024)
const MAX_TOTAL = 4000

/** Découpe propre par phrases pour rester sous la limite du moteur */
function splitText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_CHARS) return [clean]
  const sentences = clean.match(/[^.!?…]+[.!?…]+/g) ?? [clean]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length <= MAX_CHARS) {
      cur += s
    } else {
      if (cur.trim()) chunks.push(cur.trim())
      if (s.length > MAX_CHARS) {
        // Phrase très longue : découpe brute par mots
        let rest = s
        while (rest.length > MAX_CHARS) {
          let cut = rest.lastIndexOf(' ', MAX_CHARS)
          if (cut < MAX_CHARS / 2) cut = MAX_CHARS
          chunks.push(rest.slice(0, cut).trim())
          rest = rest.slice(cut)
        }
        cur = rest
      } else {
        cur = s
      }
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.slice(0, 6)
}

/** Offset du chunk « data » dans un fichier WAV */
function dataChunkOffset(buf: Buffer): number {
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'data') return off
    off += 8 + size + (size % 2)
  }
  return -1
}

/** Concatène des WAV de format identique (même voix, même vitesse) */
function concatWavs(buffers: Buffer[]): Buffer {
  if (buffers.length === 1) return buffers[0]
  const headOff = dataChunkOffset(buffers[0])
  if (headOff < 0) return buffers[0]
  const head = buffers[0].subarray(0, headOff + 8)
  const payload = buffers.map((b) => {
    const o = dataChunkOffset(b)
    return o >= 0 ? b.subarray(o + 8, Math.min(b.length, o + 8 + b.readUInt32LE(o + 4))) : Buffer.alloc(0)
  })
  const total = payload.reduce((n, b) => n + b.length, 0)
  const out = Buffer.concat([head, ...payload])
  out.writeUInt32LE(out.length - 8, 4)
  out.writeUInt32LE(total, headOff + 4)
  return out
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const voiceRaw = typeof body.voice === 'string' ? body.voice : 'Chloé'
    const voice = VOICE_MAP[voiceRaw] ?? 'tongtong'
    const speed = Math.min(2, Math.max(0.5, Number(body.speed) || 1))

    if (!text) {
      return NextResponse.json({ ok: false, error: 'Texte requis pour la synthèse vocale.' }, { status: 400 })
    }
    if (text.length > MAX_TOTAL) {
      return NextResponse.json(
        { ok: false, error: `Texte trop long (${text.length} caractères, maximum ${MAX_TOTAL}).` },
        { status: 400 },
      )
    }

    /* ---- 1) Pipeline local Audio8 TTS (si installé) ---- */
    const local8 = await attemptAudio8(text)
    if (local8) {
      const wav = local8.buf
      return NextResponse.json({
        ok: true,
        base64: wav.toString('base64'),
        bytes: wav.length,
        voice,
        chunks: 1,
        engine: 'audio8-tts (local)',
        note: local8.note,
      })
    }

    /* ---- 2) Moteur intégré ---- */
    const zai = await ZAI.create()
    const chunks = splitText(text)
    const buffers: Buffer[] = []

    for (const chunk of chunks) {
      let done = false
      let lastErr: unknown = null
      for (let i = 0; i < 3 && !done; i++) {
        try {
          const response = await zai.audio.tts.create({
            input: chunk,
            voice,
            speed,
            response_format: 'wav',
            stream: false,
          })
          const ab = await response.arrayBuffer()
          const buf = Buffer.from(new Uint8Array(ab))
          if (buf.length < 200) throw new Error('Audio vide')
          buffers.push(buf)
          done = true
        } catch (e) {
          lastErr = e
          await new Promise((r) => setTimeout(r, 800 * (i + 1)))
        }
      }
      if (!done) {
        throw new Error(
          lastErr instanceof Error
            ? `Synthèse vocale indisponible (${lastErr.message.slice(0, 120)})`
            : 'Synthèse vocale indisponible.',
        )
      }
    }

    const wav = concatWavs(buffers)
    return NextResponse.json({ ok: true, base64: wav.toString('base64'), bytes: wav.length, voice, chunks: chunks.length })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'La synthèse vocale a échoué.' },
      { status: 502 },
    )
  }
}
