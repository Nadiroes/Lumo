/**
 * Bibliothèque visuelle du studio App Design :
 * - icônes (Lucide, noms stabilisés)
 * - photos réelles libres (Picsum, seedés = stables)
 * - illustrations SVG générées localement (data URLs, aucun réseau requis)
 */

export const ICON_LIBRARY: { name: string; label: string }[] = [
  { name: 'Home', label: 'Accueil' },
  { name: 'User', label: 'Utilisateur' },
  { name: 'Users', label: 'Équipe' },
  { name: 'Settings', label: 'Réglages' },
  { name: 'Search', label: 'Recherche' },
  { name: 'Bell', label: 'Notification' },
  { name: 'Heart', label: 'Favori' },
  { name: 'Star', label: 'Étoile' },
  { name: 'ShoppingCart', label: 'Panier' },
  { name: 'CreditCard', label: 'Paiement' },
  { name: 'Calendar', label: 'Calendrier' },
  { name: 'Clock', label: 'Horloge' },
  { name: 'MapPin', label: 'Lieu' },
  { name: 'Camera', label: 'Photo' },
  { name: 'Image', label: 'Galerie' },
  { name: 'Music', label: 'Musique' },
  { name: 'Headphones', label: 'Écoute' },
  { name: 'Video', label: 'Vidéo' },
  { name: 'Mic', label: 'Micro' },
  { name: 'Mail', label: 'E-mail' },
  { name: 'MessageCircle', label: 'Message' },
  { name: 'Phone', label: 'Téléphone' },
  { name: 'Send', label: 'Envoyer' },
  { name: 'Download', label: 'Télécharger' },
  { name: 'Upload', label: 'Importer' },
  { name: 'Cloud', label: 'Cloud' },
  { name: 'Lock', label: 'Sécurité' },
  { name: 'Key', label: 'Clé' },
  { name: 'ChartBar', label: 'Stats' },
  { name: 'TrendingUp', label: 'Croissance' },
  { name: 'Wallet', label: 'Portefeuille' },
  { name: 'Gift', label: 'Cadeau' },
  { name: 'Tag', label: 'Étiquette' },
  { name: 'Truck', label: 'Livraison' },
  { name: 'Coffee', label: 'Café' },
  { name: 'UtensilsCrossed', label: 'Restaurant' },
  { name: 'Plane', label: 'Voyage' },
  { name: 'Car', label: 'Voiture' },
  { name: 'Dumbbell', label: 'Sport' },
  { name: 'BookOpen', label: 'Lecture' },
  { name: 'GraduationCap', label: 'École' },
  { name: 'Stethoscope', label: 'Santé' },
  { name: 'PawPrint', label: 'Animal' },
  { name: 'Leaf', label: 'Nature' },
  { name: 'Sun', label: 'Soleil' },
  { name: 'Zap', label: 'Énergie' },
  { name: 'Play', label: 'Lecture' },
  { name: 'Sparkles', label: 'Magie' },
]

/** Photos réelles libres de droits (Picsum) — graines stables pour un rendu constant */
export const PHOTO_LIBRARY: { seed: string; label: string }[] = [
  { seed: 'lumo-cafe', label: 'Café / ambiance chaude' },
  { seed: 'lumo-city', label: 'Ville / architecture' },
  { seed: 'lumo-nature', label: 'Nature / forêt' },
  { seed: 'lumo-ocean', label: 'Océan / plage' },
  { seed: 'lumo-office', label: 'Bureau / travail' },
  { seed: 'lumo-food', label: 'Cuisine / plats' },
  { seed: 'lumo-sport', label: 'Sport / énergie' },
  { seed: 'lumo-tech', label: 'Technologie' },
  { seed: 'lumo-travel', label: 'Voyage' },
  { seed: 'lumo-fashion', label: 'Mode / style' },
  { seed: 'lumo-abstract', label: 'Abstrait' },
  { seed: 'lumo-night', label: 'Nuit / ambiance' },
]

export function photoUrl(seed: string, w = 800, h = 560): string {
  return `https://picsum.photos/seed/${seed}/${w}/${h}`
}

/** Illustrations SVG générées localement (graines) — data URLs hors ligne */
const ILLUSTRATION_PALETTES: [string, string, string][] = [
  ['#E8930C', '#FDE68A', '#FDF9F0'],
  ['#2563EB', '#93C5FD', '#EFF6FF'],
  ['#10B981', '#6EE7B7', '#ECFDF5'],
  ['#8B5CF6', '#C4B5FD', '#F5F3FF'],
  ['#EF4444', '#FCA5A5', '#FEF2F2'],
  ['#0EA5E9', '#7DD3FC', '#F0F9FF'],
]

export function illustrationUrl(i: number): string {
  const [c1, c2, bg] = ILLUSTRATION_PALETTES[i % ILLUSTRATION_PALETTES.length]
  const seed = i * 7919
  const cx = (n: number) => 60 + ((seed * (n + 3)) % 320)
  const cy = (n: number) => 40 + ((seed * (n + 7)) % 240)
  const r = (n: number) => 40 + ((seed * (n + 11)) % 90)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">
  <rect width="480" height="320" rx="18" fill="${bg}"/>
  <circle cx="${cx(1)}" cy="${cy(1)}" r="${r(1)}" fill="${c1}" opacity="0.82"/>
  <circle cx="${cx(2)}" cy="${cy(2)}" r="${r(2) / 2}" fill="${c2}" opacity="0.9"/>
  <rect x="${cx(3) - 60}" y="${cy(3)}" width="150" height="90" rx="16" fill="${c2}" opacity="0.55" transform="rotate(-8 ${cx(3)} ${cy(3)})"/>
  <circle cx="${cx(4)}" cy="${cy(4)}" r="${r(3) / 3}" fill="${c1}" opacity="0.5"/>
  <path d="M0 ${230 + (seed % 50)} Q 120 ${150 + (seed % 80)} 240 ${240 + (seed % 40)} T 480 ${200 + (seed % 60)} V 320 H 0 Z" fill="${c1}" opacity="0.25"/>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
