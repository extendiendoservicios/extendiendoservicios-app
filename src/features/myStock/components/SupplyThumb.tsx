import { useState } from 'react'
import { Package } from 'lucide-react'

/**
 * Miniatura de un artículo (IS-04): la imagen firmada del bucket privado
 * `supply-images` o, sin imagen (o si no carga), un ícono neutro.
 */
export function SupplyThumb({ url }: { url?: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        onError={() => setFailedUrl(url)}
        className="size-12 shrink-0 rounded-md border border-border bg-secondary object-cover"
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-text-3"
    >
      <Package className="size-5" />
    </div>
  )
}
