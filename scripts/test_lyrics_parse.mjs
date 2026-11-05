// Test unitaire du parsing tolérant des paroles (copie des fonctions de route.ts)
function sanitizeLrc(raw) {
  return raw
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\(?!"\/bfnrtu])/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function tolerantParseLyrics(raw) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  const chunk = raw.slice(start, end + 1)
  try {
    const parsed = JSON.parse(chunk)
    if (parsed?.lrc) return { title: String(parsed.title ?? ''), lrc: String(parsed.lrc) }
  } catch {}
  try {
    const repaired = chunk
      .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    const parsed = JSON.parse(repaired)
    if (parsed?.lrc) return { title: String(parsed.title ?? ''), lrc: String(parsed.lrc) }
  } catch {}
  const lrcMatch = chunk.match(/"lrc"\s*:\s*"([\s\S]*)/)
  if (lrcMatch) {
    let body = lrcMatch[1]
    const lastQuote = body.lastIndexOf('"')
    if (lastQuote > 0) body = body.slice(0, lastQuote)
    const unescaped = body.replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n')
    const titleMatch = chunk.match(/"title"\s*:\s*"([^"]*)"/)
    return { title: titleMatch?.[1] ?? '', lrc: unescaped }
  }
  return undefined
}

// Cas 1 : le bug réel observé — échappement invalide « \e » à la position 233 + \\n littéraux
const broken1 =
  '{\n"title": "Lumière Divine",\n"lrc": "[start]\\n[verse]\\nLe soleil se lève\\nDans mon c\\u0153ur joyeux \\e alléluia\\n[chorus]\\nAlléluia, chantez\\n[outro]"\n}'
// Cas 2 : \\n doublement échappés (littéraux dans le lrc parsé)
const broken2 =
  '{"title": "Gospel Joyeux", "lrc": "[start]\\n[verse]\\nLa lumière du matin\\n[chorus]\\nChante encore\\n[outro]"}'
// Cas 3 : JSON valide + \\n littéraux dans la valeur
const broken3 = '{"title": "Test", "lrc": "[start]\\n[verse]\\nligne un\\nligne deux\\n[chorus]\\nrefrain\\n[outro]"}'

for (const [label, raw] of [['cas1 (échappement invalide)', broken1], ['cas2 (JSON valide)', broken2], ['cas3 (\\n littéraux)', broken3]]) {
  try {
    const parsed = tolerantParseLyrics(raw)
    if (!parsed) {
      console.log(`${label}: ✗ parser a rendu undefined`)
      continue
    }
    const lrc = sanitizeLrc(parsed.lrc)
    const sections = /^\s*\[(?:start|intro|verse|chorus|bridge|outro)\]/im.test(lrc)
    console.log(`${label}: titre="${parsed.title}" | sections=${sections} | aperçu:`, JSON.stringify(lrc.slice(0, 80)))
  } catch (e) {
    console.log(`${label}: ✗ EXCEPTION ${e.message}`)
  }
}
