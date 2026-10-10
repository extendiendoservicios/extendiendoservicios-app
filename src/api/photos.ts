import { supabase } from '@/lib/supabase'
import { ApiError } from './errors'

/**
 * `src/api/photos.ts` (AJ2-06, AJ2-07): subida y baja de las fotos de
 * personas (`profiles.avatar_path`, bucket `avatars`) y de clientes
 * (`clients.photo_path`, bucket `client-photos`, 0039). Las dos siguen el
 * mismo flujo: subir el JPEG ya recortado a `{id}/{uuid}.jpg`, guardar la
 * ruta en la tabla y borrar la foto anterior con la Storage API. Se guarda
 * la ruta, no la URL.
 *
 * Los permisos los resuelve el servidor: en `avatars`, el propio usuario o
 * owner/admin (0014/0030); en `client-photos`, solo owner/admin (0039).
 */

export type PhotoKind = 'profile' | 'client'

interface PhotoTarget {
  bucket: 'avatars' | 'client-photos'
  /** Complemento de «No pudimos guardar la foto en …». */
  saveErrorMessage: string
}

const PHOTO_TARGETS: Record<PhotoKind, PhotoTarget> = {
  profile: {
    bucket: 'avatars',
    saveErrorMessage:
      'No pudimos guardar la foto en el perfil. Probá de nuevo.',
  },
  client: {
    bucket: 'client-photos',
    saveErrorMessage:
      'No pudimos guardar la foto en el cliente. Probá de nuevo.',
  },
}

/** URL pública de una foto (los dos buckets son públicos y la ruta no es adivinable). */
export function photoPublicUrl(kind: PhotoKind, path: string): string {
  return supabase.storage.from(PHOTO_TARGETS[kind].bucket).getPublicUrl(path)
    .data.publicUrl
}

/** URL pública de la foto de un cliente (`client-photos`). */
export function clientPhotoUrl(path: string): string {
  return photoPublicUrl('client', path)
}

/** Guarda (o borra, con `null`) la ruta de la foto en la fila del dueño. */
async function writePhotoPath(
  kind: PhotoKind,
  ownerId: string,
  path: string | null,
) {
  return kind === 'client'
    ? await supabase
        .from('clients')
        .update({ photo_path: path })
        .eq('id', ownerId)
    : await supabase
        .from('profiles')
        .update({ avatar_path: path })
        .eq('id', ownerId)
}

/** Ruta nueva para la foto: `{id}/{uuid}.jpg`. */
export function photoStoragePath(ownerId: string): string {
  return `${ownerId}/${crypto.randomUUID()}.jpg`
}

/**
 * Sube la foto, guarda la ruta en la fila de `ownerId` y borra la anterior
 * (mejor esfuerzo). Devuelve la ruta nueva. Si no se puede guardar la ruta,
 * borra el archivo recién subido para no dejar huérfanos.
 */
export async function savePhoto(
  kind: PhotoKind,
  ownerId: string,
  blob: Blob,
  previousPath: string | null = null,
): Promise<string> {
  const target = PHOTO_TARGETS[kind]
  const path = photoStoragePath(ownerId)

  const { error: uploadError } = await supabase.storage
    .from(target.bucket)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (uploadError) {
    throw new ApiError(
      'No pudimos subir la foto. Revisá tu conexión y probá de nuevo.',
      'PHOTO_UPLOAD_FAILED',
    )
  }

  const { error: updateError } = await writePhotoPath(kind, ownerId, path)
  if (updateError) {
    await supabase.storage.from(target.bucket).remove([path])
    throw new ApiError(target.saveErrorMessage, 'PHOTO_SAVE_FAILED')
  }

  if (previousPath) {
    // Si falla, queda un archivo viejo sin referencia: no es un error para mostrar.
    await supabase.storage.from(target.bucket).remove([previousPath])
  }
  return path
}

/** Quita la foto: primero la ruta en la tabla y después el archivo. */
export async function removePhoto(
  kind: PhotoKind,
  ownerId: string,
  currentPath: string,
): Promise<void> {
  const target = PHOTO_TARGETS[kind]
  const { error } = await writePhotoPath(kind, ownerId, null)
  if (error) {
    throw new ApiError(
      'No pudimos quitar la foto. Probá de nuevo.',
      'PHOTO_REMOVE_FAILED',
    )
  }
  await supabase.storage.from(target.bucket).remove([currentPath])
}
