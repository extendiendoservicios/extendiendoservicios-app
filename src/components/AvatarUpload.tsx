import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { supabase } from '@/lib/supabase'
import { avatarUrl } from '@/lib/avatarUrl'
import {
  AVATAR_ACCEPTED_MIME_TYPES,
  AVATAR_CROP_VIEWPORT_PX,
  AVATAR_MAX_ZOOM,
  AVATAR_MIN_ZOOM,
  avatarOffsetToCropRect,
  avatarStoragePath,
  clampAvatarOffset,
  computeAvatarDisplayScale,
  cropAndResizeToBlob,
  loadImageFromFile,
  validateAvatarSourceFile,
} from '@/lib/avatarImage'

/**
 * `AvatarUpload` (EMP-011, `07` fila FileUpload/AvatarUpload): elegir una
 * foto, recortarla en cuadrado con arrastre y zoom, redimensionarla a 512 px
 * en el cliente, subirla al bucket `avatars` y guardar la ruta nueva en
 * `profiles.avatar_path` — o quitar la foto existente.
 *
 * Pensado para dos usos (mismo componente, sin variantes):
 * - COM-04 (`ProfilePage.tsx`): `profileId` es la propia sesión.
 * - ADM-18 (front-admin, P09.3/P09.4): `profileId` es el de otra persona.
 *   Las políticas de Storage y de `profiles` ya habilitan esto para
 *   owner/admin (`0014_storage_buckets.sql`: `app.is_admin() or
 *   (storage.foldername(name))[1] = auth.uid()::text`; `04` sección 6:
 *   "O, A: todas las columnas" de `profiles`) — no hace falta ninguna
 *   política nueva, verificado contra las migraciones antes de escribir
 *   este componente.
 *
 * El componente hace la persistencia completa (Storage + `profiles`) y
 * avisa con `onChange`: quien lo usa solo necesita reflejar la ruta nueva
 * en su propio estado (por ejemplo `auth.refreshProfile()` en COM-04), no
 * repetir la subida.
 */
export interface AvatarUploadProps {
  /** Perfil dueño de la foto (`profiles.id`): define la carpeta en `avatars` y a quién se le guarda `avatar_path`. */
  profileId: string
  /** Nombre completo: color e iniciales del fallback, y lo que anuncia un lector de pantalla. */
  name: string
  /** `profiles.avatar_path` actual, o `null` sin foto todavía. */
  avatarPath: string | null
  /** Se llama después de subir o quitar la foto, con la ruta nueva (`null` si se quitó). */
  onChange?: (avatarPath: string | null) => void
  /** Contenedor que define el ancho/alto del widget (con el botón de cámara posicionado adentro). */
  className?: string
}

type UploadStatus = 'idle' | 'uploading' | 'removing'

export function AvatarUpload({
  profileId,
  name,
  avatarPath,
  onChange,
  className,
}: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cropState, setCropState] = useState<CropDialogState | null>(null)

  const photoUrl = avatarPath ? avatarUrl(avatarPath) : null
  const busy = status !== 'idle'

  function openPicker() {
    setError(null)
    fileInputRef.current?.click()
  }

  async function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null
    // Limpia el input para poder elegir el mismo archivo dos veces seguidas
    // (por ejemplo, después de cancelar el recorte).
    event.target.value = ''
    if (!file) return

    const validationError = validateAvatarSourceFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      const image = await loadImageFromFile(file)
      setCropState({ image, zoom: AVATAR_MIN_ZOOM, offsetX: 0, offsetY: 0 })
    } catch {
      setError('No pudimos leer esa imagen. Probá con otro archivo.')
    }
  }

  async function handleConfirmCrop(cropRect: {
    x: number
    y: number
    size: number
  }) {
    const image = cropState?.image
    setCropState(null)
    if (!image) return

    setStatus('uploading')
    setError(null)
    try {
      const blob = await cropAndResizeToBlob(image, cropRect)
      const path = avatarStoragePath(profileId)
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) {
        throw new Error(
          'No pudimos subir la foto. Revisá tu conexión y probá de nuevo.',
        )
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_path: path })
        .eq('id', profileId)
      if (updateError) {
        // La foto ya se subió: se intenta borrar para no dejar un objeto
        // huérfano en el bucket (mejor esfuerzo, sin bloquear el aviso del
        // error real a la persona).
        await supabase.storage.from('avatars').remove([path])
        throw new Error(
          'No pudimos guardar la foto en el perfil. Probá de nuevo.',
        )
      }

      const previousPath = avatarPath
      if (previousPath) {
        // Mejor esfuerzo: si falla, queda un archivo viejo sin referencia
        // (no rompe nada, solo ocupa espacio) — no es un error para mostrar.
        await supabase.storage.from('avatars').remove([previousPath])
      }

      onChange?.(path)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos subir la foto. Probá de nuevo.',
      )
    } finally {
      setStatus('idle')
    }
  }

  async function handleRemove() {
    if (!avatarPath) return
    setStatus('removing')
    setError(null)
    const pathToRemove = avatarPath
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_path: null })
      .eq('id', profileId)
    if (updateError) {
      setError('No pudimos quitar la foto. Probá de nuevo.')
      setStatus('idle')
      return
    }
    await supabase.storage.from('avatars').remove([pathToRemove])
    onChange?.(null)
    setStatus('idle')
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative shrink-0">
        <Avatar id={profileId} name={name} src={photoUrl} size="lg" />
        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          aria-label="Cambiar foto de perfil"
          className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full border-2 border-surface bg-primary text-white outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50"
        >
          <Camera aria-hidden="true" className="size-[15px]" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openPicker}
            loading={status === 'uploading'}
            disabled={busy}
          >
            {avatarPath ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {avatarPath && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={() => void handleRemove()}
              loading={status === 'removing'}
              disabled={busy}
            >
              Quitar foto
            </Button>
          )}
        </div>
        <p className="text-[11px] text-text-3">
          JPG, PNG o WEBP. Se recorta en cuadrado y se ajusta a 512×512 antes de
          subirla.
        </p>
        {error && (
          <Alert variant="crit">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={AVATAR_ACCEPTED_MIME_TYPES.join(',')}
        className="sr-only"
        onChange={(event) => void handleFileSelected(event)}
      />

      {cropState && (
        <AvatarCropDialog
          state={cropState}
          onChangeState={setCropState}
          onCancel={() => setCropState(null)}
          onConfirm={(cropRect) => void handleConfirmCrop(cropRect)}
        />
      )}
    </div>
  )
}

interface CropDialogState {
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
function AvatarCropDialog({
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
            onChange={(event) =>
              onChangeState({ ...state, zoom: Number(event.target.value) })
            }
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
