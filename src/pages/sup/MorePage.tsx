import { type ComponentType } from 'react'
import { Link } from 'react-router'
import { Briefcase, ChevronRight, Download, LogOut, User } from 'lucide-react'
import { cn } from 'cn'
import { useAuth } from '@/features/auth/AuthProvider'
import { AppVersion } from '@/components/AppVersion'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

/**
 * SUP-09 · Más (MOB-SUP-009, `05` fila SUP-09, P-122): acceso a perfil
 * (COM-04), "Mis servicios" si la persona también es empleado (acceso
 * cruzado a EMP-03, `/app`), instalar la app (COM-06) y cerrar sesión.
 * Mismo componente y criterio que `src/pages/app/MorePage.tsx` (EMP-13):
 * archivos separados porque cada uno vive en su propia carpeta de rutas,
 * pero misma estructura de filas, para que las dos vías se sientan la
 * misma app.
 */
export default function SupervisorMorePage() {
  const auth = useAuth()
  const { available: canInstall, promptInstall } = useInstallPrompt()
  const isEmployee = auth.roles.includes('employee')

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <MoreRow to="/perfil" icon={User} label="Mi perfil" />
        {isEmployee && (
          <MoreRow to="/app" icon={Briefcase} label="Mis servicios" />
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

      <AppVersion />
    </div>
  )
}

function MoreRow({
  to,
  icon: Icon,
  label,
  onClick,
}: {
  to?: string
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
}) {
  const content = (
    <>
      <Icon aria-hidden="true" className="size-[18px] shrink-0 text-text-3" />
      <span className="flex-1 truncate text-[13.5px] font-medium text-text">
        {label}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-text-3"
      />
    </>
  )

  const className = cn(
    'flex min-h-11 items-center gap-3 border-b border-border px-4 py-3 outline-none last:border-b-0 focus-visible:ring-3 focus-visible:ring-ring hover:bg-bg active:bg-bg',
  )

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
