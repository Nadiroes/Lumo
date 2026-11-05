/**
 * Moteur local Lumo — runtime llama.cpp (CPU) + modèles GGUF.
 *
 * - Runtime : binaire officiel précompilé (llama-server) téléchargé depuis les
 *   releases GitHub de ggml-org/llama.cpp, extrait dans `vendor/llama.cpp/`.
 *   Installation en un clic, aucune compilation, prise en charge immédiate.
 * - Modèles : fichiers .gguf téléchargés directement depuis Hugging Face
 *   (resolve/main), SANS LIMITE DE TAILLE — seule la capacité réelle du disque
 *   est vérifiée avant chaque téléchargement (marge de sécurité incluse).
 * - Exécution : llama-server est lancé en processus local (CPU), l'application
 *   lui parle via son API compatible OpenAI (127.0.0.1, jamais exposé).
 * - Chaîne de repli : ce moteur est la tête de chaîne dans /api/chat
 *   (local → modèle du bloc → lien général HF → clés API → Lumo Core).
 *
 * Tout est persisté côté disque (models/registry.json) : les modèles survivent
 * aux redémarrages, les téléchargements reprennent là où ils se sont arrêtés.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { db } from '@/lib/db'

/* ------------------------------ Types publics ----------------------------- */

export interface LocalModel {
  /** Identifiant stable : `repoId::file` (ex. `Qwen/…-GGUF::qwen2.5-…q4_k_m.gguf`) */
  id: string
  repoId: string
  file: string
  size: number
  addedAt: number
}

export interface LocalDownload {
  id: string
  repoId: string
  file: string
  status: 'download' | 'done' | 'error'
  bytes: number
  total: number
  startedAt: number
  error?: string
  /** Octets/s (mesuré glissant) */
  speed?: number
}

export interface RuntimeInfo {
  installed: boolean
  dir?: string
  version?: string
  url: string
}

export interface DiskInfo {
  totalBytes: number
  freeBytes: number
}

/* -------------------------------- Chemins --------------------------------- */

const ROOT = process.cwd()
const VENDOR_DIR = path.join(ROOT, 'vendor', 'llama.cpp')
const MODELS_DIR = path.join(ROOT, 'models')
const REGISTRY_FILE = path.join(MODELS_DIR, 'registry.json')
const RUNTIME_MARKER = path.join(VENDOR_DIR, 'runtime.json')

/** Release épinglée si l'API GitHub est injoignable (build CPU ubuntu x64) */
const RUNTIME_URL_FALLBACK =
  'https://github.com/ggml-org/llama.cpp/releases/download/b12125/llama-b12125-bin-ubuntu-x64.tar.gz'

/** Marge de sécurité avant tout téléchargement (le système a aussi besoin de place) */
const DISK_MARGIN = 512 * 1024 * 1024

/** Délai maximal de chargement d'un modèle en RAM (CPU) */
const LOAD_TIMEOUT_MS = 150_000

/* ------------------------------- Utilitaires ------------------------------ */

export function localModelId(repoId: string, file: string): string {
  return `${repoId}::${file}`
}

/** Chemin disque d'un modèle. Le pseudo-repo `local` = dépôt manuel à la racine. */
function modelPath(repoId: string, file: string): string {
  const safeFile = file.replace(/^\/+/, '')
  if (repoId === 'local') return path.join(MODELS_DIR, safeFile)
  const safeRepo = repoId.replace(/\.\.+/g, '.')
  return path.join(MODELS_DIR, safeRepo, safeFile)
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '?'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function hfUrl(repoId: string, file: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${file}`
}

async function hfToken(): Promise<string | undefined> {
  try {
    const row = await db.apiKey.findUnique({ where: { provider: 'huggingface' } })
    return row?.secret ?? undefined
  } catch {
    return undefined
  }
}

/* ------------------------------ Disque et RAM ----------------------------- */

export async function diskInfo(dir: string = MODELS_DIR): Promise<DiskInfo> {
  await fsp.mkdir(dir, { recursive: true })
  try {
    const s = await fsp.statfs(dir)
    return { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) }
  } catch {
    // Repli portable : df -k (POSIX)
    const out = await new Promise<string>((resolve, reject) => {
      execFile('df', ['-k', '-P', dir], { timeout: 5000 }, (err, stdout) =>
        err ? reject(err) : resolve(stdout),
      )
    })
    const lines = out.trim().split('\n')
    const cols = (lines[lines.length - 1] ?? '').split(/\s+/)
    return { totalBytes: Number(cols[1]) * 1024, freeBytes: Number(cols[3]) * 1024 }
  }
}

/**
 * Garde-fou AVANT tout téléchargement : le disque doit pouvoir accueillir le
 * fichier + la marge de sécurité. AUCUNE limite de taille artificielle — un
 * modèle de 22 Go ou 80 Go passe, tant que le disque le permet.
 */
export async function assertDiskSpace(neededBytes: number): Promise<DiskInfo> {
  const d = await diskInfo()
  if (d.freeBytes < neededBytes + DISK_MARGIN) {
    throw new Error(
      `Espace disque insuffisant : ${fmtBytes(neededBytes)} nécessaires, ${fmtBytes(d.freeBytes)} libres. ` +
        'Libérez de la place ou choisissez un modèle plus léger.',
    )
  }
  return d
}

export function ramInfo(): DiskInfo {
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() }
}

/* ---------------------------- Runtime llama.cpp --------------------------- */

let serverBinCache: string | null | undefined

async function findServerBin(refresh = false): Promise<string | null> {
  if (serverBinCache !== undefined && !refresh) return serverBinCache
  const direct = path.join(VENDOR_DIR, 'llama-server')
  if (existsSync(direct)) return (serverBinCache = direct)
  try {
    const entries = await fsp.readdir(VENDOR_DIR, { withFileTypes: true, recursive: true })
    for (const e of entries) {
      if (!e.isFile() || (e.name !== 'llama-server' && e.name !== 'llama-server.exe')) continue
      const dir = (e as unknown as { parentPath?: string; path?: string }).parentPath ??
        (e as unknown as { path?: string }).path ?? VENDOR_DIR
      return (serverBinCache = path.join(dir, e.name))
    }
  } catch {
    /* runtime pas encore installé */
  }
  return (serverBinCache = null)
}

/** Asset précompilé adapté à la plateforme courante (build CPU officiel) */
function runtimeAssetPattern(): RegExp | null {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? /^llama-.*-bin-macos-arm64\.tar\.gz$/ : /^llama-.*-bin-macos-x64\.tar\.gz$/
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? /^llama-.*-bin-ubuntu-arm64\.tar\.gz$/ : /^llama-.*-bin-ubuntu-x64\.tar\.gz$/
  }
  return null // Windows : pas d'archive précompilée CPU officielle fiable
}

async function resolveRuntimeUrl(): Promise<string> {
  const want = runtimeAssetPattern()
  if (!want) return RUNTIME_URL_FALLBACK
  try {
    const res = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30', {
      headers: { 'User-Agent': 'Lumo', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      const releases = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] }[]
      for (const r of releases) {
        for (const a of r.assets ?? []) {
          if (want.test(a.name) && !/cuda|vulkan|sycl|rocm|openvino/i.test(a.name)) return a.browser_download_url
        }
      }
    }
  } catch {
    /* repli sur l'URL épinglée */
  }
  return RUNTIME_URL_FALLBACK
}

function execOut(cmd: string, args: string[], timeout = 60_000): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve({ out: String(stdout), err: String(stderr) }),
    )
  })
}

/** llama.cpp affiche sa bannière sur stderr — on lit les deux flux. */
function firstVersionLine(stdout: string, stderr: string): string {
  for (const line of `${stdout}\n${stderr}`.split('\n')) {
    const t = line.trim()
    if (t.toLowerCase().startsWith('version:')) return t.replace(/^version:\s*/i, '').trim()
  }
  return ''
}

export async function runtimeInfo(): Promise<RuntimeInfo> {
  const bin = await findServerBin()
  if (!bin) {
    let pending = RUNTIME_URL_FALLBACK
    try {
      pending = await resolveRuntimeUrl()
    } catch {
      /* URL épinglée */
    }
    return { installed: false, url: pending }
  }
  let version = 'llama.cpp'
  try {
    const { out, err } = await execOut(bin, ['--version'], 10_000)
    version = firstVersionLine(out, err) || 'llama.cpp'
  } catch {
    /* binaire présent mais non exécutable — on tentera au démarrage */
  }
  let url = RUNTIME_URL_FALLBACK
  try {
    url = (JSON.parse(await fsp.readFile(RUNTIME_MARKER, 'utf8')) as { url?: string }).url ?? RUNTIME_URL_FALLBACK
  } catch {
    /* pas de marqueur */
  }
  return { installed: true, dir: path.dirname(bin), version, url }
}

/**
 * Installation du runtime en un clic : téléchargement de l'archive officielle
 * précompilée (~25 Mo), extraction, vérification de llama-server. Idempotent.
 */
export async function setupRuntime(): Promise<RuntimeInfo> {
  const existing = await findServerBin()
  if (existing) return runtimeInfo()

  const want = runtimeAssetPattern()
  if (!want) {
    throw new Error('Runtime précompilé disponible pour Linux et macOS — sur Windows, utilisez WSL2.')
  }
  await fsp.mkdir(VENDOR_DIR, { recursive: true })
  const url = await resolveRuntimeUrl()
  const archive = path.join(VENDOR_DIR, 'runtime.tar.gz')

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('curl', ['-fL', '--retry', '3', '--connect-timeout', '20', '-o', archive, url], {
        stdio: 'ignore',
      })
      child.on('error', reject)
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`Téléchargement du runtime impossible (curl ${code}).`)),
      )
    })
    await execOut('tar', ['-xzf', archive, '-C', VENDOR_DIR])
  } finally {
    await fsp.rm(archive, { force: true }).catch(() => undefined)
  }

  const bin = await findServerBin(true)
  if (!bin) throw new Error('Archive du runtime inattendue : llama-server introuvable après extraction.')
  await execOut('chmod', ['+x', bin]).catch(() => ({ out: '', err: '' }))

  const info = await runtimeInfo()
  await fsp.mkdir(VENDOR_DIR, { recursive: true })
  await fsp.writeFile(RUNTIME_MARKER, JSON.stringify({ url, installedAt: Date.now(), version: info.version }, null, 2))
  return info
}

/* ---------------------------- Registre de modèles ------------------------- */

async function readRegistry(): Promise<LocalModel[]> {
  try {
    const raw = JSON.parse(await fsp.readFile(REGISTRY_FILE, 'utf8')) as Partial<LocalModel>[]
    if (!Array.isArray(raw)) return []
    return raw
      .filter((m) => typeof m.repoId === 'string' && typeof m.file === 'string')
      .map((m) => ({
        id: m.id ?? localModelId(String(m.repoId), String(m.file)),
        repoId: String(m.repoId),
        file: String(m.file),
        size: Number(m.size ?? 0),
        addedAt: Number(m.addedAt ?? 0),
      }))
  } catch {
    return []
  }
}

async function writeRegistry(models: LocalModel[]): Promise<void> {
  await fsp.mkdir(MODELS_DIR, { recursive: true })
  await fsp.writeFile(REGISTRY_FILE, JSON.stringify(models, null, 2))
}

/** Parcours disque : tout .gguf présent (y compris déposé manuellement) est un modèle. */
async function scanGguf(dir: string, depth: number, out: { repoId: string; file: string; addedAt: number }[]): Promise<void> {
  if (depth > 4) return
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'registry.json') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      await scanGguf(full, depth + 1, out)
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) {
      const rel = path.relative(MODELS_DIR, full).split(path.sep)
      const fileName = rel.pop() ?? e.name
      const repoId = rel.length >= 2 ? `${rel[0]}/${rel[1]}` : rel.length === 1 ? rel[0] : 'local'
      const file = rel.length > 2 ? [...rel.slice(2), fileName].join('/') : fileName
      let addedAt = 0
      try {
        addedAt = (await fsp.stat(full)).mtimeMs
      } catch {
        /* ignoré */
      }
      out.push({ repoId, file, addedAt })
    }
  }
}

/** Modèles installés = registre ∪ fichiers .gguf réellement présents sur disque. */
export async function listLocalModels(): Promise<LocalModel[]> {
  await fsp.mkdir(MODELS_DIR, { recursive: true })
  const reg = await readRegistry()
  const byId = new Map<string, LocalModel>(reg.map((m) => [m.id, m]))

  const scanned: { repoId: string; file: string; addedAt: number }[] = []
  await scanGguf(MODELS_DIR, 0, scanned)
  let discovered = false
  for (const s of scanned) {
    const id = localModelId(s.repoId, s.file)
    if (!byId.has(id)) {
      byId.set(id, { id, repoId: s.repoId, file: s.file, size: 0, addedAt: s.addedAt || Date.now() })
      discovered = true
    }
  }

  const models: LocalModel[] = []
  for (const m of byId.values()) {
    try {
      const st = await fsp.stat(modelPath(m.repoId, m.file))
      if (st.isFile()) models.push({ ...m, size: st.size })
    } catch {
      /* le fichier a disparu — retiré de la liste */
    }
  }
  models.sort((a, b) => b.addedAt - a.addedAt)

  if (discovered || models.length !== reg.length) await writeRegistry(models)
  return models
}

/** Retrouve un modèle local installé correspondant à un dépôt HF (lien de bloc). */
export async function findLocalForRepo(repoRef: string): Promise<LocalModel | undefined> {
  const models = await listLocalModels()
  if (!models.length) return undefined
  const ref = repoRef.trim().replace(/\/+$/, '').toLowerCase()
  if (!ref) return undefined
  const base = ref.split('/').pop() ?? ''
  return (
    models.find((m) => m.repoId.toLowerCase() === ref) ??
    (base.length > 2 ? models.find((m) => m.repoId.toLowerCase().endsWith(`/${base}`) || m.repoId.toLowerCase() === base) : undefined) ??
    (base.length > 2 ? models.find((m) => m.file.toLowerCase().includes(base)) : undefined)
  )
}

export async function removeLocalModel(id: string): Promise<void> {
  const model = (await listLocalModels()).find((m) => m.id === id)
  await stopEngine(id)
  if (!model) throw new Error('Modèle introuvable.')
  const dest = modelPath(model.repoId, model.file)
  if (!path.resolve(dest).startsWith(path.resolve(MODELS_DIR))) {
    throw new Error('Chemin de modèle invalide.')
  }
  await fsp.rm(dest, { force: true })
  // Nettoyage des dossiers devenus vides
  let dir = path.dirname(dest)
  while (path.resolve(dir).startsWith(path.resolve(MODELS_DIR)) && path.resolve(dir) !== path.resolve(MODELS_DIR)) {
    try {
      await fsp.rmdir(dir)
    } catch {
      break
    }
    dir = path.dirname(dir)
  }
  await writeRegistry((await readRegistry()).filter((m) => m.id !== id))
}

/* ----------------------------- Téléchargements ---------------------------- */

const downloads = new Map<string, LocalDownload>()

export function allDownloads(): LocalDownload[] {
  return [...downloads.values()].map((d) => ({ ...d }))
}

export function downloadState(id: string): LocalDownload | undefined {
  const d = downloads.get(id)
  return d ? { ...d } : undefined
}

/**
 * Téléchargement HF direct (resolve/main), avec reprise automatique (Range) sur
 * téléchargement partiel et jeton HF optionnel pour les dépôts privés/gated.
 * Tourne en arrière-plan : la requête HTTP rend la main immédiatement.
 */
export async function startDownload(repoId: string, file: string, total?: number): Promise<void> {
  const id = localModelId(repoId, file)
  const cur = downloads.get(id)
  if (cur && cur.status === 'download') return // déjà en cours

  const dest = modelPath(repoId, file)
  if (!path.resolve(dest).startsWith(path.resolve(MODELS_DIR))) {
    throw new Error('Chemin de destination invalide.')
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  // Reprise sur le fichier partiel (.part) — le .gguf final n'apparaît qu'une fois complet
  const part = `${dest}.part`
  let resumeFrom = 0
  try {
    resumeFrom = (await fsp.stat(part)).size
  } catch {
    /* nouveau fichier */
  }

  const st: LocalDownload = {
    id,
    repoId,
    file,
    status: 'download',
    bytes: resumeFrom,
    total: total ?? 0,
    startedAt: Date.now(),
  }
  downloads.set(id, st)
  void pump(st, hfUrl(repoId, file), dest, part, resumeFrom)
}

async function pump(st: LocalDownload, url: string, dest: string, part: string, resumeFrom: number): Promise<void> {
  let lastTick = Date.now()
  let lastBytes = resumeFrom
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Lumo' }
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`
    const token = await hfToken()
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(url, { headers, redirect: 'follow' })

    // 416 : le fichier local est déjà complet
    if (res.status === 416 && resumeFrom > 0) {
      await fsp.rename(part, dest)
      st.status = 'done'
      st.bytes = resumeFrom
      st.total = resumeFrom
      await registerModel(st)
      return
    }
    if (!res.ok || !res.body) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'Accès refusé par Hugging Face (dépôt privé ou gated — vérifiez le jeton HF dans Paramètres).'
          : `Hugging Face a répondu ${res.status}.`,
      )
    }

    // Taille totale : Content-Range (reprise) ou Content-Length (début)
    const contentRange = res.headers.get('content-range')
    const contentLength = Number(res.headers.get('content-length') ?? 0)
    if (contentRange) {
      const t = Number(contentRange.split('/')[1])
      if (Number.isFinite(t) && t > 0) st.total = t
    } else if (contentLength > 0) {
      st.total = resumeFrom + contentLength
    }

    // Si le serveur a ignoré la reprise (200 au lieu de 206), on repart de zéro
    const ranged = resumeFrom > 0 && res.status === 206
    if (resumeFrom > 0 && !ranged) {
      resumeFrom = 0
      st.bytes = 0
      lastBytes = 0
    }

    const nodeStream = Readable.fromWeb(res.body as unknown as NodeWebReadableStream<Uint8Array>)
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        st.bytes += chunk.length
        const now = Date.now()
        if (now - lastTick >= 800) {
          st.speed = Math.round(((st.bytes - lastBytes) * 1000) / (now - lastTick))
          lastTick = now
          lastBytes = st.bytes
        }
        cb(null, chunk)
      },
    })
    const ws = createWriteStream(part, { flags: ranged ? 'a' : 'w' })
    await pipeline(nodeStream, counter, ws)

    st.status = 'done'
    st.speed = undefined
    if (st.total > 0) st.bytes = st.total
    await fsp.rename(part, dest)
    await registerModel(st)
  } catch (e) {
    st.status = 'error'
    st.speed = undefined
    st.error = e instanceof Error ? e.message : 'Téléchargement interrompu.'
  }
}

async function registerModel(st: LocalDownload): Promise<void> {
  const reg = await readRegistry()
  const size = st.total > 0 ? st.total : st.bytes
  const i = reg.findIndex((m) => m.id === st.id)
  const entry: LocalModel = { id: st.id, repoId: st.repoId, file: st.file, size, addedAt: Date.now() }
  if (i >= 0) reg[i] = entry
  else reg.unshift(entry)
  await writeRegistry(reg)
}

/* ------------------------------ Moteur (serveur) -------------------------- */

interface Engine {
  id: string
  port: number
  child: ChildProcess
  startedAt: number
  ready: boolean
}

const engines = new Map<string, Engine>()
const stderrTail = new Map<string, string>()

export function engineStatus(id: string): { running: boolean; port?: number } {
  const e = engines.get(id)
  if (!e || e.child.exitCode !== null) return { running: false }
  return { running: true, port: e.port }
}

async function freePort(start: number): Promise<number> {
  for (let p = start; p < start + 64; p++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, '127.0.0.1')
    })
    if (ok) return p
  }
  throw new Error('Aucun port libre pour le moteur local.')
}

async function waitHealthy(engine: Engine, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const child = engine.child
    if (!child || child.exitCode !== null) {
      const tail = (stderrTail.get(engine.id) ?? '').trim().split('\n').filter(Boolean).pop()
      throw new Error(
        `llama-server s'est arrêté (${child?.exitCode ?? child?.signalCode ?? '?'})${tail ? ` — ${tail.slice(0, 200)}` : ''}`,
      )
    }
    try {
      const res = await fetch(`http://127.0.0.1:${engine.port}/health`, { signal: AbortSignal.timeout(1200) })
      if (res.ok) {
        engine.ready = true
        return
      }
    } catch {
      /* pas encore prêt */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Le modèle ${label} met trop de temps à se charger en RAM (CPU). ` +
          'Le chargement continue en arrière-plan — réessayez dans un instant.',
      )
    }
    await new Promise((r) => setTimeout(r, 700))
  }
}

async function killEngine(e: Engine): Promise<void> {
  const child = e.child
  if (!child || child.exitCode !== null) {
    engines.delete(e.id)
    return
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    try {
      child.kill('SIGTERM')
    } catch {
      /* déjà mort */
    }
    setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL')
        } catch {
          /* déjà mort */
        }
      }
      setTimeout(resolve, 1500)
    }, 3000)
  })
  engines.delete(e.id)
}

/**
 * Démarre (ou réutilise) le llama-server du modèle : chargement en RAM puis
 * /health OK. Un seul modèle à la fois (CPU/RAM) — le précédent est arrêté.
 */
export async function ensureEngine(id: string): Promise<{ port: number }> {
  const bin = await findServerBin()
  if (!bin) throw new Error('Runtime llama.cpp non installé — cliquez d’abord sur « Installer le runtime ».')
  const model = (await listLocalModels()).find((m) => m.id === id)
  if (!model) throw new Error('Modèle local introuvable — installez-le d’abord.')

  const cur = engines.get(id)
  if (cur && cur.child.exitCode === null) {
    if (!cur.ready) await waitHealthy(cur, model.file, LOAD_TIMEOUT_MS)
    return { port: cur.port }
  }

  // Un seul moteur actif à la fois : on arrête proprement les autres
  for (const e of [...engines.values()]) {
    if (e.id !== id && e.child.exitCode === null) await killEngine(e)
  }

  const port = await freePort(8710)
  const dest = modelPath(model.repoId, model.file)
  const threads = Math.max(1, Math.min(os.cpus().length, 8))
  const child = spawn(
    bin,
    ['-m', dest, '--host', '127.0.0.1', '--port', String(port), '-c', '4096', '-t', String(threads), '--no-webui'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  stderrTail.set(id, '')
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail.set(id, ((stderrTail.get(id) ?? '') + chunk.toString()).slice(-900))
  })
  const engine: Engine = { id, port, child, startedAt: Date.now(), ready: false }
  engines.set(id, engine)

  await waitHealthy(engine, model.file, LOAD_TIMEOUT_MS)
  return { port }
}

export async function stopEngine(id: string): Promise<void> {
  const e = engines.get(id)
  if (!e) return
  await killEngine(e)
  stderrTail.delete(id)
}

/* ------------------------------ Génération -------------------------------- */

/**
 * Conversation via le moteur local (API compatible OpenAI de llama-server).
 * Démarre le modèle si nécessaire — la première génération inclut le chargement.
 */
export async function chatLocal(
  localId: string,
  system: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const { port } = await ensureEngine(localId)
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, ...history.slice(-12)],
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
    }),
    signal: AbortSignal.timeout(110_000),
  })
  const json = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    | null
  const content = json?.choices?.[0]?.message?.content
  if (!res.ok || typeof content !== 'string' || !content.trim()) {
    throw new Error(json?.error?.message || `Le moteur local a répondu ${res.status}.`)
  }
  return content.trim()
}
