import { cn } from 'cn'
import { Package } from 'lucide-react'

/**
 * Imagen chica de un artículo (IS-04): la URL firmada si ya llegó; si no hay
 * imagen (o todavía carga), un cuadrado neutro con el ícono de paquete.
 */
function SupplyImage({
  path,
  urls,
  alt,
  className,
}: {
  path: string | null
  urls: ReadonlyMap<string, string>
  /** Texto alternativo; vacío cuando el nombre del artículo ya está al lado. */
  alt?: string
  className?: string
}) {
  const url = path ? urls.get(path) : undefined
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary text-text-3',
        className,
      )}
    >
      {url ? (
        <img
          src={url}
          alt={alt ?? ''}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <Package aria-hidden="true" className="size-1/2" />
      )}
    </span>
  )
}

export { SupplyImage }
