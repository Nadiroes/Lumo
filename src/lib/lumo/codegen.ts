/**
 * Générateurs de code Lumo — mode Dev Web & App Design.
 * - parseCodeBlocks : extrait les fichiers d’une réponse LLM annotée ```lang:file
 * - DesignDoc : modèle de conception WYSIWYG (écrans → éléments → props)
 * - generateHtml / generateReact / generateFlutter : export déterministe du design
 */

import type { CodeFile } from './types'

/* ------------------------------------------------------------------ */
/* Parseur de blocs de code (réponses LLM du mode Dev Web)             */
/* ------------------------------------------------------------------ */

/** Accepte ```html:index.html, ```html, ``` etc. et les documents bruts */
export function parseCodeBlocks(text: string, fallbackLang = 'html'): CodeFile[] {
  const files: CodeFile[] = []
  const re = /```([\w.+-]*)(?::[ \t]*([^\n`]+))?\r?\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase() || fallbackLang
    const name = (m[2] || '').trim()
    const content = m[3].replace(/\s+$/, '') + '\n'
    if (!content.trim()) continue
    files.push({ name: name || fileNameFor(lang, files.length), lang, content })
  }
  if (files.length === 0) {
    const trimmed = text.trim()
    if (trimmed) {
      // Réponse sans clôtures Markdown : on tente de deviner
      const lang = guessLang(trimmed)
      files.push({ name: fileNameFor(lang, 0), lang, content: trimmed + '\n' })
    }
  }
  return dedupe(files)
}

function guessLang(code: string): string {
  const head = code.slice(0, 400).toLowerCase()
  if (head.includes('<!doctype html') || head.includes('<html')) return 'html'
  if (/^<\?php/.test(code.trim())) return 'php'
  if (/\b(import|export)\b.*\breact\b|from ['"]react['"]/.test(head) || head.includes('jsx')) return 'jsx'
  if (/:\s*(string|number|boolean)\b/.test(head)) return 'typescript'
  if (/\bfunction\b|\bconst\b|\blet\b|=>/.test(head)) return 'javascript'
  if (/^\s*[.#@][\w-]*\s*\{/m.test(code) || head.includes(':root')) return 'css'
  return 'text'
}

function fileNameFor(lang: string, index: number): string {
  switch (lang) {
    case 'html':
      return index === 0 ? 'index.html' : `page_${index + 1}.html`
    case 'css':
      return 'styles.css'
    case 'javascript':
    case 'js':
      return 'app.js'
    case 'typescript':
    case 'ts':
      return 'app.ts'
    case 'jsx':
      return 'App.jsx'
    case 'tsx':
      return 'App.tsx'
    case 'php':
      return 'index.php'
    case 'json':
      return 'data.json'
    case 'python':
    case 'py':
      return 'main.py'
    case 'sql':
      return 'schema.sql'
    case 'markdown':
    case 'md':
      return 'README.md'
    default:
      return `fichier_${index + 1}.txt`
  }
}

function dedupe(files: CodeFile[]): CodeFile[] {
  const seen = new Map<string, CodeFile>()
  for (const f of files) seen.set(f.name, f)
  return [...seen.values()]
}

/**
 * Détection TEMPS RÉEL : un bloc ```lang:nom ouvert (même non fermé)
 * compte comme un fichier en cours d'écriture — pour le panneau d'activité.
 */
export function parseOpeningFiles(text: string, fallbackLang = 'html'): string[] {
  const names: string[] = []
  const re = /```([\w.+-]*)(?::[ \t]*([^\n`]+))?\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase() || fallbackLang
    const name = (m[2] || '').trim() || fileNameFor(lang, names.length)
    names.push(name)
  }
  return [...new Set(names)]
}

/* ------------------------------------------------------------------ */
/* Modèle de design WYSIWYG                                            */
/* ------------------------------------------------------------------ */

export type ElType =
  | 'navbar'
  | 'hero'
  | 'text'
  | 'button'
  | 'input'
  | 'image'
  | 'list'
  | 'card'
  | 'divider'
  | 'badge'
  | 'footer'

export const EL_CATALOG: { type: ElType; label: string; icon: string }[] = [
  { type: 'navbar', label: 'Barre de navigation', icon: '☰' },
  { type: 'hero', label: 'Bannière héro', icon: '◤' },
  { type: 'text', label: 'Texte', icon: 'T' },
  { type: 'button', label: 'Bouton', icon: '⬒' },
  { type: 'input', label: 'Champ de saisie', icon: '⌨' },
  { type: 'image', label: 'Image', icon: '🖼' },
  { type: 'list', label: 'Liste', icon: '≣' },
  { type: 'card', label: 'Carte', icon: '▭' },
  { type: 'badge', label: 'Étiquette', icon: '◉' },
  { type: 'divider', label: 'Séparateur', icon: '—' },
  { type: 'footer', label: 'Pied de page', icon: '▁' },
]

export interface DesignEl {
  id: string
  type: ElType
  props: Record<string, string>
}

export interface DesignScreen {
  id: string
  name: string
  elements: DesignEl[]
}

export interface DesignDoc {
  appName: string
  style: string
  palette: { primary: string; bg: string; text: string; card: string }
  screens: DesignScreen[]
}

export const DEFAULT_PALETTE = {
  primary: '#E8930C',
  bg: '#FDF9F0',
  text: '#2B2118',
  card: '#FFFFFF',
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function elLabel(type: ElType): string {
  return EL_CATALOG.find((e) => e.type === type)?.label ?? type
}

/** Crée un élément avec des props par défaut réalistes */
export function makeEl(type: ElType): DesignEl {
  const base: Record<ElType, Record<string, string>> = {
    navbar: { text: 'Mon app', links: 'Accueil, Fonctions, Tarifs, Contact' },
    hero: { title: 'Bienvenue', subtitle: 'Une accroche courte et claire pour votre écran d’accueil.', cta: 'Commencer' },
    text: { text: 'Un paragraphe clair qui explique votre idée.', size: 'md' },
    button: { text: 'Cliquez-moi', variant: 'primary' },
    input: { label: 'Votre e-mail', placeholder: 'nom@exemple.com' },
    image: { src: '', alt: 'Illustration', height: 'm' },
    list: { items: 'Premier point\nDeuxième point\nTroisième point' },
    card: { title: 'Titre de carte', text: 'Un court descriptif du contenu de cette carte.' },
    badge: { text: 'Nouveau' },
    divider: {},
    footer: { text: '© 2026 Mon app — tous droits réservés' },
  }
  return { id: uid(), type, props: { ...(base[type] ?? {}) } }
}

export function emptyDoc(appName = 'Mon application'): DesignDoc {
  return {
    appName,
    style: 'moderne',
    palette: { ...DEFAULT_PALETTE },
    screens: [{ id: uid(), name: 'Accueil', elements: [makeEl('navbar'), makeEl('hero')] }],
  }
}

/** Validation souple d’un DesignDoc reçu du LLM */
const PROP_ALIASES: Record<string, string> = {
  content: 'text',
  body: 'text',
  description: 'text',
  heading: 'title',
  headline: 'title',
  caption: 'subtitle',
  brand: 'text',
  name: 'title',
  url: 'src',
}

export function coerceDoc(raw: unknown): DesignDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const screens = Array.isArray(o.screens) ? o.screens : null
  if (!screens || screens.length === 0) return null
  const pal = (o.palette ?? {}) as Record<string, unknown>
  const doc: DesignDoc = {
    appName: typeof o.appName === 'string' && o.appName.trim() ? o.appName.trim().slice(0, 60) : 'Mon application',
    style: typeof o.style === 'string' ? o.style : 'moderne',
    palette: {
      primary: strColor(pal.primary, DEFAULT_PALETTE.primary),
      bg: strColor(pal.bg, DEFAULT_PALETTE.bg),
      text: strColor(pal.text, DEFAULT_PALETTE.text),
      card: strColor(pal.card, DEFAULT_PALETTE.card),
    },
    screens: [],
  }
  for (const s of screens.slice(0, 12)) {
    if (!s || typeof s !== 'object') continue
    const so = s as Record<string, unknown>
    const els = Array.isArray(so.elements) ? so.elements : []
    const elements: DesignEl[] = []
    for (const e of els.slice(0, 30)) {
      if (!e || typeof e !== 'object') continue
      const eo = e as Record<string, unknown>
      const type = EL_CATALOG.find((c) => c.type === eo.type)?.type
      if (!type) continue
      const props: Record<string, string> = {}
      if (eo.props && typeof eo.props === 'object') {
        for (const [k, v] of Object.entries(eo.props as Record<string, unknown>)) {
          const key = PROP_ALIASES[k] ?? k
          if (typeof v === 'string') props[key] = v.slice(0, 400)
          else if (typeof v === 'number') props[key] = String(v)
        }
      }
      // Les LLM fournissent souvent les listes séparées par des virgules : on éclate en lignes
      if (type === 'list' && props.items && !props.items.includes('\n')) {
        props.items = props.items
          .split(/,\s*/)
          .map((i) => i.trim())
          .filter(Boolean)
          .join('\n')
      }
      elements.push({ id: uid(), type, props })
    }
    doc.screens.push({
      id: uid(),
      name: typeof so.name === 'string' && so.name.trim() ? so.name.trim().slice(0, 40) : `Écran ${doc.screens.length + 1}`,
      elements,
    })
  }
  return doc.screens.length ? doc : null
}

function strColor(v: unknown, fallback: string): string {
  if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim())) return v.trim()
  return fallback
}

/** Réparation légère des erreurs JSON fréquentes des LLM */
export function repairJsonLoose(s: string): string {
  return s
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    // « "type "card", » → « "type": "card", » (quote de clé déplacée, deux-points manquants)
    .replace(/"(\w+)\s"([^"]*)"(\s*[,}\]])/g, '"$1": "$2"$3')
    // « "key" "valeur" » → « "key": "valeur" » (deux-points manquants)
    .replace(/"(\w+)"\s+"(?=[^:,\]}])/g, '"$1": "')
    .replace(/'(\w+)'\s*:/g, '"$1":') // clés entre apostrophes
    .replace(/,\s*([}\]])/g, '$1') // virgules traînantes
}

/** Extrait un DesignDoc d’une réponse LLM (bloc ```json ou objet brut) */
export function extractDesignDoc(raw: string): DesignDoc | null {
  const m = raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  const body = m[0].replace(/^```json\s*|\s*```$/g, '')
  for (const candidate of [body, repairJsonLoose(body)]) {
    try {
      const doc = coerceDoc(JSON.parse(candidate))
      if (doc) return doc
    } catch {
      /* candidat suivant */
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Export HTML (responsive, palette intégrée)                          */
/* ------------------------------------------------------------------ */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function elHtml(el: DesignEl): string {
  const p = el.props
  switch (el.type) {
    case 'navbar':
      return `    <header class="nav">\n      <span class="brand">${esc(p.text ?? 'Mon app')}</span>\n      <nav>\n${(p.links ?? '')
        .split(/[,\n]/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => `        <a href="#">${esc(l)}</a>`)
        .join('\n')}\n      </nav>\n    </header>`
    case 'hero':
      return `    <section class="hero">\n      <h1>${esc(p.title ?? '')}</h1>\n      <p>${esc(p.subtitle ?? '')}</p>\n      <a class="btn btn-primary" href="#">${esc(p.cta ?? 'Commencer')}</a>\n    </section>`
    case 'text': {
      const size = p.size === 'lg' ? 'h2' : p.size === 'sm' ? 'small' : 'p'
      return `    <${size} class="text-block">${esc(p.text ?? '')}</${size}>`
    }
    case 'button':
      return `    <p><button class="btn ${p.variant === 'outline' ? 'btn-outline' : 'btn-primary'}">${esc(p.text ?? '')}</button></p>`
    case 'input':
      return `    <label class="field">\n      <span>${esc(p.label ?? '')}</span>\n      <input type="text" placeholder="${esc(p.placeholder ?? '')}" />\n    </label>`
    case 'image':
      if (p.src && /^(https?:|data:)/.test(p.src)) {
        return `    <img src="${esc(p.src)}" alt="${esc(p.alt ?? 'Illustration')}" class="img-real" loading="lazy" />`
      }
      return `    <div class="img-ph" role="img" aria-label="${esc(p.alt ?? 'Illustration')}">🖼 ${esc(p.alt ?? 'Illustration')}</div>`
    case 'list':
      return `    <ul class="list">\n${(p.items ?? '')
        .split(/\n/)
        .map((i) => i.trim())
        .filter(Boolean)
        .map((i) => `      <li>${esc(i)}</li>`)
        .join('\n')}\n    </ul>`
    case 'card':
      return `    <div class="card">\n      <h3>${esc(p.title ?? '')}</h3>\n      <p>${esc(p.text ?? '')}</p>\n    </div>`
    case 'badge':
      return `    <p><span class="badge">${esc(p.text ?? '')}</span></p>`
    case 'divider':
      return '    <hr />'
    case 'footer':
      return `    <footer class="footer">${esc(p.text ?? '')}</footer>`
    default:
      return ''
  }
}

export function generateHtml(doc: DesignDoc): CodeFile {
  const css = `:root {
  --primary: ${doc.palette.primary};
  --bg: ${doc.palette.bg};
  --text: ${doc.palette.text};
  --card: ${doc.palette.card};
  --radius: 14px;
}
* { box-sizing: border-box; margin: 0; }
body { font-family: 'Poppins', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; }
.screen { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; display: flex; flex-direction: column; gap: 16px; }
.screen-title { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; opacity: .55; margin-top: 32px; }
.nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--card); padding: 12px 18px; border-radius: var(--radius); box-shadow: 0 1px 4px rgb(0 0 0 / .06); flex-wrap: wrap; }
.nav .brand { font-weight: 700; color: var(--primary); }
.nav nav { display: flex; gap: 14px; flex-wrap: wrap; }
.nav a { color: inherit; text-decoration: none; font-size: 14px; opacity: .8; }
.nav a:hover { opacity: 1; color: var(--primary); }
.hero { background: var(--card); border-radius: var(--radius); padding: 40px 24px; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.hero h1 { font-size: clamp(24px, 5vw, 40px); }
.hero p { opacity: .75; max-width: 46ch; }
.btn { display: inline-block; padding: 10px 20px; border-radius: 999px; font: inherit; font-weight: 600; cursor: pointer; border: 2px solid transparent; text-decoration: none; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { filter: brightness(.95); }
.btn-outline { background: transparent; border-color: var(--primary); color: var(--primary); }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
.field input { padding: 11px 14px; border: 1.5px solid rgb(0 0 0 / .15); border-radius: 10px; font: inherit; background: #fff; width: 100%; }
.field input:focus { outline: 2px solid var(--primary); border-color: transparent; }
.img-ph { background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 18%, #fff), color-mix(in srgb, var(--primary) 6%, #fff)); border-radius: var(--radius); min-height: 140px; display: grid; place-items: center; font-size: 15px; opacity: .8; }
.img-real { width: 100%; height: auto; border-radius: var(--radius); object-fit: cover; max-height: 420px; box-shadow: 0 2px 10px rgb(0 0 0 / .08); }
.list { background: var(--card); border-radius: var(--radius); padding: 14px 18px 14px 34px; }
.card { background: var(--card); border-radius: var(--radius); padding: 18px; box-shadow: 0 1px 4px rgb(0 0 0 / .05); }
.card h3 { margin-bottom: 6px; color: var(--primary); }
.badge { display: inline-block; background: color-mix(in srgb, var(--primary) 15%, #fff); color: var(--primary); font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
hr { border: none; border-top: 1.5px solid rgb(0 0 0 / .08); }
.footer { text-align: center; font-size: 13px; opacity: .6; padding-top: 12px; }
@media (max-width: 640px) { .nav nav { gap: 10px; } .hero { padding: 28px 16px; } }`

  const body = doc.screens
    .map(
      (s, i) =>
        `${i > 0 ? '\n' : ''}  <section class="screen" id="${slug(s.name)}">\n    <p class="screen-title">${esc(s.name)}</p>\n${s.elements
          .map(elHtml)
          .filter(Boolean)
          .join('\n')}\n  </section>`,
    )
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(doc.appName)}</title>
  <style>
${css}
  </style>
</head>
<body>
${body}
</body>
</html>
`
  return { name: 'index.html', lang: 'html', content: html }
}

/* ------------------------------------------------------------------ */
/* Export React (Tailwind, composant unique)                           */
/* ------------------------------------------------------------------ */

function elJsx(el: DesignEl): string {
  const p = el.props
  const t = (v: string | undefined) => (v ?? '').replace(/`/g, '’').replace(/\$\{/g, '·')
  switch (el.type) {
    case 'navbar':
      return `      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <span className="font-bold" style={{ color: primary }}>${t(p.text)}</span>
        <nav className="flex flex-wrap gap-4 text-sm opacity-80">
${(p.links ?? '')
  .split(/[,\n]/)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => `          <a href="#">${t(l)}</a>`)
  .join('\n')}
        </nav>
      </header>`
    case 'hero':
      return `      <section className="flex flex-col items-center gap-3 rounded-2xl bg-white p-8 text-center shadow-sm sm:p-12">
        <h1 className="text-3xl font-bold sm:text-4xl" style={{ color: text }}>${t(p.title)}</h1>
        <p className="max-w-xl opacity-75">${t(p.subtitle)}</p>
        <a className="rounded-full px-6 py-2.5 font-semibold text-white" style={{ background: primary }} href="#">${t(p.cta)}</a>
      </section>`
    case 'text':
      return `      <p className="${p.size === 'lg' ? 'text-lg' : p.size === 'sm' ? 'text-sm' : 'text-base'} opacity-90">${t(p.text)}</p>`
    case 'button':
      return `      <button className="w-fit rounded-full px-5 py-2.5 font-semibold ${p.variant === 'outline' ? 'border-2 bg-transparent' : 'text-white'}" style={${p.variant === 'outline' ? '{ borderColor: primary, color: primary }' : '{ background: primary }'}}>${t(p.text)}</button>`
    case 'input':
      return `      <label className="flex flex-col gap-1.5 text-sm">
        <span>${t(p.label)}</span>
        <input className="w-full rounded-xl border border-black/15 bg-white px-4 py-2.5 outline-none focus:ring-2" style={{ outlineColor: primary }} placeholder="${t(p.placeholder)}" />
      </label>`
    case 'image':
      if (p.src && /^(https?:|data:)/.test(p.src)) {
        return `      <img src="${t(p.src)}" alt="${t(p.alt)}" className="h-auto w-full rounded-2xl object-cover shadow-sm" loading="lazy" />`
      }
      return `      <div className="grid min-h-36 place-items-center rounded-2xl opacity-80" style={{ background: primary + '22' }} role="img" aria-label="${t(p.alt)}">🖼 ${t(p.alt)}</div>`
    case 'list':
      return `      <ul className="list-disc space-y-1 rounded-2xl bg-white p-5 pl-9 shadow-sm">
${(p.items ?? '')
  .split(/\n/)
  .map((i) => i.trim())
  .filter(Boolean)
  .map((i) => `        <li>${t(i)}</li>`)
  .join('\n')}
      </ul>`
    case 'card':
      return `      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <h3 className="mb-1 font-semibold" style={{ color: primary }}>${t(p.title)}</h3>
        <p className="text-sm opacity-80">${t(p.text)}</p>
      </div>`
    case 'badge':
      return `      <span className="w-fit rounded-full px-3 py-1 text-xs font-semibold" style={{ background: primary + '22', color: primary }}>${t(p.text)}</span>`
    case 'divider':
      return '      <hr className="border-black/10" />'
    case 'footer':
      return `      <footer className="pt-3 text-center text-sm opacity-60">${t(p.text)}</footer>`
    default:
      return ''
  }
}

export function generateReact(doc: DesignDoc): CodeFile {
  const screens = doc.screens
    .map(
      (s) =>
        `        {/* Écran : ${s.name} */}\n        <section id="${slug(s.name)}" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">\n${s.elements
          .map(elJsx)
          .filter(Boolean)
          .join('\n')}\n        </section>`,
    )
    .join('\n')

  const jsx = `// ${doc.appName} — généré par Lumo App Design
// Style : ${doc.style} · Palette : ${doc.palette.primary} / ${doc.palette.bg} / ${doc.palette.text}
// Responsive : Tailwind CSS (mobile-first)

export default function App() {
  const primary = '${doc.palette.primary}'
  const text = '${doc.palette.text}'
  return (
    <main className="min-h-dvh" style={{ background: '${doc.palette.bg}', color: text, fontFamily: 'Poppins, system-ui, sans-serif' }}>
${screens}
    </main>
  )
}
`
  return { name: 'App.jsx', lang: 'jsx', content: jsx }
}

/* ------------------------------------------------------------------ */
/* Export FlutterFlow (Dart) + JSON de design                          */
/* ------------------------------------------------------------------ */

function dartWidget(el: DesignEl): string {
  const p = el.props
  const t = (v: string | undefined) => (v ?? '').replace(/'/g, "\\'")
  switch (el.type) {
    case 'navbar':
      return `        AppBar(
          backgroundColor: primary,
          title: Text('${t(p.text)}', style: const TextStyle(color: Colors.white)),
        )`
    case 'hero':
      return `        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Text('${t(p.title)}', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text('${t(p.subtitle)}', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: primary),
                onPressed: () {},
                child: Text('${t(p.cta)}'),
              ),
            ],
          ),
        )`
    case 'text':
      return `        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Text('${t(p.text)}'),
        )`
    case 'button':
      return `        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: primary),
            onPressed: () {},
            child: Text('${t(p.text)}'),
          ),
        )`
    case 'input':
      return `        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: TextField(
            decoration: InputDecoration(
              labelText: '${t(p.label)}',
              hintText: '${t(p.placeholder)}',
              border: const OutlineInputBorder(),
            ),
          ),
        )`
    case 'image':
      if (p.src && /^(https?:|data:)/.test(p.src)) {
        const src = p.src.length > 180 && p.src.startsWith('data:') ? '' : p.src
        return src
          ? `        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Image.network('${t(src)}', height: 180, width: double.infinity, fit: BoxFit.cover),
          ),
        )`
          : `        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          height: 160,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: primary.withOpacity(0.12), borderRadius: BorderRadius.circular(14)),
          child: const Text('Image importée (asset local) — remplacez par un fichier asset'),
        )`
      }
      return `        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          height: 140,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: primary.withOpacity(0.12),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Text('🖼 ${'Image'}'),
        )`
    case 'list':
      return `        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
${(p.items ?? '')
  .split(/\n/)
  .map((i) => i.trim())
  .filter(Boolean)
  .map((i) => `              Text('• ${t(i)}'),`)
  .join('\n')}
            ],
          ),
        )`
    case 'card':
      return `        Card(
          margin: const EdgeInsets.symmetric(horizontal: 16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${t(p.title)}', style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text('${t(p.text)}'),
              ],
            ),
          ),
        )`
    case 'badge':
      return `        Chip(label: Text('${t(p.text)}'))`
    case 'divider':
      return '        const Divider(indent: 16, endIndent: 16)'
    case 'footer':
      return `        Padding(
          padding: const EdgeInsets.all(16),
          child: Center(child: Text('${t(p.text)}', style: const TextStyle(fontSize: 12))),
        )`
    default:
      return ''
  }
}

export function generateFlutterFlow(doc: DesignDoc): CodeFile[] {
  const screens = doc.screens
    .map((s) => {
      const navbar = s.elements.find((e) => e.type === 'navbar')
      const widgets = s.elements
        .filter((e) => e.type !== 'navbar')
        .map(dartWidget)
        .filter(Boolean)
        .join(',\n')
      const bg = doc.palette.bg.replace('#', '').padEnd(6, '0').slice(0, 6).toUpperCase()
      const appbar = navbar
        ? `      appBar: AppBar(
        backgroundColor: primary,
        title: Text('${(navbar.props.text ?? doc.appName).replace(/'/g, '')}', style: const TextStyle(color: Colors.white)),
      ),`
        : `      appBar: AppBar(title: Text('${s.name.replace(/'/g, '')}')),`
      return `class ${pascal(s.name)}Screen extends StatelessWidget {
  const ${pascal(s.name)}Screen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF${bg}),
${appbar}
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 16),
        children: [
${widgets}
        ],
      ),
    );
  }
}`
    })
    .join('\n\n')

  const routes = doc.screens
    .map((s) => `              Text('${s.name.replace(/'/g, '')} → ${pascal(s.name)}Screen'),`)
    .join('\n')

  const dart = `// ${doc.appName} — généré par Lumo App Design (format FlutterFlow)
// Style : ${doc.style}
// Collez chaque écran dans FlutterFlow (Custom Code → Widget) ou utilisez
// flutterflow_design.json pour reproduire la structure visuellement.
import 'package:flutter/material.dart';

const Color primary = Color(0xFF${doc.palette.primary.replace('#', '').padEnd(6, '0').slice(0, 6).toUpperCase()});

void main() => runApp(const ${pascal(doc.appName)}App());

class ${pascal(doc.appName)}App extends StatelessWidget {
  const ${pascal(doc.appName)}App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${doc.appName.replace(/'/g, '')}',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: primary),
        useMaterial3: true,
        fontFamily: 'Poppins',
      ),
      home: const ${pascal(doc.screens[0]?.name ?? 'Accueil')}Screen(),
    );
  }
}

// Navigation (à recréer dans FlutterFlow : Page Navigator entre ces écrans)
// ${routes.replace(/\n/g, '\n// ')}

${screens}
`
  const json: CodeFile = {
    name: 'flutterflow_design.json',
    lang: 'json',
    content: JSON.stringify(doc, null, 2) + '\n',
  }
  return [
    { name: 'main.dart', lang: 'dart', content: dart },
    json,
  ]
}

/* ------------------------------------------------------------------ */
/* Aperçu live : combine html + css + js en un document autonome       */
/* ------------------------------------------------------------------ */

export function buildPreviewSrcDoc(files: CodeFile[]): string | null {
  const html = files.find((f) => f.lang === 'html' || f.name.endsWith('.html'))
  if (!html) return null
  let doc = html.content
  const cssFiles = files.filter((f) => f.lang === 'css' || f.name.endsWith('.css'))
  const jsFiles = files.filter(
    (f) => ['javascript', 'js'].includes(f.lang) || f.name.endsWith('.js'),
  )
  // Remplace les <link rel=stylesheet href="styles.css"> par le contenu inline
  for (const css of cssFiles) {
    doc = doc.replace(
      new RegExp(`<link[^>]*href=["'][^"']*${css.name.replace('.', '\\.')}["'][^>]*>`, 'gi'),
      `<style>\n${css.content}\n</style>`,
    )
  }
  for (const js of jsFiles) {
    doc = doc.replace(
      new RegExp(`<script[^>]*src=["'][^"']*${js.name.replace('.', '\\.')}["'][^>]*>\\s*</script>`, 'gi'),
      `<script>\n${js.content}\n</script>`,
    )
  }
  // Injecte ce qui n’a pas été remplacé
  const restCss = cssFiles.filter((c) => !doc.includes(c.content)).map((c) => c.content).join('\n')
  if (restCss) doc = doc.replace(/<\/head>/i, `<style>\n${restCss}\n</style>\n</head>`)
  const restJs = jsFiles.filter((j) => !doc.includes(j.content)).map((j) => j.content).join('\n')
  if (restJs) doc = doc.replace(/<\/body>/i, `<script>\n${restJs}\n</script>\n</body>`)
  // Poppins dans l’aperçu
  if (!doc.includes('fonts.googleapis.com')) {
    doc = doc.replace(
      /<head[^>]*>/i,
      `<head>\n  <link rel="preconnect" href="https://fonts.googleapis.com" />\n  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet" />`,
    )
  }
  return doc
}

/* ------------------------------------------------------------------ */

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'screen'
  )
}

function pascal(s: string): string {
  const p = slug(s)
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
  return /^[A-Za-z]/.test(p) ? p : 'App' + p
}
