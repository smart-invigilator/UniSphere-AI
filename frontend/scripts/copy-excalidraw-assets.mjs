import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts')
const target = join(root, 'public', 'excalidraw-assets', 'fonts')

if (!existsSync(source)) {
  console.warn('[excalidraw-assets] Excalidraw fonts not found, skipping copy.')
  process.exit(0)
}
if (!existsSync(target)) {
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
  console.log('[excalidraw-assets] Copied Excalidraw fonts to public/excalidraw-assets/fonts')
}
