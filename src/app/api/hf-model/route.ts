import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { inferHfTask } from '@/lib/lumo/providers'

export const runtime = 'nodejs'

const HF_TIMEOUT = 9000
const LIST_LIMIT = 24

/** Extensions de poids / fichiers utiles pour faire tourner un modèle en local */
const WEIGHT_RE = /\.(safetensors|gguf|onnx|bin|pth|ckpt|tar|tar\.gz|tgz|msgpack|h5)$/i
const CONFIG_RE = /^(config|tokenizer|tokenizer_config|model|generation_config|preprocessor_config|adapter_config|index|special_tokens_map|chat_template)[\w.-]*\.(json|jinja)$/i

/** Onglets d'une page HF : huggingface.co/<owner>/<onglet> désigne l'organisation */
const TABS = new Set([
  'models', 'datasets', 'spaces', 'collections', 'discussions', 'commits', 'files',
  'blob', 'resolve', 'tree', 'raw', 'blame', 'settings', 'chat', 'memories', 'notes',
  'activity', 'organizations', 'tasks', 'docs', 'learn', 'pricing', 'search',
])

export type HfKind = 'model' | 'dataset' | 'org'

interface Normalized {
  /** owner/name pour un dépôt, owner seul pour une organisation */
  id: string
  kind: HfKind
  /** sous-dossier du dépôt à explorer (lien vers un fichier précis) */
  dir?: string
  /** vrai si l'utilisateur a collé une URL (plutôt qu'un identifiant brut) */
  fromUrl: boolean
}

function normalize(raw: string): Normalized {
  const fromUrl = /huggingface\.co/i.test(raw)
  let s = raw.trim()

  const clean = (v: string) => v.replace(/[?#].*$/, '').replace(/^\//, '').replace(/\/+$/, '')

  // …/orgs/<nom> → organisation explicite
  const orgM = s.match(/huggingface\.co\/orgs\/([\w.-]+)/i)
  if (orgM) return { id: orgM[1], kind: 'org', fromUrl: true }

  const urlM = s.match(/huggingface\.co\/(datasets\/)?([\w.-]+)(?:\/([\w.-]+))?(?:\/(tree|blob|resolve)\/[^/]+(\/.*))?/i)
  if (urlM) {
    const owner = urlM[2]
    const second = urlM[3]
    const kind: HfKind = urlM[1] ? 'dataset' : second && !TABS.has(second.toLowerCase()) ? 'model' : 'org'
    if (kind === 'model') {
      const dir = urlM[5] ? clean(urlM[5]).replace(/\.(safetensors|gguf|json|md|txt)$/i, '').split('/').slice(0, -1).join('/') : undefined
      return { id: `${owner}/${second}`, kind, dir: dir || undefined, fromUrl: true }
    }
    return { id: owner, kind, fromUrl: true }
  }

  // Identifiants bruts
  s = clean(s).replace(/^datasets\//i, '')
  const parts = s.split('/').filter(Boolean)
  if (parts.length >= 2 && !TABS.has(parts[1].toLowerCase())) return { id: `${parts[0]}/${parts[1]}`, kind: 'model', fromUrl: false }
  if (parts.length >= 1) return { id: parts[0], kind: 'org', fromUrl: false }
  return { id: '', kind: 'model', fromUrl: false }
}

function fmtPath(p: string): string {
  return p.replace(/^.*\//, '')
}

interface Meta {
  modelId?: string
  pipeline_tag?: string
  downloads?: number
  likes?: number
  tags?: string[]
}

interface ListItem {
  id: string
  task: string
  downloads?: number
  likes?: number
}

interface RepoModel {
  id: string
  task: string
  downloads?: number
  likes?: number
  source: 'api' | 'heuristique'
  addedAt: number
  kind: HfKind
  files: { path: string; size: number; ext: string }[]
  dirs: string[]
}

const headers = { 'User-Agent': 'Lumo/0.1' }

/** En-têtes avec token HF (stocké en base) : quotas API très supérieurs à l'anonyme */
async function hfHeaders(): Promise<Record<string, string>> {
  const token = await db.apiKey
    .findUnique({ where: { provider: 'huggingface' }, select: { secret: true } })
    .then((r) => r?.secret)
    .catch(() => undefined)
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers
}

async function tryFetch(url: string, hdrs: Record<string, string>): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(HF_TIMEOUT), headers: hdrs })
    return res.ok ? res : null
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Liste les modèles avec un essai de rattrapage (le Hub limite parfois en rafale — 429) */
async function listModelsRetry(params: string, hdrs: Record<string, string>): Promise<ListItem[]> {
  const first = await listModels(params, hdrs)
  if (first.length > 0) return first
  await sleep(700)
  return listModels(params, hdrs)
}

async function listModels(params: string, hdrs: Record<string, string>): Promise<ListItem[]> {
  const res = await tryFetch(`https://huggingface.co/api/models?${params}`, hdrs)
  if (!res) return []
  try {
    const rows = (await res.json()) as { modelId?: string; id?: string; pipeline_tag?: string; downloads?: number; likes?: number }[]
    return rows
      .filter((r) => r.modelId || r.id)
      .map((r) => ({
        id: String(r.modelId ?? r.id),
        task: r.pipeline_tag ?? 'text-generation',
        downloads: r.downloads,
        likes: r.likes,
      }))
  } catch {
    return []
  }
}

async function fetchRepo(
  id: string,
  kind: 'model' | 'dataset',
  dir: string | undefined,
  hdrs: Record<string, string>,
): Promise<{ meta: Meta | null; files: RepoModel['files']; dirs: string[] } | null> {
  const base = kind === 'dataset' ? 'https://huggingface.co/api/datasets' : 'https://huggingface.co/api/models'
  const metaRes = await tryFetch(`${base}/${id}`, hdrs)
  if (!metaRes) return null
  let meta: Meta | null = null
  try {
    meta = (await metaRes.json()) as Meta
  } catch {
    /* métadonnées illisibles mais le dépôt existe */
  }

  const suffix = dir ? `/tree/main/${dir}` : '/tree/main'
  const files: RepoModel['files'] = []
  const dirs: string[] = []
  const treeRes = await tryFetch(`${base}/${id}${suffix}`, hdrs)
  if (treeRes) {
    try {
      const tree = (await treeRes.json()) as { type: string; path: string; size?: number; lfs?: { size?: number } }[]
      for (const f of tree) {
        if (f.type === 'directory') {
          dirs.push(f.path)
          continue
        }
        if (f.type !== 'file') continue
        if (WEIGHT_RE.test(f.path) || CONFIG_RE.test(fmtPath(f.path))) {
          files.push({
            path: dir ? `${dir}/${f.path}` : f.path,
            size: f.lfs?.size ?? f.size ?? 0,
            ext: fmtPath(f.path).split('.').pop()?.toLowerCase() ?? '',
          })
        }
      }
    } catch {
      /* arborescence indisponible */
    }
  }
  files.sort((a, b) => b.size - a.size)
  return { meta, files: files.slice(0, 24), dirs: dirs.slice(0, 12) }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('id') ?? ''
  const dirParam = req.nextUrl.searchParams.get('dir')?.replace(/^\/+|\/+$/g, '') || undefined
  const { id, kind } = normalize(raw)

  if (!id || !/^[\w.-]+(\/[\w.-]+)?$/.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'Lien invalide. Format attendu : https://huggingface.co/propriétaire/modèle (ou une organisation, ex. https://huggingface.co/deepseek-ai)' },
      { status: 400 },
    )
  }

  const hdrs = await hfHeaders()

  /* ---- 1) Dépôt précis (modèle ou dataset) ---- */
  if (kind === 'model' || kind === 'dataset') {
    let resolved = await fetchRepo(id, kind as 'model' | 'dataset', dirParam, hdrs)
    let effectiveKind: 'model' | 'dataset' = kind as 'model' | 'dataset'
    // Le type collé peut être faux : on tente l'autre endpoint
    if (!resolved && kind === 'model') {
      const asDataset = await fetchRepo(id, 'dataset', dirParam, hdrs)
      if (asDataset) {
        resolved = asDataset
        effectiveKind = 'dataset'
      }
    }
    if (resolved) {
      return NextResponse.json({
        ok: true,
        kind: effectiveKind,
        query: id,
        model: {
          id: resolved.meta?.modelId ?? id,
          task: resolved.meta?.pipeline_tag ?? inferHfTask(id),
          downloads: resolved.meta?.downloads,
          likes: resolved.meta?.likes,
          source: 'api',
          addedAt: Date.now(),
          kind: effectiveKind,
          files: resolved.files,
          dirs: resolved.dirs,
        } satisfies RepoModel,
      })
    }
  }

  /* ---- 2) Organisation : liste des modèles les plus utilisés ---- */
  if (kind === 'org') {
    const models = await listModelsRetry(`author=${encodeURIComponent(id)}&sort=downloads&direction=-1&limit=${LIST_LIMIT}`, hdrs)
    if (models.length > 0) {
      return NextResponse.json({ ok: true, kind: 'org' as const, query: id, models })
    }
  }

  /* ---- 3) Dépôt introuvable → recherche Hub pour PROPOSER les modèles ---- */
  const name = id.includes('/') ? id.split('/')[1] : id
  const owner = id.includes('/') ? id.split('/')[0] : id
  let models = await listModelsRetry(`search=${encodeURIComponent(name)}&limit=${LIST_LIMIT}`, hdrs)
  if (models.length === 0) {
    models = await listModelsRetry(`search=${encodeURIComponent(id)}&limit=${LIST_LIMIT}`, hdrs)
  }
  // Priorité aux modèles du même propriétaire que le lien collé
  models.sort((a, b) => {
    const aOwn = a.id.toLowerCase().startsWith(owner.toLowerCase()) ? 0 : 1
    const bOwn = b.id.toLowerCase().startsWith(owner.toLowerCase()) ? 0 : 1
    return aOwn - bOwn || (b.downloads ?? 0) - (a.downloads ?? 0)
  })
  if (models.length > 0) {
    return NextResponse.json({ ok: true, kind: 'search' as const, query: id, models })
  }

  /* ---- 4) Hub injoignable : heuristique de nommage (comportement historique) ---- */
  if (kind === 'org') {
    return NextResponse.json({ ok: true, kind: 'org' as const, query: id, models: [] })
  }
  return NextResponse.json({
    ok: true,
    kind: 'model' as const,
    query: id,
    model: { id, task: inferHfTask(id), source: 'heuristique', addedAt: Date.now(), kind: 'model' as const, files: [], dirs: [] } satisfies RepoModel,
  })
}
