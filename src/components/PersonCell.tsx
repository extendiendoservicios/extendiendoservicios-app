import { cn } from 'cn'
import { Avatar } from '@/components/Avatar'

/**
 * PersonCell (DS-009): `07` sección 2.3 — avatar + nombre en peso 600 +
 * subtítulo 11 px (`.person`/`.person-t`/`.person-s`, `ds.css`). Se usa en
 * `DataTable` (columna "Empleado") y en cualquier otro lugar que muestre una
 * persona con su avatar (fichas, drawers).
 */
interface PersonCellProps {
  /** Id estable de la persona: define el color del avatar. */
  id: string
  name: string
  /** Legajo, cliente habilitado, cargo, etc. — lo que corresponda en cada pantalla. */
  subtitle?: string
  avatarSrc?: string | null
  size?: 'default' | 'compact'
  className?: string
}

function PersonCell({
  id,
  name,
  subtitle,
  avatarSrc,
  size = 'default',
  className,
}: PersonCellProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-[9px]', className)}>
      <Avatar id={id} name={name} src={avatarSrc} size={size} />
      <div className="min-w-0 leading-[1.2]">
        <p className="truncate font-semibold text-text">{name}</p>
        {subtitle && (
          <p className="truncate text-[11px] text-text-3">{subtitle}</p>
        )}
      </div>
    </div>
  )
}

export { PersonCell }
export type { PersonCellProps }
