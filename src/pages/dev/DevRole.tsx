import { useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import {
  getDevRoleSelection,
  setDevRoleSelection,
  subscribeDevRoleSelection,
  type DevRoleSelection,
} from '@/features/auth/devRole'

/**
 * `/dev/rol` (DS-015, solo en desarrollo — igual que `/dev/design`):
 * simulador de rol para recorrer `AdminShell`/`MobileShell` sin
 * autenticación real (AUTH-002/AUTH-008 llegan en F6). Guarda la elección
 * en `localStorage` (`devRole.ts`) — `useSession()` la lee en cualquier
 * componente de la app.
 *
 * Nada de esto existe fuera de `import.meta.env.DEV`: el router
 * (`src/app/router.tsx`) registra esta página con el mismo patrón que
 * `/dev/design` (`lazy` + `if (import.meta.env.DEV)`), así que no queda en
 * `dist/` (verificado en este encargo).
 */
const OPTIONS: {
  value: DevRoleSelection
  label: string
  detail: string
  goTo?: string
}[] = [
  {
    value: 'none',
    label: 'Sin sesión',
    detail: 'Cualquier ruta protegida redirige a /ingresar',
  },
  {
    value: 'owner',
    label: 'Dueño/a — Andrea Ríos',
    detail: '/admin, todas las secciones',
    goTo: '/admin',
  },
  {
    value: 'admin',
    label: 'Administrador/a — Andrea Ríos',
    detail: '/admin',
    goTo: '/admin',
  },
  {
    value: 'employee',
    label: 'Empleado/a — María Gómez',
    detail: '/app',
    goTo: '/app',
  },
  {
    value: 'supervisor',
    label: 'Supervisor/a — Paula Lemos',
    detail: '/sup',
    goTo: '/sup',
  },
  {
    value: 'employee_supervisor',
    label: 'Empleado/a y supervisor/a — María Gómez',
    detail: '/app, con acceso cruzado a Supervisión en Más',
    goTo: '/app',
  },
]

function DevRolePage() {
  const selection = useSyncExternalStore(
    subscribeDevRoleSelection,
    getDevRoleSelection,
    getDevRoleSelection,
  )

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-xl flex-col gap-6 p-6 text-text">
        <header>
          <h1 className="text-[17px] font-semibold text-text">
            /dev/rol — Simulador de rol
          </h1>
          <p className="mt-1 text-[13px] text-text-3">
            Solo en desarrollo (DS-015): elegí un rol para recorrer los shells
            antes de que exista la autenticación real (P06.2). Se guarda en este
            navegador.
          </p>
        </header>

        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-label="Rol simulado"
        >
          {OPTIONS.map((option) => {
            const active = selection === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setDevRoleSelection(option.value)}
                className={cn(
                  'flex flex-col gap-[2px] rounded-md border px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-primary-050'
                    : 'border-border-strong bg-surface hover:bg-bg',
                )}
              >
                <span
                  className={cn(
                    'text-[13px] font-semibold',
                    active ? 'text-primary-800' : 'text-text',
                  )}
                >
                  {option.label}
                </span>
                <span className="text-[11px] text-text-3">{option.detail}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">Ir a /admin</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/app">Ir a /app</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/sup">Ir a /sup</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/perfil">Ir a /perfil</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dev/design">/dev/design</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default DevRolePage
