import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * A hand-rolled canvas crop-to-square, chosen over a library per
 * STEP-01-identity.md ("a simple crop-to-square is fine; check if a
 * lightweight, zero-cost cropper library is worth adding"). The candidates
 * (react-easy-crop, react-image-crop) are MIT and would work, but for a
 * fixed-aspect-ratio square crop the actual crop math is ~30 lines and
 * pulling a dependency for it is not obviously a win — this keeps the
 * bundle smaller and the behavior fully inspectable. Revisit if a later
 * step needs non-square/free-aspect cropping.
 */

const CONTAINER_SIZE = 288
const OUTPUT_SIZE = 512
const MIN_ZOOM = 1
const MAX_ZOOM = 3

export interface AvatarCropperProps {
  file: File
  onCancel: () => void
  onCropped: (blob: Blob) => void
  submitting?: boolean
}

export function AvatarCropper({ file, onCancel, onCropped, submitting }: AvatarCropperProps) {
  const objectUrl = useMemo(() => URL.createObjectURL(file), [file])
  const imgRef = useRef<HTMLImageElement>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragState = useRef<{ startX: number; startY: number; origin: { x: number; y: number } } | null>(
    null,
  )

  useEffect(() => {
    return () => URL.revokeObjectURL(objectUrl)
  }, [objectUrl])

  const baseScale = naturalSize
    ? CONTAINER_SIZE / Math.min(naturalSize.w, naturalSize.h)
    : 1
  const effectiveScale = baseScale * zoom
  const displayWidth = naturalSize ? naturalSize.w * effectiveScale : CONTAINER_SIZE
  const displayHeight = naturalSize ? naturalSize.h * effectiveScale : CONTAINER_SIZE

  function clampOffset(x: number, y: number) {
    const maxX = Math.max(0, (displayWidth - CONTAINER_SIZE) / 2)
    const maxY = Math.max(0, (displayHeight - CONTAINER_SIZE) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragState.current = { startX: event.clientX, startY: event.clientY, origin: offset }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragState.current) return
    const dx = event.clientX - dragState.current.startX
    const dy = event.clientY - dragState.current.startY
    setOffset(clampOffset(dragState.current.origin.x + dx, dragState.current.origin.y + dy))
  }

  function handlePointerUp() {
    dragState.current = null
  }

  function handleZoomChange(next: number) {
    setZoom(next)
    setOffset((prev) => clampOffset(prev.x, prev.y))
  }

  function handleConfirm() {
    const img = imgRef.current
    if (!img || !naturalSize) return

    const imgTopLeftX = CONTAINER_SIZE / 2 + offset.x - displayWidth / 2
    const imgTopLeftY = CONTAINER_SIZE / 2 + offset.y - displayHeight / 2
    const srcX = -imgTopLeftX / effectiveScale
    const srcY = -imgTopLeftY / effectiveScale
    const srcSize = CONTAINER_SIZE / effectiveScale

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

    canvas.toBlob(
      (blob) => {
        if (blob) onCropped(blob)
      },
      'image/jpeg',
      0.9,
    )
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative touch-none overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10"
        style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={objectUrl}
          alt="Avatar preview, drag to reposition"
          draggable={false}
          onLoad={(event) => {
            const el = event.currentTarget
            setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight })
          }}
          className="absolute top-1/2 left-1/2 max-w-none cursor-grab select-none active:cursor-grabbing"
          style={{
            width: displayWidth,
            height: displayHeight,
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
          }}
        />
      </div>

      <div className="flex w-full max-w-xs items-center gap-2">
        <span className="text-xs text-muted-foreground">Zoom</span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(event) => handleZoomChange(Number(event.target.value))}
          className="w-full"
          aria-label="Zoom"
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="button" onClick={handleConfirm} disabled={submitting || !naturalSize}>
          {submitting ? 'Uploading…' : 'Use this photo'}
        </Button>
      </div>
    </div>
  )
}
