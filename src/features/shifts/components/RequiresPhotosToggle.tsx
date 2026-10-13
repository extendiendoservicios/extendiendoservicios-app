import { Checkbox } from '@/components/ui/checkbox'
import { cn } from 'cn'

interface RequiresPhotosToggleProps {
  id: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  /** Texto de ayuda; si no se pasa, va el de turno. */
  hint?: string
}

const DEFAULT_HINT =
  'Si quien limpia termina sin sacar ninguna foto, la app se lo advierte y lo deja seguir. Acá ves la marca «Sin fotos».'

/**
 * Módulo H (H-07): casilla «Pide fotos» de los formularios de servicio (ADM-25)
 * y de turno (ADM-07). Mismo estilo que la casilla «A terminar».
 */
function RequiresPhotosToggle({
  id,
  checked,
  onCheckedChange,
  disabled,
  className,
  hint = DEFAULT_HINT,
}: RequiresPhotosToggleProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
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
        Pide fotos
      </label>
      <p className="pl-6 text-[12px] text-text-3">{hint}</p>
    </div>
  )
}

export { RequiresPhotosToggle }
