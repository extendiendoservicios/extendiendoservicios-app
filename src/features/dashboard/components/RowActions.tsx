import { Link } from 'react-router'
import { Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Acciones de una fila del tablero (DASH-002, DASH-003, `05` línea 36):
 * abrir turno (ADM-06), registrar en nombre de (ADM-11), asignar reemplazo
 * (ADM-08) y llamar (`tel:`). Se muestra solo lo que corresponde: el
 * servidor vuelve a verificar cada acción.
 */
interface RowActionsProps {
  shiftId: string
  /** Hay acciones de asistencia con sentido para esta asignación y el actor puede registrarlas. */
  onRecord?: () => void
  /** El actor puede asignar y el turno está cargado. */
  onAssign?: () => void
  phone?: string | null
  /** Etiqueta del botón de reemplazo (en una ausencia se llama "Asignar reemplazo"). */
  assignLabel?: string
}

function RowActions({
  shiftId,
  onRecord,
  onAssign,
  phone,
  assignLabel = 'Asignar reemplazo',
}: RowActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link to={`/admin/turnos/${shiftId}`}>Abrir turno</Link>
      </Button>
      {onRecord && (
        <Button variant="ghost" size="sm" onClick={onRecord}>
          Registrar en nombre
        </Button>
      )}
      {onAssign && (
        <Button variant="ghost" size="sm" onClick={onAssign}>
          {assignLabel}
        </Button>
      )}
      {phone && (
        <Button asChild variant="ghost" size="sm" icon={Phone}>
          <a href={`tel:${phone}`}>Llamar</a>
        </Button>
      )}
    </div>
  )
}

export { RowActions }
