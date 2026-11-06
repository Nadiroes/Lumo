import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextRequest, NextResponse } from 'next/server'
import {
  PIPELINES,
  allPipelinesStatus,
  isPipelineReady,
  runPipeline,
  setupEnvironment,
  startWeightsDownload,
  stopJobs,
  type PipelineId,
} from '@/lib/lumo/pipelines'

export const runtime = 'nodejs'
export const maxDuration = 300

const runTool = promisify(execFile)

/**
 * Post-traitement du résultat d'un runner :
 *  - fichier audio FLAC (YuE 2) → conversion MP3 192k + durée réelle (ffprobe) ;
 *  - score mélodie/accords (score.abc) → texte joint à l'artefact ;
 *  - WAV (TTS) / PNG (image) : lecture telle quelle.
 * Le résultat final est sérialisable : {audioBase64|imageBase64, bytes, mime…}.
 */
async function finalizeResult(final: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...final }
  const audio = typeof final.audio === 'string' ? final.audio : ''
  const image = typeof final.image === 'string' ? final.image : ''

  try {
    if (audio && audio.endsWith('.flac')) {
      const dir = await mkdtemp(join(tmpdir(), 'lumo-pipe-'))
      const mp3 = join(dir, 'out.mp3')
      try {
        await runTool('ffmpeg', ['-v', 'error', '-y', '-i', audio, '-c:a', 'libmp3lame', '-b:a', '192k', mp3], { timeout: 120_000 })
        const buf = await readFile(mp3)
        if (buf.byteLength > 1000) {
          out.audioBase64 = buf.toString('base64')
          out.bytes = buf.byteLength
          out.mime = 'audio/mpeg'
          const { stdout } = await runTool(
            'ffprobe',
            ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', mp3],
            { timeout: 15_000 },
          )
          const d = Number(JSON.parse(stdout)?.format?.duration)
          if (Number.isFinite(d) && d > 0) out.durationSec = Math.round(d)
        }
      } finally {
        void rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
    } else if (audio && audio.endsWith('.wav')) {
      const buf = await readFile(audio)
      out.audioBase64 = buf.toString('base64')
      out.bytes = buf.byteLength
      out.mime = 'audio/wav'
    } else if (image && image.endsWith('.png')) {
      const buf = await readFile(image)
      out.imageBase64 = buf.toString('base64')
      out.bytes = buf.byteLength
      out.mime = 'image/png'
    }
  } catch {
    /* post-traitement non bloquant : le résultat brut du runner reste dispo */
  }

  const score = typeof final.score === 'string' ? final.score : ''
  if (score) {
    try {
      out.score = await readFile(score, 'utf8')
    } catch {
      out.score = undefined
    }
  }
  return out
}

/** GET /api/pipelines — état complet : env Python, matériel, poids, jobs */
export async function GET() {
  const status = await allPipelinesStatus()
  return NextResponse.json({ ok: true, ...status })
}

interface PipelineBody {
  action: 'setup' | 'download' | 'run' | 'stop' | 'ready'
  id?: string
  args?: Record<string, unknown>
}

function parseId(raw?: string): PipelineId | null {
  return raw && raw in PIPELINES ? (raw as PipelineId) : null
}

export async function POST(req: NextRequest) {
  let body: PipelineBody
  try {
    body = (await req.json()) as PipelineBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Requête invalide.' }, { status: 400 })
  }

  const id = parseId(body.id)
  switch (body.action) {
    /* Environnement Python partagé (venv + torch CPU + code YuE) */
    case 'setup': {
      const { jobId } = setupEnvironment()
      return NextResponse.json({ ok: true, jobId })
    }

    /* Poids d'un pipeline — vérification disque AVANT tout (aucune limite artificielle) */
    case 'download': {
      if (!id) return NextResponse.json({ ok: false, error: 'Pipeline inconnu.' }, { status: 400 })
      const { jobId } = startWeightsDownload(id)
      return NextResponse.json({ ok: true, jobId })
    }

    /* Exécution (YuE par le studio Labs) — flux NDJSON d'événements */
    case 'run': {
      if (!id) return NextResponse.json({ ok: false, error: 'Pipeline inconnu.' }, { status: 400 })
      const args = body.args ?? {}
      const enc = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false
          const safe = (obj: unknown) => {
            if (!closed) {
              try {
                controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
              } catch {
                closed = true
              }
            }
          }
          const { done } = runPipeline(id, args, (evt) => safe(evt))
          void done
            .then((raw) => finalizeResult(raw))
            .then((final) => {
              safe({ stage: 'done', ...final })
            })
            .catch((e: unknown) => {
              safe({ stage: 'error', message: e instanceof Error ? e.message : 'Échec du pipeline.' })
            })
            .finally(() => {
              closed = true
              try {
                controller.close()
              } catch {
                /* déjà fermé */
              }
            })
        },
        cancel() {
          stopJobs(id)
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

    case 'stop': {
      const n = stopJobs(id ?? undefined)
      return NextResponse.json({ ok: true, stopped: n })
    }

    /* Sonde rapide : pipeline prêt à exécuter ? */
    case 'ready': {
      if (!id) return NextResponse.json({ ok: false, error: 'Pipeline inconnu.' }, { status: 400 })
      return NextResponse.json({ ok: true, ready: await isPipelineReady(id) })
    }

    default:
      return NextResponse.json({ ok: false, error: 'Action inconnue.' }, { status: 400 })
  }
}
