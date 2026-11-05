/** Diagnostic: HF API status codes (sans jamais imprimer le token) */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

async function main() {
  const row = await db.apiKey.findUnique({ where: { provider: 'huggingface' }, select: { secret: true } })
  const token = row?.secret
  console.log('token présent:', token ? `oui (${token.slice(0, 3)}…${token.slice(-2)})` : 'NON')

  const urls = [
    ['datasets/suno', 'https://huggingface.co/api/datasets/webshart/suno-various-94k'],
    ['models/Qwen org', 'https://huggingface.co/api/models?author=Qwen&sort=downloads&limit=3'],
  ]
  for (const [name, url] of urls) {
    for (const [mode, hdrs] of [
      ['anonyme', { 'User-Agent': 'Lumo/0.1' }],
      ['token', { 'User-Agent': 'Lumo/0.1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }],
    ]) {
      try {
        const res = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(8000) })
        console.log(`${name} [${mode}] -> ${res.status}`)
        if (res.status === 429) {
          const reset = res.headers.get('x-ratelimit-reset')
          console.log('   x-ratelimit-reset:', reset)
        }
      } catch (e) {
        console.log(`${name} [${mode}] -> ERREUR ${e.message}`)
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

main().finally(() => db.$disconnect())
