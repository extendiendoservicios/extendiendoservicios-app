import { AvatarUpload } from '@/components/AvatarUpload'

/**
 * Foto de un cliente ya creado (AJ2-06): `AvatarUpload` apuntado al bucket
 * `client-photos` y a `clients.photo_path`. Solo owner/admin pueden
 * subir o quitar (políticas de 0039); quien lo use debe ocultarlo al resto.
 */
export interface ClientPhotoUploadProps {
  clientId: string
  name: string
  /** `clients.photo_path` actual, o `null` sin foto. */
  photoPath: string | null
  onChange?: (photoPath: string | null) => void
  className?: string
}

export function ClientPhotoUpload({
  clientId,
  name,
  photoPath,
  onChange,
  className,
}: ClientPhotoUploadProps) {
  return (
    <AvatarUpload
      kind="client"
      profileId={clientId}
      name={name}
      avatarPath={photoPath}
      onChange={onChange}
      className={className}
    />
  )
}
