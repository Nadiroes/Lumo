// Test direct du Space DiffRhythm 2 (diagnostic — paroles très courtes)
import { Client } from '@gradio/client'

const SPACE = 'https://aslp-lab-diffrhythm2.hf.space'
const LRC = `[start]
[intro]
[verse]
La nuit tombe sur la ville
Le silence est tranquille
[chorus]
Chante encore
Sous les étoiles
[outro]`

const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

try {
  log('connexion au Space…')
  const client = await Client.connect(SPACE, {})
  log('connecté — appel /infer_music (anonymous, steps=10)')
  const result = await client.predict('/infer_music', {
    lrc: LRC,
    audio_prompt: null,
    text_prompt: 'lo-fi chill, soft beats, warm',
    seed: 0,
    randomize_seed: true,
    steps: 10,
    cfg_strength: 1.3,
    file_type: 'mp3',
    odeint_method: 'euler',
  })
  log('SUCCÈS')
  const first = Array.isArray(result.data) ? result.data[0] : result.data
  console.log('data[0]:', JSON.stringify(first)?.slice(0, 300))
} catch (e) {
  log('ÉCHEC:')
  console.log('message:', e?.message)
  if (e?.response?.data) console.log('response.data:', JSON.stringify(e.response.data).slice(0, 500))
  console.log('stack:', e?.stack?.split('\n').slice(0, 4).join('\n'))
}
