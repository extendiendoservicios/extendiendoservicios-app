import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { mediaErrorMessage } from '@/lib/media/errors'
import {
  compressSupplyImage,
  SUPPLY_IMAGE_ACCEPTED_TYPES,
  validateSupplyImageFile,
} from '@/features/stock/image'
import { SupplyImage } from './SupplyImage'

/**
 * Lo que decidió la persona con la imagen del artículo: dejar la que tiene
 * (`keep`), quitarla (`remove`) o subir una nueva ya comprimida (`replace`).
 */
export type SupplyImageDraft =
  { action: 'keep' } | { action: 'remove' } | { action: 'replace'; blob: Blob }

/**
 * Imagen opcional del artículo (IS-04, IS-32): se elige un archivo, se
 * comprime en el navegador (lado mayor de 1200 px, WebP) y recién se sube al
 * guardar el artículo. Muestra la imagen vigente, o la nueva elegida.
 */
function SupplyImageField({
  currentPath,
  currentUrl,
  value,
  onChange,
  disabled = false,
}: {
  /** Ruta de la imagen que ya tiene el artículo (en una edición). */
  currentPath: string | null
  currentUrl: string | undefined
  value: SupplyImageDraft
  onChange: (value: SupplyImageDraft) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // La vista previa se crea al elegir (en el manejador) y se libera al cambiar o desmontar.
  const previewRef = useRef<string | null>(null)
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    },
    [],
  )

  function setPreview(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = url
    setPreviewUrl(url)
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateSupplyImageFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setPreparing(true)
    try {
      const compressed = await compressSupplyImage(file)
      setPreview(URL.createObjectURL(compressed))
      onChange({ action: 'replace', blob: compressed })
    } catch (error) {
      toast.error(mediaErrorMessage(error))
    } finally {
      setPreparing(false)
    }
  }

  const hasImage =
    value.action === 'replace' || (value.action === 'keep' && currentPath)
  const shownUrl =
    value.action === 'replace'
      ? (previewUrl ?? undefined)
      : value.action === 'keep'
        ? currentUrl
        : undefined
  const shownMap = new Map<string, string>()
  if (shownUrl) shownMap.set('shown', shownUrl)

  return (
    <div className="flex items-center gap-4">
      <SupplyImage
        path={shownUrl ? 'shown' : null}
        urls={shownMap}
        alt="Imagen del artículo"
        className="size-20"
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon={ImagePlus}
            loading={preparing}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            {hasImage ? 'Cambiar imagen' : 'Elegir imagen'}
          </Button>
          {hasImage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon={Trash2}
              disabled={disabled || preparing}
              onClick={() => {
                setPreview(null)
                onChange({ action: 'remove' })
              }}
            >
              Quitar imagen
            </Button>
          )}
        </div>
        <p className="text-[11px] text-text-3">
          Opcional. JPG, PNG o WEBP; se achica sola antes de subir.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={SUPPLY_IMAGE_ACCEPTED_TYPES.join(',')}
        className="sr-only"
        aria-label="Elegir archivo de imagen del artículo"
        onChange={(event) => void handleFileChange(event)}
      />
    </div>
  )
}

export { SupplyImageField }
