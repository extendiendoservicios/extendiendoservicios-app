import { Link } from 'react-router'
import { PackageMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWithdrawalShiftOptionsQuery } from '../queries'

/**
 * Atajo «Retirar insumos» del detalle del servicio del empleado (EMP-04) y de
 * SUP-03 del coordinador (IS-28): abre el retiro con ese turno ya elegido
 * (`?turno=`). Si el turno no está entre las opciones permitidas (otra
 * persona, cancelado o fuera de los próximos 7 días), no se muestra.
 */
export function WithdrawShortcut({
  shiftId,
  base,
}: {
  shiftId: string
  base: '/app' | '/sup'
}) {
  const { data } = useWithdrawalShiftOptionsQuery()
  if (!data?.some((option) => option.shiftId === shiftId)) return null

  return (
    <Button asChild size="md" variant="ghost">
      <Link to={`${base}/insumos/retirar?turno=${shiftId}`}>
        <PackageMinus aria-hidden="true" />
        Retirar insumos
      </Link>
    </Button>
  )
}
