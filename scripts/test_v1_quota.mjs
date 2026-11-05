// Test DiffRhythm 1 anonyme (dernier chemin serveur de la chaîne de repli)
const { Client } = await import('@gradio/client')
console.log('[0s] connexion DiffRhythm 1 (anonyme)…')
try {
  const client = await Client.connect('https://aslp-lab-diffrhythm.hf.space', {})
  console.log('[connecté] appel /infer_music…')
  const lrc = '[00:12.000] test ligne une\n[00:16.200] test ligne deux'
  const params = {
    lrc,
    ref_audio_path: null,
    text_prompt: 'pop test',
    seed: 0, randomize_seed: true, steps: 32, cfg_strength: 4.0,
    file_type: 'mp3', odeint_method: 'euler',
    preference_infer: 'quality first',
    Music_Duration: 30,
  }
  const t0 = Date.now()
  const res = await Promise.race([
    client.predict('/infer_music', params),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 100s')), 100_000)),
  ])
  const first = Array.isArray(res.data) ? res.data[0] : res.data
  console.log(`✅ V1 OK — audio en ${((Date.now() - t0) / 1000).toFixed(0)}s :`, first?.url?.slice(0, 90))
} catch (e) {
  console.log('❌ ÉCHEC V1 :', String(e?.message || e).slice(0, 300))
}
process.exit(0)
