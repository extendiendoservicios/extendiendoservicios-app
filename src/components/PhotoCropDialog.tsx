import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AVATAR_CROP_VIEWPORT_PX,
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  avatarOffsetToCropRect,
  centeredAvatarOffset,
  clampAvatarOffset,
  computeAvatarDisplayScale,
  loadImageFromFile,
  validateAvatarSourceFile,
  zoomAvatarOffsetAroundCenter,
} from '@/lib/avatarImage'

export interface CropDialogState {
  image: HTMLImageElement
  zoom: number
  offsetX: number
  offsetY: number
}

/**
 * Diálogo de recorte: arrastrar la foto dentro del recuadro cuadrado
 * (puntero o flechas del teclado) y una barra de zoom. La geometría vive en
 * `lib/avatarImage.ts` — acá solo se traduce a estilos y eventos.
 */
export function PhotoCropDialog({
  state,
  onChangeState,
  onCancel,
  onConfirm,
}: {
  state: CropDialogState
  onChangeState: (state: CropDialogState) => void
  onCancel: () => void
  onConfirm: (cropRect: { x: number; y: number; size: number }) => void
}) {
  const { image, zoom, offsetX, offsetY } = state
  const draggingRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startOffsetX: number
    startOffsetY: number
  } | null>(null)

  const displayScale = computeAvatarDisplayScale(
    image.naturalWidth,
    image.naturalHeight,
    AVATAR_CROP_VIEWPORT_PX,
    zoom,
  )
  const displayWidth = image.naturalWidth * displayScale
  const displayHeight = image.naturalHeight * displayScale

  // Al cambiar el zoom, vuelve a acotar el desplazamiento actual para que la
  // imagen siga cubriendo todo el recuadro (si no, un zoom hacia afuera
  // podría dejar un hueco en un borde).
  useEffect(() => {
    const clampedX = clampAvatarOffset(
      offsetX,
      displayWidth,
      AVATAR_CROP_VIEWPORT_PX,
    )
    const clampedY = clampAvatarOffset(
      offsetY,
      displayHeight,
      AVATAR_CROP_VIEWPORT_PX,
    )
    if (clampedX !== offsetX || clampedY !== offsetY) {
      onChangeState({ ...state, offsetX: clampedX, offsetY: clampedY })
    }
    // Solo cuando cambian las dimensiones mostradas (por el zoom): el resto
    // del estado ya está reflejado en las dependencias indirectamente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayWidth, displayHeight])

  /** Fija el desplazamiento a un valor absoluto (arrastre con el puntero), acotado al recuadro. */
  function setOffset(nextOffsetX: number, nextOffsetY: number) {
    onChangeState({
      ...state,
      offsetX: clampAvatarOffset(
        nextOffsetX,
        displayWidth,
        AVATAR_CROP_VIEWPORT_PX,
      ),
      offsetY: clampAvatarOffset(
        nextOffsetY,
        displayHeight,
        AVATAR_CROP_VIEWPORT_PX,
      ),
    })
  }

  /** Desplaza en `deltaX`/`deltaY` desde la posición actual (flechas del teclado). */
  function moveBy(deltaX: number, deltaY: number) {
    setOffset(offsetX + deltaX, offsetY + deltaY)
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    draggingRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: offsetX,
      startOffsetY: offsetY,
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = draggingRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(
      drag.startOffsetX + (event.clientX - drag.startX),
      drag.startOffsetY + (event.clientY - drag.startY),
    )
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (draggingRef.current?.pointerId === event.pointerId) {
      draggingRef.current = null
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = 12
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveBy(step, 0)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveBy(-step, 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveBy(0, step)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveBy(0, -step)
    }
  }

  function handleConfirm() {
    onConfirm(
      avatarOffsetToCropRect({
        offsetX,
        offsetY,
        displayScale,
        viewportPx: AVATAR_CROP_VIEWPORT_PX,
      }),
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustar la foto</DialogTitle>
          <DialogDescription>
            Arrastrá la imagen o usá las flechas del teclado para ubicarla, y la
            barra para acercar o alejar.
          </DialogDescription>
        </DialogHeader>

        {/* No hay un rol ARIA estándar para "arrastrar una imagen dentro de
            un recuadro en dos ejes" (no es un slider de un solo valor):
            `role="group"` describe mejor el contenido para un lector de
            pantalla, con las flechas del teclado como alternativa completa
            al arrastre (`handleKeyDown`) — mismo criterio que
            `input-group.tsx` para su propio caso de un elemento no
            interactivo por definición de ARIA con manejo de puntero propio. */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          role="group"
          aria-label="Recorte de la foto"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative mx-auto overflow-hidden rounded-full bg-bg outline-none focus-visible:ring-3 focus-visible:ring-ring"
          style={{
            width: AVATAR_CROP_VIEWPORT_PX,
            height: AVATAR_CROP_VIEWPORT_PX,
            touchAction: 'none',
            cursor: 'grab',
          }}
        >
          {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
          <img
            src={image.src}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: displayWidth,
              height: displayHeight,
              left: offsetX,
              top: offsetY,
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="avatar-crop-zoom"
            className="text-[11.5px] font-medium text-text-2"
          >
            Zoom
          </label>
          <input
            id="avatar-crop-zoom"
            type="range"
            min={AVATAR_MIN_ZOOM}
            max={AVATAR_MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(event) => {
              const nextZoom = Number(event.target.value)
              // Acerca sobre el centro del recuadro; el efecto de más arriba
              // acota el resultado para que no queden huecos.
              onChangeState({
                ...state,
                zoom: nextZoom,
                ...zoomAvatarOffsetAroundCenter({
                  offsetX,
                  offsetY,
                  fromZoom: zoom,
                  toZoom: nextZoom,
                  viewportPx: AVATAR_CROP_VIEWPORT_PX,
                }),
              })
            }}
            className="w-full accent-primary"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm}>
            Usar esta foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Valida el archivo elegido y arma el estado inicial del recorte (centrado).
 * Devuelve el mensaje de error en español si no se puede usar.
 */
export async function prepareCropState(
  file: File,
): Promise<{ state: CropDialogState } | { error: string }> {
  const validationError = validateAvatarSourceFile(file)
  if (validationError) {
    return { error: validationError }
  }
  try {
    const image = await loadImageFromFile(file)
    // Arranca centrado: con 0/0 una foto apaisada se recortaba por el borde izquierdo.
    return {
      state: {
        image,
        zoom: AVATAR_MIN_ZOOM,
        ...centeredAvatarOffset({
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          viewportPx: AVATAR_CROP_VIEWPORT_PX,
          zoom: AVATAR_MIN_ZOOM,
        }),
      },
    }
  } catch {
    return { error: 'No pudimos leer esa imagen. Probá con otro archivo.' }
  }
}
