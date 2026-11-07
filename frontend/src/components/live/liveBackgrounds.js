// Built-in virtual backgrounds for live classes. SVG scenes and public image
// assets are rasterised to PNG on demand because the video processor needs a
// bitmap.

const svg = (body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs>${defs}</defs>${body}</svg>`

const grad = (id, stops, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('')}</linearGradient>`

const stars = (n, seed = 7) => {
  let s = seed
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  return Array.from({ length: n }, () => `<circle cx="${(rnd() * 1280).toFixed(0)}" cy="${(rnd() * 560).toFixed(0)}" r="${(rnd() * 1.8 + 0.4).toFixed(1)}" fill="#fff" opacity="${(rnd() * 0.7 + 0.3).toFixed(2)}"/>`).join('')
}

const skyline = (color, seed, base, minH, maxH) => {
  let s = seed
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  let x = -20
  let out = ''
  while (x < 1300) {
    const w = 50 + rnd() * 70
    const h = minH + rnd() * (maxH - minH)
    out += `<rect x="${x.toFixed(0)}" y="${(base - h).toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${color}"/>`
    x += w + 4
  }
  return out
}

const windows = (seed) => {
  let s = seed
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  let out = ''
  for (let i = 0; i < 90; i += 1) {
    out += `<rect x="${(rnd() * 1260).toFixed(0)}" y="${(330 + rnd() * 330).toFixed(0)}" width="8" height="12" fill="#fde68a" opacity="${(rnd() * 0.6 + 0.3).toFixed(2)}"/>`
  }
  return out
}

const plant = (x, y, s = 1) =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-30 0h60l-10 70h-40z" fill="#b45309"/><path d="M0 0C-50-60-70-20-40 0M0 0C-10-90 30-90 20 0M0 0C50-60 70-20 40 0" fill="#16a34a" stroke="#15803d" stroke-width="3"/></g>`

export const BACKGROUNDS = [
  {
    id: 'office',
    label: 'Modern office',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#w)"/><rect y="560" width="1280" height="160" fill="#c8b79e"/>
       <rect x="120" y="120" width="360" height="280" rx="6" fill="url(#sky)" stroke="#f8fafc" stroke-width="14"/>
       <path d="M300 120v280M120 260h360" stroke="#f8fafc" stroke-width="10"/>
       <rect x="720" y="150" width="420" height="22" fill="#78350f"/><rect x="740" y="60" width="70" height="90" fill="#0ea5e9"/><rect x="830" y="80" width="60" height="70" fill="#f59e0b"/><rect x="910" y="40" width="80" height="110" fill="#10b981"/><rect x="1010" y="70" width="70" height="80" fill="#6366f1"/>
       <rect x="720" y="330" width="420" height="22" fill="#78350f"/><rect x="750" y="250" width="80" height="80" fill="#ef4444"/><rect x="850" y="270" width="70" height="60" fill="#14b8a6"/><rect x="940" y="240" width="90" height="90" fill="#eab308"/>
       ${plant(620, 490, 1.3)}
       <rect x="0" y="540" width="1280" height="26" fill="#a8977e"/>`,
      grad('w', [[0, '#f1f5f9'], [1, '#cbd5e1']]) + grad('sky', [[0, '#7dd3fc'], [1, '#e0f2fe']]),
    ),
  },
  {
    id: 'library',
    label: 'Library',
    svg: svg(
      `<rect width="1280" height="720" fill="#5b3a29"/>${[0, 1, 2].map((r) => `<rect x="60" y="${60 + r * 200}" width="1160" height="12" fill="#3f2a1d"/>`).join('')}
       ${[0, 1, 2].map((r) => Array.from({ length: 26 }, (_, i) => {
         const colors = ['#b91c1c', '#1d4ed8', '#15803d', '#a16207', '#7e22ce', '#0f766e', '#be185d']
         const h = 90 + ((i * 37 + r * 19) % 40)
         return `<rect x="${70 + i * 44}" y="${60 + r * 200 - h + 12 - 12 + 0}" width="${34 + (i % 3) * 3}" height="${h}" fill="${colors[(i + r * 3) % colors.length]}"/>`
       }).join('')).join('')}
       <rect y="650" width="1280" height="70" fill="#3f2a1d"/>
       <circle cx="640" cy="640" r="0" fill="none"/>`,
    ),
  },
  {
    id: 'classroom',
    label: 'Classroom',
    svg: svg(
      `<rect width="1280" height="720" fill="#e7dcc6"/><rect y="560" width="1280" height="160" fill="#b08968"/>
       <rect x="220" y="90" width="840" height="360" rx="8" fill="#14532d" stroke="#a16207" stroke-width="18"/>
       <text x="640" y="230" font-family="Georgia,serif" font-size="64" fill="#f1f5f9" text-anchor="middle" opacity=".9">Welcome to class</text>
       <path d="M320 320q120-60 240 0t240 0t160 0" stroke="#f1f5f9" stroke-width="5" fill="none" opacity=".7"/>
       <rect x="240" y="450" width="800" height="14" fill="#a16207"/>
       <circle cx="110" cy="150" r="62" fill="#fff" stroke="#475569" stroke-width="8"/><path d="M110 150V105M110 150l30 18" stroke="#475569" stroke-width="6"/>`,
    ),
  },
  {
    id: 'beach',
    label: 'Sunset beach',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#sky)"/><circle cx="640" cy="360" r="90" fill="#fde68a"/>
       <rect y="380" width="1280" height="160" fill="url(#sea)"/><path d="M0 540q320-40 640 0t640 0v180H0z" fill="#f3d9a4"/>
       <path d="M0 520q200 30 400 0t400 0t480 0" stroke="#fff" stroke-width="5" fill="none" opacity=".6"/>
       <path d="M1020 700c-20-120-10-220 20-330" stroke="#78350f" stroke-width="16" fill="none"/>
       <path d="M1040 370c-70-40-130-20-170 30M1040 370c60-50 120-40 160 10M1040 370c-20-70-70-90-120-80M1040 370c40-70 100-80 140-50" stroke="#15803d" stroke-width="12" fill="none" stroke-linecap="round"/>`,
      grad('sky', [[0, '#7c3aed'], [0.5, '#fb7185'], [1, '#fdba74']]) + grad('sea', [[0, '#f59e0b'], [1, '#1d4ed8']]),
    ),
  },
  {
    id: 'mountains',
    label: 'Mountain lake',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#sky)"/>
       <path d="M0 470L220 220l140 150 170-230 210 270 150-120 390 180v250H0z" fill="#64748b"/>
       <path d="M220 220l-50 60 40-14 30 30 30-34zM530 140l-60 80 50-20 40 30 40-36z" fill="#f8fafc"/>
       <path d="M0 520L180 400l140 90 190-130 200 160 150-90 420 130v160H0z" fill="#334155"/>
       <rect y="540" width="1280" height="180" fill="url(#lake)"/>`,
      grad('sky', [[0, '#38bdf8'], [1, '#e0f2fe']]) + grad('lake', [[0, '#0e7490'], [1, '#164e63']]),
    ),
  },
  {
    id: 'forest',
    label: 'Forest',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#sky)"/>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
        const x = i * 115 + (i % 2) * 30
        const h = 320 + ((i * 53) % 160)
        return `<path d="M${x} 600l60-${h}l60 ${h}z" fill="${i % 2 ? '#166534' : '#15803d'}"/><path d="M${x + 14} ${600 - h * 0.45}l46-${h * 0.55}l46 ${h * 0.55}z" fill="${i % 2 ? '#14532d' : '#166534'}" opacity=".8"/><rect x="${x + 55}" y="600" width="10" height="60" fill="#78350f"/>`
      }).join('')}
       <rect y="620" width="1280" height="100" fill="#14532d"/>`,
      grad('sky', [[0, '#bbf7d0'], [1, '#ecfccb']]),
    ),
  },
  {
    id: 'city-night',
    label: 'City at night',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#sky)"/>${stars(70)}<circle cx="1050" cy="130" r="48" fill="#fef9c3"/>
       ${skyline('#1e293b', 11, 720, 220, 420)}${windows(5)}${skyline('#0f172a', 3, 720, 120, 260)}`,
      grad('sky', [[0, '#0f172a'], [1, '#4338ca']]),
    ),
  },
  {
    id: 'space',
    label: 'Galaxy',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#bg)"/><ellipse cx="760" cy="330" rx="520" ry="150" fill="url(#gal)" transform="rotate(-18 760 330)"/>
       ${stars(180, 21)}<circle cx="170" cy="540" r="90" fill="url(#planet)"/><ellipse cx="170" cy="540" rx="150" ry="22" fill="none" stroke="#fcd34d" stroke-width="6" opacity=".7" transform="rotate(-20 170 540)"/>`,
      `<radialGradient id="bg" cx=".5" cy=".4" r=".9"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#020617"/></radialGradient>
       <radialGradient id="gal"><stop offset="0" stop-color="#f0abfc" stop-opacity=".85"/><stop offset=".5" stop-color="#8b5cf6" stop-opacity=".35"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
       <radialGradient id="planet" cx=".35" cy=".35"><stop offset="0" stop-color="#fb923c"/><stop offset="1" stop-color="#9a3412"/></radialGradient>`,
    ),
  },
  {
    id: 'living-room',
    label: 'Cozy room',
    svg: svg(
      `<rect width="1280" height="720" fill="#fde7d3"/><rect y="580" width="1280" height="140" fill="#a16207" opacity=".55"/>
       <rect x="330" y="360" width="620" height="200" rx="30" fill="#0d9488"/><rect x="300" y="400" width="90" height="170" rx="26" fill="#0f766e"/><rect x="890" y="400" width="90" height="170" rx="26" fill="#0f766e"/>
       <rect x="380" y="320" width="150" height="100" rx="20" fill="#fbbf24"/><rect x="740" y="320" width="150" height="100" rx="20" fill="#f472b6"/>
       <rect x="110" y="90" width="210" height="150" fill="#fff" stroke="#92400e" stroke-width="10"/><circle cx="215" cy="165" r="38" fill="#fb923c"/>
       <rect x="960" y="110" width="170" height="130" fill="#fff" stroke="#92400e" stroke-width="10"/><path d="M970 230l50-60 40 40 30-30 40 50z" fill="#4ade80"/>
       ${plant(1130, 520, 1.1)}<path d="M640 80v100" stroke="#78350f" stroke-width="4"/><path d="M590 180h100l-20 50h-60z" fill="#f59e0b"/>`,
    ),
  },
  {
    id: 'blue-gradient',
    label: 'Calm blue',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#g)"/><circle cx="220" cy="140" r="220" fill="#fff" opacity=".07"/><circle cx="1060" cy="560" r="320" fill="#fff" opacity=".07"/><circle cx="800" cy="120" r="110" fill="#fff" opacity=".06"/>`,
      grad('g', [[0, '#1d4ed8'], [1, '#22d3ee']], 1, 1),
    ),
  },
  {
    id: 'sunrise-hills',
    label: 'Sunrise hills',
    svg: svg(
      `<rect width="1280" height="720" fill="url(#sky)"/><circle cx="880" cy="420" r="110" fill="#fff7ed" opacity=".95"/>
       <path d="M0 480q260-120 520-30t520-60 240 50v280H0z" fill="#fb923c" opacity=".65"/>
       <path d="M0 540q320-110 640-20t640-30v230H0z" fill="#16a34a"/><path d="M0 620q360-90 720-10t560-30v140H0z" fill="#15803d"/>`,
      grad('sky', [[0, '#fde68a'], [1, '#f9a8d4']]),
    ),
  },
  {
    id: 'cafe',
    label: 'Coffee shop',
    svg: svg(
      `<rect width="1280" height="720" fill="#d6b99a"/><rect y="520" width="1280" height="200" fill="#7c4a2d"/>
       <rect x="80" y="70" width="1120" height="14" fill="#44403c"/>${[0, 1, 2, 3, 4].map((i) => `<path d="M${200 + i * 220} 84v90" stroke="#44403c" stroke-width="4"/><path d="M${160 + i * 220} 174h80l-14 50h-52z" fill="${['#f59e0b', '#ef4444', '#10b981', '#6366f1', '#f59e0b'][i]}"/>`).join('')}
       <rect x="100" y="270" width="480" height="190" rx="8" fill="#292524"/><text x="340" y="365" font-family="Georgia,serif" font-size="56" fill="#fef3c7" text-anchor="middle">Café</text><text x="340" y="420" font-family="sans-serif" font-size="26" fill="#fde68a" text-anchor="middle">coffee · tea · study</text>
       <rect x="680" y="430" width="500" height="26" fill="#44403c"/><rect x="720" y="456" width="18" height="100" fill="#44403c"/><rect x="1120" y="456" width="18" height="100" fill="#44403c"/>
       <rect x="800" y="370" width="60" height="60" rx="8" fill="#fff"/><rect x="920" y="380" width="60" height="50" rx="8" fill="#fef3c7"/>`,
    ),
  },
  {
    id: 'image-48d1s0',
    label: 'Purple Panels',
    imagePath: '/backgrounds/PurplePanels.jpg',
  },
  {
    id: 'image-6los5k',
    label: 'Botanical Gallery',
    imagePath: '/backgrounds/BotanicalGallery.jpg',
  },
  {
    id: 'image-7gpx74',
    label: 'Retro Nook',
    imagePath: '/backgrounds/RetroNook.jpg',
  },
  {
    id: 'image-f9a4cw',
    label: 'Zen Tatami',
    imagePath: '/backgrounds/ZenTatami.jpg',
  },
  {
    id: 'image-wz7ja1',
    label: 'RGB Noir',
    imagePath: '/backgrounds/RgbNoir.jpg',
  },
  {
    id: 'image-zdukd1',
    label: 'Natural Study',
    imagePath: '/backgrounds/NaturalStudy.jpg',
  },
]

export const BLUR_OPTION = { id: 'blur', label: 'Blur' }
export const NO_BACKGROUND = { id: 'none', label: 'None' }

export const svgToDataUrl = (markup) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

const rasterCache = new Map()

// The segmentation processor needs a regular bitmap; rasterise each background once and reuse it.
export function rasterizeBackground(id) {
  const bg = BACKGROUNDS.find((b) => b.id === id)
  if (!bg) return Promise.reject(new Error('Unknown background'))
  if (!rasterCache.has(id)) {
    rasterCache.set(id, new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1280
        canvas.height = 720
        canvas.getContext('2d').drawImage(img, 0, 0, 1280, 720)
        canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('Could not prepare background'))), 'image/png')
      }
      img.onerror = () => reject(new Error('Could not load background'))
      img.src = bg.imagePath || svgToDataUrl(bg.svg)
    }))
  }
  return rasterCache.get(id)
}

export const BACKGROUND_STORAGE_KEY = 'live.background'
