import { Link } from 'react-router'
import { ClipboardCheck, Smartphone } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useHasRole } from '@/features/auth/useHasRole'

/**
 * Opciones de cambio de modo del menú de usuario del panel (P29.2, OG-08):
 * quien administra y además trabaja como empleado o coordinador entra a
 * propósito a su app de celular, sin cerrar sesión. Van dentro de un
 * `DropdownMenuContent`. Sin esos roles no renderiza nada.
 */
export function ModeSwitchMenuItems() {
  const isEmployee = useHasRole('employee')
  const isSupervisor = useHasRole('supervisor')
  return (
    <>
      {isEmployee && (
        <DropdownMenuItem asChild>
          <Link to="/app">
            <Smartphone /> Ir a mi app de empleado
          </Link>
        </DropdownMenuItem>
      )}
      {isSupervisor && (
        <DropdownMenuItem asChild>
          <Link to="/sup">
            <ClipboardCheck /> Ir a mi app de coordinador
          </Link>
        </DropdownMenuItem>
      )}
    </>
  )
}
