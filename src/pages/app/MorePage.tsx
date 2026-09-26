import { type ComponentType } from 'react'
import { Link } from 'react-router'
import {
  AlertTriangle,
  ChevronRight,
  Download,
  LogOut,
  Shield,
  User,
} from 'lucide-react'
import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/features/auth/AuthProvider'
import { useInstallPrompt } from '@/features/employee/useInstallPrompt'

/**
 * EMP-13 · Más (MOB-EMP-013, P-122): acceso a perfil (COM-04), avisar
 * demora o ausencia (EMP-12), supervisión si tiene ese rol (acceso
 * cruzado), instalar la app (COM-06) y cerrar sesión.
 *
 * EMP-12 es de F14 (`08_Fases_y_Backlog.md`, este paquete es P13.2): la
 * fila queda VISIBLE pero deshabilitada, con una etiqueta "Próximamente",
 * en vez de ocultarla del todo. Decisión menor: ocultarla dejaría a quien
 * ya la conoce (o la busca porque la vio en el mockup) pensando que no
 * existe o que hay un error; una fila deshabilitada con esa etiqueta dice
 * "ya viene" sin sugerir que hay algo roto ni permitir que alguien la use a
 * medio construir.
 */
export default function MorePage() {
  const auth = useAuth()
  const { available: canInstall, promptInstall } = useInstallPrompt()
  const isSupervisor = auth.roles.includes('supervisor')

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <MoreRow to="/perfil" icon={User} label="Mi perfil" />
        <MoreRow
          icon={AlertTriangle}
          label="Avisar demora o ausencia"
          disabled
          trailing={<Badge variant="neutral">Próximamente</Badge>}
        />
        {isSupervisor && (
          <MoreRow to="/sup" icon={Shield} label="Supervisión" />
        )}
        {canInstall && (
          <MoreRow
            icon={Download}
            label="Instalar la app"
            onClick={() => void promptInstall()}
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => void auth.signOut()}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] font-semibold text-danger outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        <LogOut aria-hidden="true" className="size-4" />
        Cerrar sesión
      </button>
    </div>
  )
}

function MoreRow({
  to,
  icon: Icon,
  label,
  disabled = false,
  trailing,
  onClick,
}: {
  to?: string
  icon: ComponentType<{ className?: string }>
  label: string
  disabled?: boolean
  trailing?: React.ReactNode
  onClick?: () => void
}) {
  const content = (
    <>
      <Icon aria-hidden="true" className="size-[18px] shrink-0 text-text-3" />
      <span className="flex-1 truncate text-[13.5px] font-medium text-text">
        {label}
      </span>
      {trailing ?? (
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-text-3"
        />
      )}
    </>
  )

  const className = cn(
    'flex min-h-11 items-center gap-3 border-b border-border px-4 py-3 outline-none last:border-b-0 focus-visible:ring-3 focus-visible:ring-ring',
    disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-bg active:bg-bg',
  )

  if (disabled) {
    return (
      <div className={className} aria-disabled="true">
        {content}
      </div>
    )
  }
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(className, 'w-full text-left')}
    >
      {content}
    </button>
  )
}
