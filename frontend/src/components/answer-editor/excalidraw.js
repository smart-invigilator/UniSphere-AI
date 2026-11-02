let loader = null

export function loadExcalidraw() {
  if (!loader) {
    window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw-assets/`
    loader = Promise.all([import('@excalidraw/excalidraw/index.css'), import('@excalidraw/excalidraw')]).then(([, mod]) => mod)
    loader.catch(() => {
      loader = null
    })
  }
  return loader
}

export async function sceneToSvg(scene) {
  const { exportToSvg } = await loadExcalidraw()
  const elements = scene?.elements || []
  return exportToSvg({
    elements,
    appState: {
      exportBackground: true,
      viewBackgroundColor: scene?.appState?.viewBackgroundColor || '#ffffff',
      exportWithDarkMode: false,
    },
    files: null,
    exportPadding: 12,
  })
}