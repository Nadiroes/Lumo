import { NextRequest, NextResponse } from 'next/server'
import { inferHfTask } from '@/lib/lumo/providers'

export const runtime = 'nodejs'

const HF_TIMEOUT = 8000

/** Extensions de poids / fichiers utiles pour faire tourner un modèle en local */
const WEIGHT_RE = /\.(safetensors|gguf|onnx|bin|pth|ckpt|tar|tar\.gz|tgz|msgpack|h5)$/i
const CONFIG_RE = /^(config|tokenizer|tokenizer_config|model|generation_config|preprocessor_config|adapter_config|index)[\w.-]*\.json$/i

function normalize(raw: string): { id: string; kind: 'model' | 'dataset' } {
  let s = raw.trim()
  let kind: 'model' | 'dataset' = 'model'
  // URL complète → identifiant
  const m = s.match(/huggingface\.co\/(datasets\/)?([\w.-]+\/[\w.-]+)/i)
  if (m) {
    kind = m[1] ? 'dataset' : 'model'
    s = m[2]
  }
  if (/^datasets\//i.test(s)) {
    kind = 'dataset'
    s = s.replace(/^datasets\//i, '')
  }
  // Lien vers un fichier précis (blob/resolve/tree) → on garde owner/repo
  s = s.replace(/\/(blob|resolve|tree)\/.*$/i, '')
  s = s.replace(/[?#].*$/, '').replace(/^\//, '').replace(/\/+$/, '')
  return { id: s, kind }
}

function fmtPath(p: string): string {
  return p.replace(/^.*\//, '')
}

/**
 * Reconnaissance complète d'un dépôt Hugging Face :
 * modèle ou dataset, tâche, téléchargements, et LISTE DES FICHIERS
 * (.safetensors, .gguf, .tar, .json…) proposés au branchement ou au téléchargement.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('id') ?? ''
  const { id, kind: forcedKind } = normalize(raw)

  if (!/^[\w.-]+\/[\w.-]+$/.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'Lien invalide. Format attendu : https://huggingface.co/propriétaire/modèle' },
      { status: 400 },
    )
  }

  const headers = { 'User-Agent': 'Lumo/0.1' }
  let kind = forcedKind

  type Meta = { modelId?: string; pipeline_tag?: string; downloads?: number; likes?: number; tags?: string[] }
  let meta: Meta | null = null

  const tryFetch = async (url: string): Promise<Response | null> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(HF_TIMEOUT), headers })
      return res.ok ? res : null
    } catch {
      return null
    }
  }

  // 1) Endpoint selon le type détecté (dataset ou modèle)
  const metaUrl = (k: 'model' | 'dataset') =>
    k === 'dataset' ? `https://huggingface.co/api/datasets/${id}` : `https://huggingface.co/api/models/${id}`
  let res = await tryFetch(metaUrl(kind))
  if (!res) {
    // Le type collé par l’utilisateur peut être faux : on tente l’autre endpoint
    const other: 'model' | 'dataset' = kind === 'model' ? 'dataset' : 'model'
    const res2 = await tryFetch(metaUrl(other))
    if (res2) {
      kind = other
      res = res2
    }
  }
  if (res) meta = (await res.json()) as Meta

  // 3) Arborescence des fichiers (racine du dépôt)
  const treeBase = kind === 'dataset' ? `https://huggingface.co/api/datasets/${id}/tree/main` : `https://huggingface.co/api/models/${id}/tree/main`
  const treeRes = await tryFetch(treeBase)
  let files: { path: string; size: number; ext: string }[] = []
  if (treeRes) {
    try {
      const tree = (await treeRes.json()) as { type: string; path: string; size?: number; lfs?: { size?: number } }[]
      files = tree
        .filter((f) => f.type === 'file')
        .map((f) => ({
          path: f.path,
          size: f.lfs?.size ?? f.size ?? 0,
          ext: fmtPath(f.path).split('.').pop()?.toLowerCase() ?? '',
        }))
        .filter((f) => WEIGHT_RE.test(f.path) || CONFIG_RE.test(fmtPath(f.path)))
        .sort((a, b) => b.size - a.size)
        .slice(0, 24)
    } catch {
      /* arborescence indisponible */
    }
  }

  if (!meta && files.length === 0) {
    // Hub injoignable : heuristique de nommage
    return NextResponse.json({
      ok: true,
      model: { id, task: inferHfTask(id), source: 'heuristique', addedAt: Date.now(), kind: 'model' },
    })
  }

  return NextResponse.json({
    ok: true,
    model: {
      id: meta?.modelId ?? id,
      task: meta?.pipeline_tag ?? inferHfTask(id),
      downloads: meta?.downloads,
      likes: meta?.likes,
      source: 'api',
      addedAt: Date.now(),
      kind,
      files,
    },
  })
}
