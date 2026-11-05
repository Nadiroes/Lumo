import { NextRequest, NextResponse } from 'next/server'
import {
  allDownloads,
  assertDiskSpace,
  diskInfo,
  downloadState,
  engineStatus,
  ensureEngine,
  listLocalModels,
  localModelId,
  ramInfo,
  removeLocalModel,
  runtimeInfo,
  setupRuntime,
  startDownload,
  stopEngine,
} from '@/lib/lumo/local-engine'

export const runtime = 'nodejs'
export const maxDuration = 300

/** GET /api/local — état complet : runtime, disque, RAM, modèles, téléchargements */
export async function GET() {
  const [runtime, disk, models] = await Promise.all([runtimeInfo(), diskInfo(), listLocalModels()])
  return NextResponse.json({
    ok: true,
    runtime,
    disk,
    ram: ramInfo(),
    models: models.map((m) => ({
      id: m.id,
      repoId: m.repoId,
      file: m.file,
      size: m.size,
      addedAt: m.addedAt,
      engine: engineStatus(m.id),
    })),
    downloads: allDownloads(),
  })
}

interface LocalActionBody {
  action: 'setup-runtime' | 'download' | 'start' | 'stop' | 'remove'
  repoId?: string
  file?: string
  sizeBytes?: number
  id?: string
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/

export async function POST(req: NextRequest) {
  let body: LocalActionBody
  try {
    body = (await req.json()) as LocalActionBody
  } catch {
    return NextResponse.json({ ok: false, error: 'Requête invalide.' }, { status: 400 })
  }

  try {
    switch (body.action) {
      /* Installation du runtime llama.cpp (une seule fois) */
      case 'setup-runtime': {
        const info = await setupRuntime()
        return NextResponse.json({ ok: true, runtime: info })
      }

      /* Téléchargement d'un GGUF HF — vérification disque AVANT tout */
      case 'download': {
        const repoId = String(body.repoId ?? '')
        const file = String(body.file ?? '')
        if (!REPO_RE.test(repoId) || !file || file.includes('..')) {
          return NextResponse.json({ ok: false, error: 'Modèle ou fichier invalide.' }, { status: 400 })
        }
        const size = Number(body.sizeBytes ?? 0)
        // Refus immédiat si le disque ne peut pas accueillir le fichier
        if (size > 0) await assertDiskSpace(size)
        await startDownload(repoId, file, size > 0 ? size : undefined)
        const st = downloadState(localModelId(repoId, file))
        return NextResponse.json({ ok: true, started: true, download: st })
      }

      /* Démarrage du modèle (chargement en RAM + /health) */
      case 'start': {
        const id = String(body.id ?? '')
        if (!id) return NextResponse.json({ ok: false, error: 'Identifiant requis.' }, { status: 400 })
        const engine = await ensureEngine(id)
        return NextResponse.json({ ok: true, port: engine.port, running: true })
      }

      case 'stop': {
        await stopEngine(String(body.id ?? ''))
        return NextResponse.json({ ok: true, running: false })
      }

      case 'remove': {
        await removeLocalModel(String(body.id ?? ''))
        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ ok: false, error: 'Action inconnue.' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur du moteur local.' },
      { status: 400 },
    )
  }
}
