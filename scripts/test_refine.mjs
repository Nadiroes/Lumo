/** Test du post-traitement refineAudio (sonde ffprobe + découpe fondu) sur le vrai rap.mp3 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const runTool = promisify(execFile)

async function probeDuration(file) {
  const { stdout } = await runTool('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { timeout: 15000 })
  const d = Number(JSON.parse(stdout)?.format?.duration)
  return Number.isFinite(d) && d > 0 ? d : 0
}

async function refine(srcPath, mime, targetSec) {
  const ext = mime === 'audio/ogg' ? 'ogg' : mime === 'audio/wav' ? 'wav' : 'mp3'
  const dir = await mkdtemp(join(tmpdir(), 'lumo-test-'))
  const src = join(dir, `in.${ext}`)
  const out = join(dir, `out.${ext}`)
  try {
    await writeFile(src, await readFile(srcPath))
    const real = await probeDuration(src)
    const target = Math.max(30, Math.min(285, Math.round(targetSec)))
    if (real <= target + 4) return { real, trimmed: false }
    const fadeStart = Math.max(0, target - 3)
    const fadeDur = Math.min(3, target - fadeStart)
    const args = ['-v', 'error', '-y', '-i', src, '-t', String(target),
      '-af', `afade=t=in:st=0:d=0.05,afade=t=out:st=${fadeStart}:d=${fadeDur}`]
    if (ext === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '192k')
    else if (ext === 'ogg') args.push('-c:a', 'libvorbis', '-q:a', '6')
    args.push(out)
    await runTool('ffmpeg', args, { timeout: 60000 })
    const outDur = await probeDuration(out)
    const keep = '/tmp/refined-test.mp3'
    await runTool('cp', [out, keep])
    const { size } = await stat(out)
    return { real, target, outDur: Math.round(outDur * 10) / 10, sizeKo: Math.round(size / 1024), trimmed: true, out: keep }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// Cas 1 : découpe 240s → 120s (durée par défaut de l'UI)
const r1 = await refine('/home/z/my-project/upload/rap.mp3', 'audio/mpeg', 120)
console.log('cas 120 s :', JSON.stringify({ ...r1, out: r1.out ? 'fichier ok' : undefined }))
// Cas 2 : pas de découpe si durée demandée ≥ réelle
const r2 = await refine('/home/z/my-project/upload/rap.mp3', 'audio/mpeg', 285)
console.log('cas 285 s :', JSON.stringify({ real: r2.real, trimmed: r2.trimmed }))

// Vérifier le contenu audio découpé : pas de clic, fondu présent, énergie continue
if (r1.out) {
  const { stdout } = await runTool('ffmpeg', ['-v', 'error', '-i', r1.out, '-af', 'astats=metadata=1:reset=1,volumedetect', '-f', 'null', '-'], { timeout: 60000 })
  const max = stdout.match(/max_volume: ([-\d.]+) dB/)
  const mean = stdout.match(/mean_volume: ([-\d.]+) dB/)
  console.log('audio découpé : max_volume =', max?.[1], 'dB, mean_volume =', mean?.[1], 'dB')
  // dernière seconde : doit être quasi silencieuse (fondu)
  const { stdout: tail } = await runTool('ffmpeg', ['-v', 'error', '-ss', '118.5', '-i', r1.out, '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 30000 })
  const tailMax = tail.match(/max_volume: ([-\d.]+) dB/)
  console.log('dernière demi-seconde (fondu) : max_volume =', tailMax?.[1], 'dB — doit être bien plus bas que la moyenne')
}
