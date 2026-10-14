import { Link } from 'react-router'
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useStorageUsageQuery } from '@/features/media/queries'
import { formatPercent } from './StorageMeter'

/**
 * Aviso de ADM-02 «Resumen» (H-14, H-18): aparece solo cuando el medidor de
 * espacio pasa del 70 % (`level` distinto de `ok`) y lleva a ADM-32. Si no se
 * puede consultar el espacio, no muestra nada (no es información que haya
 * que inventar).
 */
function StorageAlert() {
  const usageQuery = useStorageUsageQuery({ poll: true })
  const usage = usageQuery.data
  if (!usage || usage.level === 'ok') {
    return null
  }
  const critical = usage.level === 'critical'

  return (
    <Alert variant={critical ? 'crit' : 'warn'}>
      <TriangleAlert />
      <AlertDescription>
        <p>
          {critical
            ? `El espacio de fotos y videos está casi lleno: ${formatPercent(usage.percent)} usado.`
            : `El espacio de fotos y videos se está llenando: ${formatPercent(usage.percent)} usado.`}{' '}
          <Link to="/admin/fotos" className="font-semibold underline">
            Ver fotos y videos
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}

export { StorageAlert }
