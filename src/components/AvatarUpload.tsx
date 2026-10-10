import { useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  photoPublicUrl,
  removePhoto,
  savePhoto,
  type PhotoKind,
} from '@/api/photos'
import {
  AVATAR_ACCEPTED_MIME_TYPES,
  cropAndResizeToBlob,
} from '@/lib/avatarImage'
import {
  PhotoCropDialog,
  prepareCropState,
  type CropDialogState,
} from '@/components/PhotoCropDialog'

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
  /**
   * Dueño de la foto: `profiles.id` (carpeta en `avatars`, se guarda
   * `avatar_path`) o, con `kind="client"`, `clients.id` (carpeta en
   * `client-photos`, se guarda `photo_path`).
   */
  profileId: string
  /** Qué foto es: de una persona (por defecto) o de un cliente (AJ2-06). */
  kind?: PhotoKind
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
  kind = 'profile',
  name,
  avatarPath,
  onChange,
  className,
}: AvatarUploadProps) {
  const changeLabel =
    kind === 'client' ? 'Cambiar foto del cliente' : 'Cambiar foto de perfil'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [cropState, setCropState] = useState<CropDialogState | null>(null)

  const photoUrl = avatarPath ? photoPublicUrl(kind, avatarPath) : null
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

    const prepared = await prepareCropState(file)
    if ('error' in prepared) {
      setError(prepared.error)
      return
    }
    setCropState(prepared.state)
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
      const path = await savePhoto(kind, profileId, blob, avatarPath)
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
    try {
      await removePhoto(kind, profileId, avatarPath)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No pudimos quitar la foto. Probá de nuevo.',
      )
      setStatus('idle')
      return
    }
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
          aria-label={changeLabel}
          className="absolute -right-1 -bottom-1 flex size-8 after:absolute after:-inset-2 md:after:hidden items-center justify-center rounded-full border-2 border-surface bg-primary text-white outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50"
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
        aria-label={changeLabel}
        accept={AVATAR_ACCEPTED_MIME_TYPES.join(',')}
        className="sr-only"
        onChange={(event) => void handleFileSelected(event)}
      />

      {cropState && (
        <PhotoCropDialog
          state={cropState}
          onChangeState={setCropState}
          onCancel={() => setCropState(null)}
          onConfirm={(cropRect) => void handleConfirmCrop(cropRect)}
        />
      )}
    </div>
  )
}
