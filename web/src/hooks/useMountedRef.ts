import { useEffect, useRef } from 'react'

/** Async completions may update their caller only while it remains mounted. */
export function useMountedRef() {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  return mounted
}
