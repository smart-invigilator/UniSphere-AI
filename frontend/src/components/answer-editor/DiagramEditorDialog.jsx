import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { loadExcalidraw } from './excalidraw'
import { sanitizeScene } from './schema'

export default function DiagramEditorDialog({ scene, onSave, onCancel }) {
  const [mod, setMod] = useState(null)
  const [error, setError] = useState(null)
  const apiRef = useRef(null)
  const rootRef = useRef(null)
  const initialData = useRef({
    elements: JSON.parse(JSON.stringify(scene?.elements || [])),
    appState: { viewBackgroundColor: scene?.appState?.viewBackgroundColor || '#ffffff', currentItemFontFamily: 1 },
    scrollToContent: true,
  })

  useEffect(() => {
    rootRef.current?.focus()
    loadExcalidraw().then(setMod).catch(() => setError('The diagram editor could not be loaded. Check your connection and try again.'))
  }, [])

  const save = () => {
    const api = apiRef.current
    if (!api) return
    const elements = JSON.parse(JSON.stringify(api.getSceneElements()))
    onSave(sanitizeScene({ elements, appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor } }))
  }

  const Excalidraw = mod?.Excalidraw
  const MainMenu = mod?.MainMenu

  return createPortal(
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-[80] flex flex-col bg-white outline-none dark:bg-slate-950" role="dialog" aria-modal="true" aria-label="Diagram editor">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Diagram editor</p>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-slate-700 dark:text-slate-300">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={!Excalidraw} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-500">
            Save diagram
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {error && <p className="p-6 text-sm text-rose-600">{error}</p>}
        {!Excalidraw && !error && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading diagram editor…
          </div>
        )}
        {Excalidraw && (
          <div className="absolute inset-0">
            <Excalidraw
              initialData={initialData.current}
              excalidrawAPI={(api) => { apiRef.current = api }}
              UIOptions={{
                tools: { image: false },
                canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: true, changeViewBackgroundColor: true, clearCanvas: true },
              }}
              detectScroll={false}
              autoFocus
            >
              <MainMenu>
                <MainMenu.DefaultItems.ClearCanvas />
                <MainMenu.DefaultItems.ChangeCanvasBackground />
                <MainMenu.DefaultItems.ToggleTheme />
              </MainMenu>
            </Excalidraw>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}