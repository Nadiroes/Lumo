(() => {
  const vw = document.documentElement.clientWidth
  const docW = document.documentElement.scrollWidth
  const offenders = []
  const seen = new Set()
  const all = document.querySelectorAll('body *')
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 3 && r.width > 24) {
      let clipped = false
      let p = el.parentElement
      while (p) {
        const ps = getComputedStyle(p)
        if (/(hidden|clip)/.test(ps.overflowX)) { clipped = true; break }
        if (/(auto|scroll)/.test(ps.overflowX)) {
          // clipé seulement si la boîte scrollable contient réellement l'élément
          clipped = p.scrollWidth <= p.clientWidth + 2 ? false : true
          break
        }
        p = p.parentElement
      }
      if (!clipped) {
        const key = el.tagName + '|' + String(el.className?.baseVal ?? el.className).slice(0, 50) + '|' + Math.round(r.right)
        if (!seen.has(key)) {
          seen.add(key)
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className?.baseVal ?? el.className).slice(0, 80),
            right: Math.round(r.right),
            w: Math.round(r.width),
            text: (el.textContent || '').trim().slice(0, 36),
          })
        }
      }
    }
    if (offenders.length >= 10) break
  }
  return JSON.stringify({ vw, docW, hOverflow: docW > vw + 2, n: offenders.length, offenders }, null, 0)
})()
