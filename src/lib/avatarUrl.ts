import { supabase } from '@/lib/supabase'

/**
 * URL pública de una foto de perfil en el bucket `avatars`
 * (`0014_storage_buckets.sql`: `public = true`, ruta no adivinable
 * `{profile_id}/{uuid}.jpg`). Sin parámetro de versión para evitar caché
 * vieja: cada foto nueva sube con un `uuid` distinto (`avatarStoragePath`,
 * `avatarImage.ts`), así que la URL cambia sola en cada reemplazo — a
 * diferencia de `brandingLogoUrl` (`useBranding.ts`), que sí podría
 * repetir nombre de archivo.
 */
export function avatarUrl(avatarPath: string): string {
  return supabase.storage.from('avatars').getPublicUrl(avatarPath).data
    .publicUrl
}
