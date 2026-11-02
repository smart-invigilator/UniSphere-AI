import { useCallback, useEffect, useRef, useState } from 'react'

export function useDialogState(editor) {
  const [open, setOpenState] = useState(false)
  const lockedRef = useRef(false)

  const release = useCallback(() => {
    if (!lockedRef.current) return
    lockedRef.current = false
    const lock = editor?.storage?.modalLock
    if (lock) lock.count = Math.max(0, lock.count - 1)
  }, [editor])

  const setOpen = useCallback(
    (value) => {
      if (value && !lockedRef.current) {
        lockedRef.current = true
        const lock = editor?.storage?.modalLock
        if (lock) lock.count += 1
        editor?.view?.dom?.blur()
      } else if (!value) {
        release()
      }
      setOpenState(!!value)
    },
    [editor, release],
  )

  useEffect(() => () => release(), [release])

  return [open, setOpen]
}