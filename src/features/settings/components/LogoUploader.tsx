import { useRef } from 'react'
import { toast } from 'sonner'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/api/errors'
import { brandingLogoUrl } from '@/features/auth/useBranding'
import { validateLogoFile } from '@/api/settings'
import { useUploadCompanyLogoMutation } from '@/features/settings/queries'

/**
 * Subida de logo de ADM-28 (USERS-012, USERS-013): vista previa (el mismo
 * archivo que va a usar el login y la sidebar, `brandingLogoUrl` de
 * `useBranding.ts`) y botón "Subir logo" sobre un `<input type="file">`
 * oculto -- lo ve tanto el dueño como el administrador (P-117).
 */
function LogoUploader({
  logoPath,
  updatedBy,
}: {
  logoPath: string | null
  updatedBy: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadLogo = useUploadCompanyLogoMutation()

  function handlePickFile() {
    inputRef.current?.click()
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    const validationError = validateLogoFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }

    try {
      await uploadLogo.mutateAsync({
        file,
        updatedBy,
        previousLogoPath: logoPath,
      })
      toast.success('Actualizamos el logo.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos subir el logo.',
      )
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
        {logoPath ? (
          <img
            src={brandingLogoUrl(logoPath)}
            alt="Logo actual de la empresa"
            className="size-full object-contain p-1"
          />
        ) : (
          <img
            src="/favicon.png"
            alt="Isotipo de Extendiendo Servicios (todavía sin logo propio)"
            className="size-10 object-contain"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          icon={Upload}
          size="sm"
          loading={uploadLogo.isPending}
          onClick={handlePickFile}
        >
          Subir logo
        </Button>
        <p className="text-[11px] text-text-3">
          PNG, JPEG, SVG o WebP. Hasta 1 MB.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="sr-only"
        aria-label="Elegir archivo de logo"
        onChange={(event) => void handleFileChange(event)}
      />
    </div>
  )
}

export { LogoUploader }
