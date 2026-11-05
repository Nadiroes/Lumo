// Test du quota ZeroGPU du token HF enregistré en base (bucket personnel)
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const row = await prisma.apiKey.findFirst({ where: { provider: 'huggingface' }, select: { secret: true } })
await prisma.$disconnect()
if (!row) { console.log('AUCUN TOKEN en base'); process.exit(0) }
const token = row.secret
console.log('token présent:', token.slice(0, 6) + '…')

const { Client } = await import('@gradio/client')
console.log('[0s] connexion DiffRhythm 2 avec token utilisateur…')
try {
  const client = await Client.connect('https://aslp-lab-diffrhythm2.hf.space', { token })
  console.log('[connecté] appel /infer_music (test quota)…')
  const params = {
    lrc: '[start]\n[verse]\ntest quota ligne une\ntest quota ligne deux',
    audio_prompt: null,
    text_prompt: 'pop test',
    seed: 0, randomize_seed: true, steps: 16, cfg_strength: 1.3,
    file_type: 'mp3', odeint_method: 'euler',
  }
  const t0 = Date.now()
  const res = await Promise.race([
    client.predict('/infer_music', params),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 90s')), 90_000)),
  ])
  const first = Array.isArray(res.data) ? res.data[0] : res.data
  console.log(`✅ QUOTA TOKEN OK — audio reçu en ${((Date.now() - t0) / 1000).toFixed(0)}s :`, first?.url?.slice(0, 90))
} catch (e) {
  console.log('❌ ÉCHEC token :', String(e?.message || e).slice(0, 400))
}
process.exit(0)
