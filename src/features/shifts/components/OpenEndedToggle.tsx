import { Checkbox } from '@/components/ui/checkbox'
import { OPEN_ENDED_LABEL } from '@/features/shifts/openEnded'

interface OpenEndedToggleProps {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Texto de ayuda que aclara qué pasa con las horas (distinto en servicio y en turno). */
  hint?: string
}

/**
 * AJ2-10: casilla «A terminar» de los formularios de servicio y de turno. Con la casilla
 * tildada la hora de fin no se pide: el turno dura hasta que cada empleado ficha su salida.
 */
function OpenEndedToggle({
  id,
  checked,
  onCheckedChange,
  disabled,
  hint,
}: OpenEndedToggleProps) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="flex items-center gap-2 text-[13px] font-medium text-text"
      >
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        {OPEN_ENDED_LABEL} (sin hora de fin)
      </label>
      {hint && <p className="pl-6 text-[12px] text-text-3">{hint}</p>}
    </div>
  )
}

export { OpenEndedToggle }
