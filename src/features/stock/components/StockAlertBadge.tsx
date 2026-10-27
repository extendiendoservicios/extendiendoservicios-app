import { Badge } from '@/components/ui/badge'
import type { StockItem } from '@/api/stock'
import { effectiveStatus, stockAlertLabel } from '@/features/stock/filters'

/**
 * Etiqueta de texto de una fila en amarillo o en rojo (IS-05): «Sin stock» o
 * «Bajo mínimo». Así el aviso no depende solo del color.
 */
function StockAlertBadge({ item }: { item: StockItem }) {
  const label = stockAlertLabel(item)
  if (!label) return null
  return (
    <Badge variant={effectiveStatus(item) === 'empty' ? 'danger' : 'warning'}>
      {label}
    </Badge>
  )
}

export { StockAlertBadge }
