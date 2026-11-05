/**
 * Pipelines locaux Lumo — modèles Python open source exécutés hors ligne.
 *
 * Un pipeline = environnement Python partagé (vendor/pipelines/venv) + poids HF
 * (vendor/pipelines/<id>/weights) + runner (scripts/lumo-pipelines/*.py).
 *
 *  - `yue`            : YuE 2 (m-a-p/YuE2-3B + YuE2-Vae) — chansons complètes
 *                       (paroles + style → score → audio 48 kHz). Bloc Labs.
 *  - `audio8-tts`     : Audio8-TTS-Realistic-Air (0.6B, 23 langues, clonage de voix).
 *  - `moss-image`     : MOSS-Image-SFT (text-to-image 5B, diffusers).
 *  - `embeddinggemma` : EmbeddingGemma 2 (embeddings multimodaux 744M).
 *
 * Téléchargements via huggingface_hub (reprise intégrée), espace disque vérifié
 * AVANT chaque téléchargement (aucune limite artificielle). Un seul travail à la
 * fois : l'inférence musicale/image est lourde, les jobs se mettent en file.
 */

import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertDiskSpace, diskInfo, ramInfo } from './local-engine'
import { db } from '@/lib/db'

/* ------------------------------ Types publics ----------------------------- */

export type PipelineId = 'yue' | 'audio8-tts' | 'moss-image' | 'embeddinggemma'

export interface PipelineWeightSpec {
  /** Dépôt Hugging Face */
  repo: string
  /** Chemins autorisés (patterns huggingface_hub allow_patterns) */
  patterns: string[]
  /** Taille approximative à télécharger (octets) */
  bytes: number
}

export interface PipelineDef {
  id: PipelineId
  label: string
  kind: 'music' | 'tts' | 'image' | 'embedding'
  description: string
  weights: PipelineWeightSpec[]
  totalBytes: number
  /** RAM totale minimale conseillée pour l'inférence */
  ramMinBytes: number
  gpuRecommended: boolean
  /** Clone git nécessaire (code du modèle) */
  clone?: { url: string; dir: string }
  /** Runner à exécuter (scripts/lumo-pipelines/<runner>) */
  runner: string
}

export interface PipelineJob {
  id: string
  pipelineId: PipelineId
  kind: 'setup' | 'download' | 'run'
  status: 'run' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  lines: string[]
  error?: string
}

export interface PipelineHardware {
  gpu: boolean
  ramTotalBytes: number
  ramOk: boolean
  diskFreeBytes: number
  diskOk: boolean
}

export interface PipelineStatus {
  id: PipelineId
  label: string
  kind: PipelineDef['kind']
  description: string
  totalBytes: number
  weightsDir: string
  /** Somme réelle des poids présents sur le disque */
  bytesDownloaded: number
  weightsComplete: boolean
  ready: boolean
  hardware: PipelineHardware
  jobs: PipelineJob[]
}

/* ------------------------------- Définitions ------------------------------ */

const GB = 1e9

export const PIPELINES: Record<PipelineId, PipelineDef> = {
  yue: {
    id: 'yue',
    label: 'YuE 2 — studio musical open source',
    kind: 'music',
    description:
      'Paroles + style → plan mélodie/accords éditable → chanson complète chantée 48 kHz (YuE2-3B + décodeur YuE2-Vae). Option 2 du studio Labs, 100 % locale.',
    weights: [
      {
        repo: 'm-a-p/YuE2-3B',
        patterns: ['*.json', '*.py', '*.tiktoken', 'model.safetensors'],
        bytes: Math.round(7.3 * GB),
      },
      { repo: 'm-a-p/YuE2-Vae', patterns: ['*.json', 'model.safetensors'], bytes: Math.round(0.55 * GB) },
    ],
    totalBytes: Math.round(7.95 * GB),
    ramMinBytes: Math.round(16 * GB),
    gpuRecommended: true,
    clone: { url: 'https://github.com/multimodal-art-projection/YuE.git', dir: 'YuE' },
    runner: 'yue_run.py',
  },
  'audio8-tts': {
    id: 'audio8-tts',
    label: 'Audio8 TTS Realistic Air (0.6B)',
    kind: 'tts',
    description:
      'Synthèse vocale réaliste en 23 langues (français inclus), clonage de voix zéro-shot à partir d’un extrait + transcription, sortie 44,1 kHz.',
    weights: [
      {
        repo: 'Edge0/Audio8-TTS-Realistic-Air',
        patterns: ['*.json', '*.py', '*.safetensors', 'codec.pth'],
        bytes: Math.round(2.6 * GB),
      },
    ],
    totalBytes: Math.round(2.6 * GB),
    ramMinBytes: Math.round(4 * GB),
    gpuRecommended: false,
    runner: 'tts_run.py',
  },
  'moss-image': {
    id: 'moss-image',
    label: 'MOSS-Image SFT (5B)',
    kind: 'image',
    description:
      'Génération d’images à partir du texte (5B, pipeline diffusers) — rendu de texte fiable dans les images, affiches et interfaces.',
    weights: [
      {
        repo: 'OpenMOSS-Team/MOSS-Image-SFT',
        patterns: ['*.json', '*.txt', 'transformer/*', 'text_encoder/*', 'vae/*', 'tokenizer/*'],
        bytes: Math.round(27.3 * GB),
      },
    ],
    totalBytes: Math.round(27.3 * GB),
    ramMinBytes: Math.round(12 * GB),
    gpuRecommended: true,
    runner: 'image_run.py',
  },
  embeddinggemma: {
    id: 'embeddinggemma',
    label: 'EmbeddingGemma 2 (744M)',
    kind: 'embedding',
    description:
      'Embeddings multimodaux (texte, image, audio, vidéo) pour la recherche sémantique dans vos créations — classement, similarité, regroupement.',
    weights: [
      {
        repo: 'google/embeddinggemma-2',
        patterns: ['*.json', '*.model', '*.jinja', 'model.safetensors'],
        bytes: Math.round(1.55 * GB),
      },
    ],
    totalBytes: Math.round(1.55 * GB),
    ramMinBytes: Math.round(3 * GB),
    gpuRecommended: false,
    runner: 'embed_run.py',
  },
}

/* --------------------------------- Chemins -------------------------------- */

const ROOT = process.cwd()
const PIPES_DIR = path.join(ROOT, 'vendor', 'pipelines')
const VENV_DIR = path.join(PIPES_DIR, 'venv')
const STATUS_FILE = path.join(PIPES_DIR, 'status.json')
const RUNNERS_DIR = path.join(ROOT, 'scripts', 'lumo-pipelines')
const YUE_SRC_DIR = path.join(ROOT, 'vendor', 'yue', 'YuE')

const venvBin = (...p: string[]) => path.join(VENV_DIR, 'bin', ...p)

function weightsDir(id: PipelineId): string {
  return path.join(PIPES_DIR, id, 'weights')
}

/* ------------------------------ État persisté ----------------------------- */

interface PersistedStatus {
  env?: { installed?: boolean; error?: string; installedAt?: number }
}

let statusCache: PersistedStatus | null = null

async function readStatus(): Promise<PersistedStatus> {
  if (statusCache) return statusCache
  try {
    statusCache = JSON.parse(await fsp.readFile(STATUS_FILE, 'utf8')) as PersistedStatus
  } catch {
    statusCache = {}
  }
  return statusCache
}

async function writeStatus(patch: Partial<PersistedStatus>): Promise<void> {
  const st = await readStatus()
  statusCache = { ...st, ...patch }
  await fsp.mkdir(PIPES_DIR, { recursive: true })
  await fsp.writeFile(STATUS_FILE, JSON.stringify(statusCache, null, 2))
}

/* --------------------------------- Jobs ----------------------------------- */

const jobs = new Map<string, PipelineJob>()
let jobSeq = 0
/** File d'attente : un seul travail lourd à la fois (RAM/CPU). */
let queue: Promise<void> = Promise.resolve()

function newJob(pipelineId: PipelineId, kind: PipelineJob['kind']): PipelineJob {
  const job: PipelineJob = {
    id: `${pipelineId}-${kind}-${++jobSeq}`,
    pipelineId,
    kind,
    status: 'run',
    startedAt: Date.now(),
    lines: [],
  }
  jobs.set(job.id, job)
  // Taille de journal plafonnée
  if (jobs.size > 24) {
    for (const old of [...jobs.values()].filter((j) => j.status !== 'run').slice(0, jobs.size - 24)) {
      jobs.delete(old.id)
    }
  }
  return job
}

function finishJob(job: PipelineJob, error?: string): void {
  job.status = error ? 'error' : 'done'
  job.endedAt = Date.now()
  if (error) job.error = error.slice(0, 400)
}

function jobLine(job: PipelineJob, line: string): void {
  const l = line.replace(/\s+$/, '')
  if (!l) return
  job.lines.push(l.slice(0, 300))
  if (job.lines.length > 220) job.lines.splice(0, job.lines.length - 220)
}

/** Abonnement aux événements d'un run (NDJSON vers la route) */
export type RunListener = (evt: Record<string, unknown>) => void
const runListeners = new Map<string, RunListener>()

function emit(job: PipelineJob, evt: Record<string, unknown>): void {
  runListeners.get(job.id)?.(evt)
}

interface SpawnOpts {
  cwd?: string
  env?: Record<string, string>
  onLine?: (line: string) => void
  stdin?: string
  timeoutMs?: number
}

/** Spawn avec capture ligne à ligne (stdout+stderr) — rejette si code ≠ 0 */
function spawnLive(cmd: string, args: string[], opts: SpawnOpts = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) opts.onLine?.(line)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.on('error', reject)
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* déjà mort */
          }
          reject(new Error(`Délai dépassé (${Math.round(opts.timeoutMs! / 1000)} s)`))
        }, opts.timeoutMs)
      : undefined
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve(0)
      else reject(new Error(`Processus terminé (code ${code ?? '?'})`))
    })
    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin)
      child.stdin?.end()
    } else {
      child.stdin?.end()
    }
  })
}

function exec(cmd: string, args: string[], timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    )
  })
}

/* ------------------------------- Matériel --------------------------------- */

let gpuCache: boolean | undefined

async function hasGpu(): Promise<boolean> {
  if (gpuCache !== undefined) return gpuCache
  try {
    await exec('nvidia-smi', ['-L'], 4000)
    gpuCache = true
  } catch {
    gpuCache = false
  }
  return gpuCache
}

async function hardwareFor(def: PipelineDef): Promise<PipelineHardware> {
  const [disk, gpu] = await Promise.all([diskInfo(PIPES_DIR), hasGpu()])
  const ram = ramInfo()
  return {
    gpu,
    ramTotalBytes: ram.totalBytes,
    ramOk: ram.totalBytes >= def.ramMinBytes,
    diskFreeBytes: disk.freeBytes,
    diskOk: disk.freeBytes >= def.totalBytes + 512 * 1024 * 1024,
  }
}

/* --------------------------- Environnement Python ------------------------- */

const BASE_PKGS = [
  'transformers==4.57.6',
  'huggingface-hub==0.36.2',
  'safetensors==0.7.0',
  'tiktoken==0.12.0',
  'numpy==2.2.6',
  'soundfile==0.13.1',
  'accelerate==1.13.0',
  'pillow',
  'diffusers',
]

function venvReady(): boolean {
  return existsSync(venvBin('python'))
}

/** Environnement partagé : venv + torch CPU + dépendances + code YuE (clone) */
async function ensureEnv(job: PipelineJob): Promise<void> {
  const st = await readStatus()
  if (st.env?.installed && venvReady()) return

  if (!venvReady()) {
    jobLine(job, '[env] création du venv Python 3…')
    await spawnLive('python3', ['-m', 'venv', VENV_DIR])
  }
  jobLine(job, '[env] pip à jour…')
  await spawnLive(venvBin('pip'), ['install', '--upgrade', 'pip', '-q'])

  if (!existsSync(path.join(VENV_DIR, '.torch-cpu'))) {
    jobLine(job, '[env] installation de PyTorch (build CPU, ~200 Mo)…')
    await spawnLive(
      venvBin('pip'),
      ['install', '--index-url', 'https://download.pytorch.org/whl/cpu', 'torch==2.10.0', 'torchaudio', '-q'],
      { timeoutMs: 900_000 },
    )
    await fsp.writeFile(path.join(VENV_DIR, '.torch-cpu'), new Date().toISOString())
  }

  jobLine(job, '[env] installation des dépendances (transformers, diffusers…)…')
  await spawnLive(venvBin('pip'), ['install', ...BASE_PKGS, '-q'], { timeoutMs: 900_000 })

  /* Code YuE : clone GitHub + package d'inférence (sans dépendances, déjà installées) */
  if (!existsSync(path.join(YUE_SRC_DIR, 'pyproject.toml'))) {
    jobLine(job, '[env] clone du dépôt YuE (multimodal-art-projection/YuE)…')
    await fsp.mkdir(path.dirname(YUE_SRC_DIR), { recursive: true })
    await spawnLive('git', ['clone', '--depth', '1', PIPELINES.yue.clone!.url, YUE_SRC_DIR], { timeoutMs: 300_000 })
  }
  if (!existsSync(path.join(VENV_DIR, '.yue2-installed'))) {
    jobLine(job, '[env] installation du package yue2 (mode sans dépendances)…')
    await spawnLive(venvBin('pip'), ['install', YUE_SRC_DIR, '--no-deps', '-q'], { timeoutMs: 300_000 })
    await fsp.writeFile(path.join(VENV_DIR, '.yue2-installed'), new Date().toISOString())
  }

  await writeStatus({ env: { installed: true, installedAt: Date.now() } })
  jobLine(job, '[env] environnement prêt ✓')
}

/** Environnement : planifie le travail (idempotent, un seul à la fois) */
export function setupEnvironment(): { jobId: string } {
  const job = newJob('yue', 'setup') // le journal d'env est rattaché au pipeline yue (chef de file)
  queue = queue
    .then(async () => {
      try {
        await ensureEnv(job)
        finishJob(job)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        finishJob(job, msg)
        await writeStatus({ env: { installed: false, error: msg } }).catch(() => undefined)
      }
    })
    .catch(() => undefined)
  return { jobId: job.id }
}

/** Token HF de l'utilisateur (dépôts gated + quota plus élevé sur les téléchargements) */
async function hfToken(): Promise<string | undefined> {
  try {
    const row = await db.apiKey.findUnique({ where: { provider: 'huggingface' } })
    return row?.secret ?? undefined
  } catch {
    return undefined
  }
}

/* ------------------------------ Téléchargements --------------------------- */

/** Somme réelle des poids présents sur le disque */
async function weightsOnDisk(id: PipelineId): Promise<number> {
  let total = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile()) {
        try {
          total += (await fsp.stat(full)).size
        } catch {
          /* ignoré */
        }
      }
    }
  }
  await walk(weightsDir(id), 0)
  return total
}

/** Télécharge tous les poids du pipeline (huggingface_hub : reprise intégrée) */
async function downloadWeights(job: PipelineJob, def: PipelineDef): Promise<void> {
  await assertDiskSpace(def.totalBytes)
  await ensureEnv(job)
  for (const spec of def.weights) {
    const dir = path.join(weightsDir(def.id), spec.repo.replaceAll('/', '__'))
    await fsp.mkdir(dir, { recursive: true })
    jobLine(job, `[poids] ${spec.repo} → ${path.relative(ROOT, dir)} (${(spec.bytes / GB).toFixed(1)} Go)`)
    const args = [
      path.join(RUNNERS_DIR, 'hf_fetch.py'),
      '--repo',
      spec.repo,
      '--dir',
      dir,
      '--patterns',
      spec.patterns.join(','),
    ]
    const token = await hfToken()
    if (token) args.push('--token', token)
    await spawnLive(venvBin('python'), args, {
        timeoutMs: 0,
        env: { HF_HUB_DISABLE_PROGRESS_BARS: '1' },
        onLine: (l) => {
          jobLine(job, l)
          try {
            const j = JSON.parse(l) as { file?: string; pct?: number }
            if (j.file) emit(job, { stage: 'weights', repo: spec.repo, file: j.file, pct: j.pct ?? 0 })
          } catch {
            /* ligne de journal ordinaire */
          }
        },
      },
    )
  }
}

export function startWeightsDownload(id: PipelineId): { jobId: string } {
  const def = PIPELINES[id]
  const job = newJob(id, 'download')
  queue = queue
    .then(async () => {
      try {
        await downloadWeights(job, def)
        finishJob(job)
      } catch (e) {
        finishJob(job, e instanceof Error ? e.message : String(e))
      }
    })
    .catch(() => undefined)
  return { jobId: job.id }
}

/* -------------------------------- Exécution ------------------------------- */

/**
 * Exécute le runner du pipeline avec un JSON en entrée (stdin) et diffuse ses
 * événements NDJSON (stdout) au listener. Un seul run à la fois.
 */
export function runPipeline(
  id: PipelineId,
  args: Record<string, unknown>,
  onEvent?: RunListener,
): { jobId: string; done: Promise<Record<string, unknown>> } {
  const def = PIPELINES[id]
  const job = newJob(id, 'run')
  if (onEvent) runListeners.set(job.id, onEvent)

  const done = queue.then(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        void (async () => {
          const outDir = args.outputDir ? String(args.outputDir) : path.join(PIPES_DIR, id, 'outputs', String(Date.now()))
          await fsp.mkdir(outDir, { recursive: true })
          const env: Record<string, string> = { HF_HUB_OFFLINE: '1' }
          if (id === 'yue') {
            env.YUE2_MODEL_DIR = path.join(weightsDir('yue'), 'm-a-p__YuE2-3B')
            env.YUE2_VAE_DIR = path.join(weightsDir('yue'), 'm-a-p__YuE2-Vae')
          }
          if (id === 'audio8-tts') env.AUDIO8_DIR = path.join(weightsDir('audio8-tts'), 'Edge0__Audio8-TTS-Realistic-Air')
          if (id === 'embeddinggemma') env.EMBED_DIR = path.join(weightsDir('embeddinggemma'), 'google__embeddinggemma-2')
          if (id === 'moss-image') env.MOSS_DIR = path.join(weightsDir('moss-image'), 'OpenMOSS-Team__MOSS-Image-SFT')

          emit(job, { stage: 'run-start', pipeline: id, outputDir: path.relative(ROOT, outDir) })
          let final: Record<string, unknown> = {}
          try {
            await spawnLive(venvBin('python'), [path.join(RUNNERS_DIR, def.runner)], {
              env,
              timeoutMs: 0,
              stdin: JSON.stringify({ ...args, output: outDir }),
              onLine: (l) => {
                jobLine(job, l)
                try {
                  const evt = JSON.parse(l) as Record<string, unknown>
                  if (evt.stage || evt.ok || evt.progress) {
                    if (evt.ok) final = evt
                    else emit(job, evt)
                  }
                } catch {
                  /* journal non JSON */
                }
              },
            })
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            finishJob(job, msg)
            runListeners.delete(job.id)
            reject(new Error(msg))
            return
          }
          finishJob(job)
          runListeners.delete(job.id)
          if (!final || Object.keys(final).length === 0) {
            reject(new Error('Le runner n’a pas renvoyé de résultat exploitable.'))
            return
          }
          resolve({ ...final, outputDir: outDir })
        })()
      }),
  )
  return { jobId: job.id, done }
}

export function stopJobs(pipelineId?: PipelineId): number {
  let n = 0
  // Les jobs roulent dans des processus dédiés : on termine les jobs déclarés
  for (const j of jobs.values()) {
    if (j.status === 'run' && (!pipelineId || j.pipelineId === pipelineId)) {
      j.status = 'error'
      j.error = 'Arrêt demandé.'
      j.endedAt = Date.now()
      n++
    }
  }
  return n
}

/* --------------------------------- Statut --------------------------------- */

export async function pipelineStatus(id: PipelineId): Promise<PipelineStatus> {
  const def = PIPELINES[id]
  const [bytes, hardware, st] = await Promise.all([weightsOnDisk(id), hardwareFor(def), readStatus()])
  const complete = bytes >= def.totalBytes * 0.98
  return {
    id,
    label: def.label,
    kind: def.kind,
    description: def.description,
    totalBytes: def.totalBytes,
    weightsDir: path.relative(ROOT, weightsDir(id)),
    bytesDownloaded: bytes,
    weightsComplete: complete,
    ready: Boolean(st.env?.installed) && complete && venvReady(),
    hardware,
    jobs: [...jobs.values()].filter((j) => j.pipelineId === id).slice(-8),
  }
}

export async function allPipelinesStatus(): Promise<{ env: { installed: boolean; ready: boolean; error?: string }; ram: { totalBytes: number; freeBytes: number }; cpus: number; pipelines: PipelineStatus[] }> {
  const st = await readStatus()
  const ram = ramInfo()
  const pipelines = await Promise.all((Object.keys(PIPELINES) as PipelineId[]).map(pipelineStatus))
  return {
    env: { installed: Boolean(st.env?.installed), ready: venvReady(), error: st.env?.error },
    ram: { totalBytes: ram.totalBytes, freeBytes: ram.freeBytes },
    cpus: os.cpus().length,
    pipelines,
  }
}

/** Le pipeline est prêt ? (voie rapide pour /api/tts et /api/image) */
export async function isPipelineReady(id: PipelineId): Promise<boolean> {
  if (!venvReady()) return false
  const st = await readStatus()
  if (!st.env?.installed) return false
  return (await weightsOnDisk(id)) >= PIPELINES[id].totalBytes * 0.98
}
