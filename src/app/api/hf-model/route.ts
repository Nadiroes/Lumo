import { NextRequest, NextResponse } from 'next/server'
import { inferHfTask } from '@/lib/lumo/providers'

export const runtime = 'nodejs'

/**
 * Reconnaissance d’un modèle Hugging Face à partir de son identifiant.
 * Tente l’API publique du Hub, sinon retombe sur une heuristique de nommage.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('id') ?? ''
  const id = raw
    .replace(/^https?:\/\/(huggingface\.co|hugging\.co|hf\.co)\//i, '')
    .replace(/^https?:\/\/\S*?huggingface\.co\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/^\//, '')
    .trim()

  if (!/^[\w.-]+\/[\w.-]+$/.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'Lien invalide. Format attendu : https://huggingface.co/propriétaire/modèle' },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`https://huggingface.co/api/models/${id}`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Lumo/0.1' },
    })
    if (res.ok) {
      const j = (await res.json()) as {
        modelId?: string
        pipeline_tag?: string
        downloads?: number
        likes?: number
        tags?: string[]
      }
      return NextResponse.json({
        ok: true,
        model: {
          id: j.modelId ?? id,
          task: j.pipeline_tag ?? inferHfTask(id),
          downloads: j.downloads,
          likes: j.likes,
          source: 'api',
          addedAt: Date.now(),
        },
      })
    }
  } catch {
    /* Hub injoignable : on passe en heuristique */
  }

  return NextResponse.json({
    ok: true,
    model: { id, task: inferHfTask(id), source: 'heuristique', addedAt: Date.now() },
  })
}
