import { useEffect, useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  PhotoCropDialog,
  prepareCropState,
  type CropDialogState,
} from '@/components/PhotoCropDialog'
import {
  AVATAR_ACCEPTED_MIME_TYPES,
  cropAndResizeToBlob,
} from '@/lib/avatarImage'

/**
 * `PendingPhotoPicker` (AJ2-07): elegir y recortar una foto en un formulario
 * de ALTA, cuando todavía no existe el id del registro. No sube nada: deja el
 * JPEG recortado en memoria (`onChange(blob)`) y el formulario lo sube con
 * `savePhoto` (`src/api/photos.ts`) después de crear el cliente o el
 * empleado. Mismo recorte y mismos textos que `AvatarUpload`.
 */
export interface PendingPhotoPickerProps {
  /** Nombre que se va escribiendo en el formulario: iniciales del fallback. */
  name: string
  /** Foto elegida (JPEG ya recortado), o `null` si no hay. */
  value: Blob | null
  onChange: (blob: Blob | null) => void
  /** Etiqueta accesible del botón de cámara y del input. */
  label?: string
  className?: string
}

export function PendingPhotoPicker({
  name,
  value,
  onChange,
  label = 'Elegir foto',
  className,
}: PendingPhotoPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [cropState, setCropState] = useState<CropDialogState | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Vista previa de la foto en memoria (data URL: no hay nada que liberar).
  useEffect(() => {
    if (!value) return
    let cancelled = false
    const reader = new FileReader()
    reader.onload = () => {
      if (!cancelled) setPreviewUrl(reader.result as string)
    }
    reader.readAsDataURL(value)
    return () => {
      cancelled = true
    }
  }, [value])

  function openPicker() {
    setError(null)
    fileInputRef.current?.click()
  }

  async function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0] ?? null
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
    try {
      onChange(await cropAndResizeToBlob(image, cropRect))
    } catch {
      setError('No pudimos procesar la foto. Probá con otra.')
    }
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <div className="relative shrink-0">
        <Avatar
          id="foto-pendiente"
          name={name || 'Foto'}
          src={value ? previewUrl : null}
          size="lg"
        />
        <button
          type="button"
          onClick={openPicker}
          aria-label={label}
          className="absolute -right-1 -bottom-1 flex size-8 after:absolute after:-inset-2 md:after:hidden items-center justify-center rounded-full border-2 border-surface bg-primary text-white outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <Camera aria-hidden="true" className="size-[15px]" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={openPicker}>
            {value ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              onClick={() => onChange(null)}
            >
              Quitar foto
            </Button>
          )}
        </div>
        <p className="text-[11px] text-text-3">
          Opcional. JPG, PNG o WEBP. Se recorta en cuadrado y se sube al
          guardar.
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
        aria-label={label}
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
