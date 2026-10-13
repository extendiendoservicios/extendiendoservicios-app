/**
 * Piezas compartidas por `src/api/media.ts` (celular) y
 * `src/api/mediaAdmin.ts` (administración) del módulo H: el bucket, la
 * extensión según la ruta y la firma de URL en lote. Un único lugar para que
 * las dos vías no se desfasen.
 */
import { supabase } from '@/lib/supabase'

export type { MediaKind } from '@/lib/media/types'

export const EVIDENCE_BUCKET = 'evidence'

/** Mapa ruta -> URL firmada. Las rutas que no se pudieron firmar no aparecen. */
export type SignedUrlMap = Map<string, string>

/** Extensión del archivo según su ruta (`.../{id}.jpg`); `jpg` si no se sabe. */
export function extensionOfPath(storagePath: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(storagePath)
  return match?.[1]?.toLowerCase() ?? 'jpg'
}

/**
 * Firma varias rutas del bucket `evidence` en una sola llamada (el bucket es
 * privado: nunca se arma una URL pública). Quita duplicados y rutas vacías.
 * `failed` es `true` si Storage rechazó toda la llamada; quien llama decide
 * si eso es un error o si alcanza con mostrar lo que haya.
 */
export async function signEvidencePaths(
  paths: readonly string[],
  expiresInSeconds: number,
): Promise<{ urls: SignedUrlMap; failed: boolean }> {
  const unique = Array.from(new Set(paths.filter((path) => path !== '')))
  const urls: SignedUrlMap = new Map()
  if (unique.length === 0) {
    return { urls, failed: false }
  }

  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrls(unique, expiresInSeconds)

  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) {
      urls.set(item.path, item.signedUrl)
    }
  }
  return { urls, failed: Boolean(error) }
}
