/**
 * Moteur de génération musicale Lumo (façon Suno) — 100 % local.
 * Composition procédurale via Web Audio API (OfflineAudioContext) :
 * pads, basse, mélodie, batterie, effets — rendu WAV téléchargeable.
 * Le prompt pilote le style (mots-clés) et la graine aléatoire.
 */

export interface MusicRequest {
  prompt: string
  style: string // 'auto' ou nom de style
  durationSec: number
  instrumental: boolean
}

export interface MusicResult {
  wavBase64: string
  bytes: number
  title: string
  meta: { style: string; bpm: number; key: string; durationSec: number }
}

interface Preset {
  id: string
  label: string
  bpm: number
  minor: boolean
  kick: number[]
  snare: number[]
  hats: number[]
  hatOpen: boolean
  swing: number
  padType: OscillatorType
  bassType: OscillatorType
  bassEighths: boolean
  drums: boolean
  brightness: number // fréquence du filtre des nappes
  delay: number // quantité de délai sur la mélodie
  keywords: string[]
}

const PRESETS: Preset[] = [
  {
    id: 'lofi', label: 'Lo-fi', bpm: 74, minor: true,
    kick: [0, 6, 10], snare: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], hatOpen: false,
    swing: 0.16, padType: 'triangle', bassType: 'sine', bassEighths: false, drums: true,
    brightness: 1400, delay: 0.28,
    keywords: ['lo-fi', 'lofi', 'chill', 'étudier', 'étude', 'pluie', 'café', 'détente', 'boom'],
  },
  {
    id: 'electro', label: 'Électro', bpm: 122, minor: true,
    kick: [0, 4, 8, 12], snare: [4, 12], hats: [2, 6, 10, 14], hatOpen: true,
    swing: 0, padType: 'sawtooth', bassType: 'sawtooth', bassEighths: true, drums: true,
    brightness: 2600, delay: 0.3,
    keywords: ['électro', 'electro', 'techno', 'house', 'dance', 'club', 'edm', 'synthwave'],
  },
  {
    id: 'cinematic', label: 'Cinématique', bpm: 82, minor: true,
    kick: [0, 8], snare: [], hats: [], hatOpen: false,
    swing: 0, padType: 'sine', bassType: 'sine', bassEighths: false, drums: true,
    brightness: 1100, delay: 0.4,
    keywords: ['cinéma', 'cinématique', 'cinematic', 'épique', 'trailer', 'orchestre', 'bande-annonce', 'drame'],
  },
  {
    id: 'rock', label: 'Rock', bpm: 112, minor: false,
    kick: [0, 8, 10], snare: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], hatOpen: false,
    swing: 0, padType: 'square', bassType: 'sawtooth', bassEighths: true, drums: true,
    brightness: 2200, delay: 0.12,
    keywords: ['rock', 'guitare', 'punk', 'grunge', 'métal', 'metal'],
  },
  {
    id: 'jazz', label: 'Jazz', bpm: 98, minor: true,
    kick: [0, 10], snare: [4, 12], hats: [0, 3, 4, 7, 8, 11, 12, 15], hatOpen: false,
    swing: 0.3, padType: 'triangle', bassType: 'triangle', bassEighths: false, drums: true,
    brightness: 1800, delay: 0.2,
    keywords: ['jazz', 'swing', 'blues', 'bossa', 'saxo'],
  },
  {
    id: 'ambient', label: 'Ambient', bpm: 62, minor: true,
    kick: [], snare: [], hats: [], hatOpen: false,
    swing: 0, padType: 'sine', bassType: 'sine', bassEighths: false, drums: false,
    brightness: 900, delay: 0.5,
    keywords: ['ambient', 'ambientale', 'meditation', 'méditation', 'zen', 'espace', 'sommeil', 'drone', 'éthéré'],
  },
  {
    id: 'pop', label: 'Pop', bpm: 102, minor: false,
    kick: [0, 8], snare: [4, 12], hats: [2, 6, 10, 14], hatOpen: false,
    swing: 0, padType: 'triangle', bassType: 'triangle', bassEighths: true, drums: true,
    brightness: 2400, delay: 0.18,
    keywords: ['pop', 'entraînant', 'joyeux', 'été', 'vlog'],
  },
  {
    id: 'funk', label: 'Funk', bpm: 106, minor: true,
    kick: [0, 3, 6, 10, 12], snare: [4, 12], hats: [0, 2, 4, 6, 8, 10, 12, 14], hatOpen: false,
    swing: 0.1, padType: 'square', bassType: 'sawtooth', bassEighths: true, drums: true,
    brightness: 2000, delay: 0.15,
    keywords: ['funk', 'groove', 'disco', 'basse', 'brassy'],
  },
]

const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
const PENTA_MINOR = [0, 3, 5, 7, 10]
const PROGRESSIONS_MIN = [[0, 5, 3, 4], [0, 3, 4, 3], [0, 4, 5, 2]]
const PROGRESSIONS_MAJ = [[0, 4, 5, 3], [0, 3, 4, 4], [0, 5, 3, 4]]
const NOTE_NAMES = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']

/* ---------- utilitaires ---------- */

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12)
}

function pickPreset(prompt: string, style: string): Preset {
  const text = `${style} ${prompt}`.toLowerCase()
  if (style && style !== 'auto') {
    const exact = PRESETS.find((p) => p.id === style || p.label.toLowerCase() === style.toLowerCase())
    if (exact) return exact
  }
  let best = PRESETS[0]
  let bestScore = 0
  for (const p of PRESETS) {
    let score = 0
    for (const kw of p.keywords) if (text.includes(kw)) score++
    if (score > bestScore) {
      best = p
      bestScore = score
    }
  }
  return bestScore > 0 ? best : PRESETS[0]
}

function titleFromPrompt(prompt: string, preset: Preset): string {
  const stop = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'd', 'à', 'au', 'aux', 'et', 'en', 'avec', 'pour', 'sur', 'dans', 'qui', 'que', 'style', 'façon', 'musique', 'chanson', 'piste', 'morceau'])
  const words = prompt
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 3)
  if (words.length === 0) return `${preset.label} Lumo`
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/* ---------- synthèse ---------- */

interface Ctx {
  ctx: OfflineAudioContext
  noise: AudioBuffer
  master: GainNode
  delaySend: GainNode
}

function makeNoiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buf
}

function softClipCurve(): Float32Array {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * 1.6) * 0.92
  }
  return curve
}

/** Note tenue (pad, basse) avec enveloppe ADSR simplifiée */
function playTone(
  c: Ctx, dest: AudioNode,
  opts: { freq: number; start: number; dur: number; type: OscillatorType; gain: number; attack?: number; release?: number; detune?: number; pan?: number },
) {
  const { freq, start, dur, type, gain } = opts
  const attack = opts.attack ?? 0.02
  const release = opts.release ?? 0.08
  const oscs: OscillatorNode[] = []
  const env = c.ctx.createGain()
  env.gain.setValueAtTime(0.0001, start)
  env.gain.linearRampToValueAtTime(gain, start + attack)
  env.gain.setValueAtTime(gain, Math.max(start + attack, start + dur - release))
  env.gain.linearRampToValueAtTime(0.0001, start + dur)

  const detunes = opts.detune ? [-opts.detune, opts.detune] : [0]
  for (const d of detunes) {
    const osc = c.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, start)
    osc.detune.setValueAtTime(d, start)
    osc.connect(env)
    osc.start(start)
    osc.stop(start + dur + 0.05)
    oscs.push(osc)
  }

  let out: AudioNode = env
  if (opts.pan !== undefined && c.ctx.createStereoPanner) {
    const pan = c.ctx.createStereoPanner()
    pan.pan.setValueAtTime(opts.pan, start)
    env.connect(pan)
    out = pan
  }
  out.connect(dest)
}

/** Percussion bruit blanc filtré (snare, hat) */
function playNoise(
  c: Ctx, dest: AudioNode,
  opts: { start: number; dur: number; gain: number; hp?: number; bp?: number; pan?: number },
) {
  const src = c.ctx.createBufferSource()
  src.buffer = c.noise
  src.loop = true
  const env = c.ctx.createGain()
  env.gain.setValueAtTime(opts.gain, opts.start)
  env.gain.exponentialRampToValueAtTime(0.0001, opts.start + opts.dur)
  let node: AudioNode = env
  if (opts.hp) {
    const f = c.ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = opts.hp
    env.connect(f)
    node = f
  } else if (opts.bp) {
    const f = c.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = opts.bp
    f.Q.value = 0.9
    env.connect(f)
    node = f
  }
  src.connect(env)
  if (opts.pan !== undefined && c.ctx.createStereoPanner) {
    const pan = c.ctx.createStereoPanner()
    pan.pan.setValueAtTime(opts.pan, opts.start)
    node.connect(pan)
    node = pan
  }
  node.connect(dest)
  src.start(opts.start)
  src.stop(opts.start + opts.dur + 0.02)
}

/** Kick : sinus dont la hauteur chute */
function playKick(c: Ctx, dest: AudioNode, start: number, gain = 0.9) {
  const osc = c.ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(130, start)
  osc.frequency.exponentialRampToValueAtTime(42, start + 0.11)
  const env = c.ctx.createGain()
  env.gain.setValueAtTime(gain, start)
  env.gain.exponentialRampToValueAtTime(0.0001, start + 0.24)
  osc.connect(env)
  env.connect(dest)
  osc.start(start)
  osc.stop(start + 0.3)
}

function triadChord(rootMidi: number, minor: boolean): number[] {
  return minor ? [rootMidi, rootMidi + 3, rootMidi + 7] : [rootMidi, rootMidi + 4, rootMidi + 7]
}

/* ---------- rendu ---------- */

export async function generateMusic(req: MusicRequest): Promise<MusicResult> {
  const seed = hashString(req.prompt.trim().toLowerCase() + '|' + req.style)
  const rand = mulberry32(seed)
  const preset = pickPreset(req.prompt, req.style)
  const bpm = preset.bpm + Math.floor(rand() * 7) - 3
  const beat = 60 / bpm
  const barSec = beat * 4
  const durationSec = Math.max(10, Math.min(60, req.durationSec))
  const bars = Math.max(2, Math.round(durationSec / barSec))
  const sampleRate = 44100

  const OfflineCtor: typeof OfflineAudioContext =
    (typeof window !== 'undefined' && (window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext)) ||
    OfflineAudioContext

  const ctx = new OfflineCtor(2, Math.ceil(sampleRate * (bars * barSec + 0.8)), sampleRate)

  // Bus maîtres
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.0001, 0)
  master.gain.linearRampToValueAtTime(0.9, 0.8)
  master.gain.setValueAtTime(0.9, Math.max(1, bars * barSec - 1.2))
  master.gain.linearRampToValueAtTime(0.0001, bars * barSec + 0.3)

  const shaper = ctx.createWaveShaper()
  shaper.curve = softClipCurve()
  master.connect(shaper)
  shaper.connect(ctx.destination)

  // Délai global pour la mélodie
  const delaySend = ctx.createGain()
  delaySend.gain.value = preset.delay
  const delay = ctx.createDelay(1.5)
  delay.delayTime.value = beat * 0.75
  const fb = ctx.createGain()
  fb.gain.value = 0.32
  delaySend.connect(delay)
  delay.connect(fb)
  fb.connect(delay)
  delay.connect(master)

  const c: Ctx = { ctx, noise: makeNoiseBuffer(ctx), master, delaySend }

  // Tonique : La2 (45) ± 5 demi-tons
  const rootMidi = 45 + Math.floor(rand() * 11) - 5
  const scale = preset.minor ? MINOR_SCALE : MAJOR_SCALE
  const progressions = preset.minor ? PROGRESSIONS_MIN : PROGRESSIONS_MAJ
  const progression = progressions[Math.floor(rand() * progressions.length)]

  const padBus = ctx.createGain(); padBus.gain.value = 0.5; padBus.connect(master)
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.55; bassBus.connect(master)
  const melBus = ctx.createGain(); melBus.gain.value = 0.42; melBus.connect(master)
  const drumBus = ctx.createGain(); drumBus.gain.value = 0.85; drumBus.connect(master)

  const penta = PENTA_MINOR.map((n) => n + rootMidi + 12)

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * barSec
    const degree = progression[bar % progression.length]
    const chordRoot = rootMidi + scale[degree % scale.length] + (degree >= scale.length ? 12 : 0)
    const isMinorChord = preset.minor ? degree !== 4 : degree !== 1
    const chord = triadChord(chordRoot + 12, isMinorChord)
    const intro = bar === 0
    const drumsOn = preset.drums && !intro && !(bar === bars - 1 && rand() < 0.4)

    // --- Nappes (accords tenus) ---
    for (let i = 0; i < chord.length; i++) {
      playTone(c, padBus, {
        freq: midiToFreq(chord[i]),
        start: barStart + 0.01,
        dur: barSec * 0.98,
        type: preset.padType,
        gain: 0.16,
        attack: barSec * 0.22,
        release: barSec * 0.3,
        detune: 7,
        pan: i === 0 ? -0.35 : i === 1 ? 0 : 0.35,
      })
    }

    // --- Basse ---
    const bassNote = chordRoot
    if (!intro) {
      if (preset.bassEighths) {
        for (let e = 0; e < 8; e++) {
          if (rand() < 0.12) continue
          const oct = e === 3 && rand() < 0.5 ? 12 : 0
          playTone(c, bassBus, {
            freq: midiToFreq(bassNote + oct),
            start: barStart + e * beat * 0.5 + (e % 2 ? preset.swing * beat * 0.5 : 0),
            dur: beat * 0.42,
            type: preset.bassType,
            gain: 0.24,
            attack: 0.008,
            release: 0.05,
          })
        }
      } else if (preset.id === 'jazz') {
        for (let q = 0; q < 4; q++) {
          const tone = [0, 2, 4][Math.floor(rand() * 3)]
          playTone(c, bassBus, {
            freq: midiToFreq(rootMidi + scale[tone]),
            start: barStart + q * beat,
            dur: beat * 0.85,
            type: preset.bassType,
            gain: 0.26,
            attack: 0.01,
            release: 0.08,
          })
        }
      } else {
        playTone(c, bassBus, {
          freq: midiToFreq(bassNote),
          start: barStart + 0.01,
          dur: barSec * 0.9,
          type: preset.bassType,
          gain: 0.3,
          attack: 0.03,
          release: 0.2,
        })
        playTone(c, bassBus, {
          freq: midiToFreq(bassNote + 7),
          start: barStart + beat * 2.5,
          dur: beat * 1.2,
          type: preset.bassType,
          gain: 0.2,
          attack: 0.03,
          release: 0.2,
        })
      }
    }

    // --- Mélodie (pentaatonique) ---
    {
      const melDensity = preset.id === 'ambient' ? 0.18 : preset.id === 'cinematic' ? 0.3 : 0.5
      if (bar % 2 === (intro ? 0 : 1) || rand() < 0.5) {
        let step = Math.floor(rand() * 5)
        for (let e = 0; e < 8; e++) {
          if (rand() > melDensity) continue
          step = Math.max(0, Math.min(4, step + Math.floor(rand() * 3) - 1))
          const midi = penta[step] + (rand() < 0.18 ? 12 : 0)
          const start = barStart + e * beat * 0.5 + (e % 2 ? preset.swing * beat * 0.5 : 0)
          playTone(c, melBus, {
            freq: midiToFreq(midi),
            start,
            dur: beat * (rand() < 0.3 ? 1 : 0.45),
            type: preset.id === 'ambient' ? 'sine' : 'triangle',
            gain: 0.2,
            attack: preset.id === 'ambient' ? 0.15 : 0.012,
            release: preset.id === 'ambient' ? 0.8 : 0.12,
            pan: rand() * 0.5 - 0.25,
          })
          // écho vers le délai
          playTone(c, delaySend, {
            freq: midiToFreq(midi),
            start,
            dur: beat * 0.4,
            type: 'sine',
            gain: 0.1,
            attack: 0.01,
            release: 0.15,
          })
        }
      }
    }

    // --- Batterie ---
    if (drumsOn) {
      const swing = (s: number) => s * beat * 0.25 + (s % 2 ? preset.swing * beat * 0.25 : 0)
      for (const s of preset.kick) playKick(c, drumBus, barStart + swing(s), 0.75)
      for (const s of preset.snare) {
        playNoise(c, drumBus, { start: barStart + swing(s), dur: 0.16, gain: 0.3, bp: 1900 })
        playTone(c, drumBus, { freq: 185, start: barStart + swing(s), dur: 0.09, type: 'triangle', gain: 0.18, attack: 0.001, release: 0.05 })
      }
      for (const s of preset.hats) {
        playNoise(c, drumBus, {
          start: barStart + swing(s),
          dur: preset.hatOpen ? 0.16 : 0.045,
          gain: 0.1 + rand() * 0.05,
          hp: 7500,
          pan: -0.3,
        })
      }
      // variance : roulement final
      if (bar === bars - 2 && rand() < 0.6) {
        for (let s = 12; s < 16; s++) {
          playNoise(c, drumBus, { start: barStart + swing(s), dur: 0.05, gain: 0.22, bp: 2100 })
        }
      }
    }
  }

  // Bruit vinyle pour le lo-fi
  if (preset.id === 'lofi') {
    const src = ctx.createBufferSource()
    src.buffer = c.noise
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 3200
    bp.Q.value = 0.4
    const g = ctx.createGain()
    g.gain.value = 0.014
    src.connect(bp)
    bp.connect(g)
    g.connect(master)
    src.start(0)
    src.stop(bars * barSec)
  }

  const rendered = await ctx.startRendering()
  const wav = audioBufferToWav(rendered)
  const base64 = arrayBufferToBase64(wav)

  const keyName = `${NOTE_NAMES[((rootMidi % 12) + 12) % 12]}${preset.minor ? ' mineur' : ' majeur'}`
  return {
    wavBase64: base64,
    bytes: wav.byteLength,
    title: titleFromPrompt(req.prompt, preset),
    meta: { style: preset.label, bpm, key: keyName, durationSec: Math.round(bars * barSec) },
  }
}

/* ---------- encodage WAV ---------- */

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = Math.min(2, buffer.numberOfChannels)
  const len = buffer.length
  const sampleRate = buffer.sampleRate
  const bytesPerSample = 2
  const dataSize = len * numCh * bytesPerSample
  const ab = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numCh * bytesPerSample, true)
  view.setUint16(32, numCh * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const channels: Float32Array[] = []
  for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = channels[ch][i]
      s = Math.max(-1, Math.min(1, s))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return ab
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
