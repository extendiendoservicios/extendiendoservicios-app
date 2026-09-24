import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@/components/Avatar'
import { Fab } from '@/components/Fab'
import { PwaUpdateBanner } from '@/components/PwaUpdateBanner'
import { formatShortDate } from '@/lib/format'
import { avatarUrl } from '@/lib/avatarUrl'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRouteHandle } from '@/app/routes/placeholder'
import {
  EMPLOYEE_TABBAR_ITEMS,
  isMobileNavItemActive,
  SUPERVISOR_TABBAR_ITEMS,
  type MobileNavItem,
} from './mobileNav'

export type MobileShellVariant = 'employee' | 'supervisor'

/**
 * `MobileShell` (DS-014): cabecera teal (saludo o navbar de subpágina),
 * cuerpo con fondo `--bg`, tabbar de 66 px y, para el empleado, el `Fab`
 * "Fichar" de P05.2 integrado entre "Hoy" y "Más" (`07_Design_System.md`
 * sección 2.4, `05_Pantallas_y_Navegacion.md` secciones 3 y 4).
 *
 * Un único componente para las dos vías (`variant`), en vez de dos shells
 * separados: comparten toda la estructura, cambian solo los ítems del
 * tabbar y la ruta raíz (`05` sección 6, "acceso cruzado" cuando la
 * persona tiene los dos roles — ver `session.ts`, `roles` puede traer
 * `['employee', 'supervisor']`).
 *
 * Se monta como `element` de `/app/*` o `/sup/*` en `router.tsx`, dentro de
 * `RequireRole`, y renderiza cada pantalla por `<Outlet />`. La cabecera
 * cambia sola según la ruta activa:
 * - La raíz exacta (`/app`, `/sup`) muestra el saludo (EMP-03/SUP-02, M02).
 * - Los otros ítems del tabbar (`/app/mas`, `/sup/supervisiones`, …)
 *   muestran el título de la pantalla sin flecha de "volver" (siguen
 *   siendo una pestaña, no una subpágina) y el tabbar sigue visible.
 * - Cualquier otra ruta es una subpágina: navbar con "volver" (M04/M09/M16)
 *   y sin tabbar — para sus acciones existe `ActionBar`
 *   (`src/app/shells/ActionBar.tsx`), que las pantallas reales agregan por
 *   su cuenta.
 *
 * En escritorio se centra a 480 px con fondo `--surface` y sombra
 * (`05_Pantallas_y_Navegacion.md` sección 0: "las pantallas móviles
 * funcionan también en escritorio, centradas a 480 px").
 */
export function MobileShell({ variant }: { variant: MobileShellVariant }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { displayName, profile } = useAuth()
  const handle = useRouteHandle()

  const rootPath = variant === 'employee' ? '/app' : '/sup'
  const tabItems =
    variant === 'employee' ? EMPLOYEE_TABBAR_ITEMS : SUPERVISOR_TABBAR_ITEMS
  const isRootTab = tabItems.some((item) => location.pathname === item.path)
  const isGreeting = location.pathname === rootPath

  return (
    <div className="flex min-h-dvh justify-center bg-bg">
      <div className="flex min-h-dvh w-full max-w-[480px] flex-col bg-surface shadow-card">
        {isGreeting ? (
          <MobileGreetingHeader
            displayName={displayName}
            avatarPath={profile?.avatarPath ?? null}
          />
        ) : (
          <MobileNavbarHeader
            title={handle?.title ?? ''}
            subtitle={handle?.subtitle}
            showBack={!isRootTab}
            onBack={() => void navigate(-1)}
          />
        )}

        {/* Scroll del documento, no de `<main>`: la navbar y el tabbar quedan
            fijas con `sticky`, y `ActionBar` (también `sticky`) se ancla a la
            ventana. El saludo de la raíz sí se va con el scroll. */}
        <main className="flex flex-1 flex-col gap-3 bg-bg p-4">
          <Outlet />
        </main>

        {isRootTab && (
          <>
            {/* Solo en las pestañas raíz, nunca en una subpágina: ahí es
                donde puede estar `ActionBar` (`src/app/shells/ActionBar.tsx`)
                anclada al mismo borde inferior, y es justamente donde
                alguien puede estar a mitad de fichar o de cargar algo --
                el peor momento para un aviso, aunque sea uno que no
                interrumpe. */}
            <PwaUpdateBanner className="sticky bottom-[74px] z-20" />
            <MobileTabbar
              variant={variant}
              items={tabItems}
              pathname={location.pathname}
              rootPath={rootPath}
            />
          </>
        )}
      </div>
    </div>
  )
}

function firstName(displayName: string): string {
  return displayName.split(' ')[0] ?? displayName
}

function MobileGreetingHeader({
  displayName,
  avatarPath,
}: {
  displayName: string
  /** `profiles.avatar_path` propio (EMP-011). `null` sin foto cargada. */
  avatarPath: string | null
}) {
  return (
    <header className="shrink-0 bg-primary px-5 pt-4 pb-5 text-white">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[20px] font-bold tracking-[-0.4px]">
            Hola, {firstName(displayName)}
          </p>
          <p className="mt-[2px] text-[12.5px] text-white/82">
            {formatShortDate(new Date())}
          </p>
        </div>
        {/* Avatar de 28 px; el `::after` lleva el área táctil a 44 px (`07`). */}
        <Link
          to="/perfil"
          aria-label="Ir a mi perfil"
          className="relative ml-auto shrink-0 rounded-full outline-none after:absolute after:-inset-2 focus-visible:ring-3 focus-visible:ring-ring"
        >
          <Avatar
            id="mobile-session-user"
            name={displayName}
            src={avatarPath ? avatarUrl(avatarPath) : null}
          />
        </Link>
      </div>
    </header>
  )
}

function MobileNavbarHeader({
  title,
  subtitle,
  showBack,
  onBack,
}: {
  title: string
  subtitle?: string
  showBack: boolean
  onBack: () => void
}) {
  return (
    <header className="sticky top-0 z-20 flex min-h-[56px] shrink-0 items-center gap-3 bg-primary px-4 py-[9px] text-white">
      {showBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none after:absolute after:-inset-1 hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
      )}
      <div className="min-w-0">
        <p className="truncate text-[15.5px] leading-tight font-semibold tracking-[-0.15px]">
          {title}
        </p>
        {subtitle && (
          <p className="truncate text-[11px] text-white/82">{subtitle}</p>
        )}
      </div>
    </header>
  )
}

function MobileTabbar({
  variant,
  items,
  pathname,
  rootPath,
}: {
  variant: MobileShellVariant
  items: MobileNavItem[]
  pathname: string
  rootPath: '/app' | '/sup'
}) {
  const navigate = useNavigate()
  const [first, second] = items

  return (
    <nav
      className="sticky bottom-0 z-20 flex h-[66px] shrink-0 items-center border-t border-border bg-surface px-1"
      style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}
      aria-label="Navegación principal"
    >
      {variant === 'employee' && first && second ? (
        <>
          <TabLink
            item={first}
            active={isMobileNavItemActive(pathname, first, rootPath)}
          />
          <div className="flex flex-[0_0_66px] flex-col items-center">
            <Fab
              onClick={() => void navigate('/app/fichar')}
              aria-label="Fichar"
            />
          </div>
          <TabLink
            item={second}
            active={isMobileNavItemActive(pathname, second, rootPath)}
          />
        </>
      ) : (
        items.map((item) => (
          <TabLink
            key={item.path}
            item={item}
            active={isMobileNavItemActive(pathname, item, rootPath)}
          />
        ))
      )}
    </nav>
  )
}

function TabLink({ item, active }: { item: MobileNavItem; active: boolean }) {
  return (
    <Link
      to={item.path}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 flex-1 flex-col items-center gap-1 pt-2 text-[10px] font-semibold text-text-3',
        active && 'text-primary',
      )}
    >
      <item.icon aria-hidden="true" className="size-[21px]" />
      {item.label}
    </Link>
  )
}
