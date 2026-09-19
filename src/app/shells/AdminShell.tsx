import { useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'
import { LogOut, MoreHorizontal, User } from 'lucide-react'
import { cn } from 'cn'
import { Avatar } from '@/components/Avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { setDevRoleSelection } from '@/features/auth/devRole'
import { ROLE_LABELS, useSession } from '@/features/auth/session'
import { useRouteHandle } from '@/app/routes/placeholder'
import {
  ADMIN_MORE_ITEMS,
  ADMIN_NAV_CONFIGURATION,
  ADMIN_NAV_OPERATION,
  ADMIN_TABBAR_ITEMS,
  isAdminNavItemActive,
  type AdminNavItem,
} from './adminNav'

/**
 * `AdminShell` (DS-013): sidebar teal de 236 px con las ocho secciones de
 * P-121, colapsada a íconos entre 1024 y 1279 px, y tabbar inferior por
 * debajo de 1024 (`07_Design_System.md` sección 2.4,
 * `05_Pantallas_y_Navegacion.md` sección 7).
 *
 * Layout de ruta: se monta como `element` de un grupo `/admin/*` en
 * `router.tsx`, dentro de `RequireRole`, y renderiza cada pantalla por
 * `<Outlet />`. Lee el título/subtítulo de la topbar del `handle` de la
 * ruta activa (`useRouteHandle`, `src/app/routes/placeholder.tsx`) — cuando
 * las pantallas reales reemplacen a los placeholders (front-admin), siguen
 * declarando el mismo `handle` y la topbar no cambia.
 */
export function AdminShell({
  /**
   * Punto de extensión para el buscador global de la topbar (EMP-012,
   * P09.0): esta entrega no lo implementa ("sin un input que no
   * funcione"), pero la topbar ya tiene dónde montarlo el día que exista,
   * sin tocar `AdminShell`.
   */
  topbarEnd,
}: {
  topbarEnd?: ReactNode
} = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const handle = useRouteHandle()
  const [moreOpen, setMoreOpen] = useState(false)

  // xl (1280px): sidebar completa. lg (1024px) a xl: colapsada a íconos.
  // Por debajo de lg: tabbar en vez de sidebar (05 sección 7).
  const isSidebarExpanded = useMediaQuery('(min-width: 1280px)')
  const showSidebar = useMediaQuery('(min-width: 1024px)')
  const showTabbar = !showSidebar

  const displayName =
    session.status === 'authenticated' ? session.displayName : 'Cuenta'
  const roleLabel =
    session.status === 'authenticated'
      ? session.roles.includes('owner')
        ? ROLE_LABELS.owner
        : ROLE_LABELS.admin
      : ''

  function handleSignOut() {
    setDevRoleSelection('none')
    void navigate('/ingresar')
  }

  return (
    <div className="flex min-h-dvh bg-bg">
      {showSidebar && (
        <AdminSidebar
          collapsed={!isSidebarExpanded}
          pathname={location.pathname}
          displayName={displayName}
          roleLabel={roleLabel}
        />
      )}

      {/* Scroll del documento, no de un contenedor interno: topbar y tabbar
          quedan fijas con `sticky` y la sidebar con `sticky` + `h-dvh`. Así
          `<main>` no es un contenedor de scroll y cualquier `sticky` de una
          pantalla se ancla a la ventana. */}
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[64px] shrink-0 items-center gap-[18px] border-b border-border bg-surface px-4 lg:px-[26px]">
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.25px] text-text">
              {handle?.title ?? 'Extendiendo Servicios'}
            </h1>
            {handle?.subtitle && (
              <p className="truncate text-[12.5px] text-text-3">
                {handle.subtitle}
              </p>
            )}
          </div>

          <div className="ml-auto flex items-center gap-[10px]">
            {topbarEnd}
            <DropdownMenu>
              {/* `after:-inset-1`: área táctil de 44 px por debajo de 1024,
                  donde este shell se usa en el celular (`07`: ≥ 44 px). */}
              <DropdownMenuTrigger className="relative flex items-center gap-2 rounded-full p-1 outline-none after:absolute after:-inset-1 focus-visible:ring-3 focus-visible:ring-ring">
                <Avatar id="admin-session-user" name={displayName} />
                <span className="sr-only">Menú de usuario</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to="/perfil">
                    <User /> Mi perfil
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-4 lg:px-[26px] lg:py-[22px]">
          <Outlet />
        </main>

        {showTabbar && (
          <AdminTabbar
            pathname={location.pathname}
            onMore={() => setMoreOpen(true)}
          />
        )}
      </div>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] rounded-t-lg">
          <SheetHeader>
            <SheetTitle>Más</SheetTitle>
          </SheetHeader>
          <nav
            className="flex flex-col gap-1 px-6 pb-6"
            aria-label="Más secciones"
          >
            {ADMIN_MORE_ITEMS.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setMoreOpen(false)}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 text-[13px] font-medium text-text-2 hover:bg-bg"
              >
                <item.icon aria-hidden="true" className="size-4 text-text-3" />
                {item.label}
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function AdminSidebar({
  collapsed,
  pathname,
  displayName,
  roleLabel,
}: {
  collapsed: boolean
  pathname: string
  displayName: string
  roleLabel: string
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'sticky top-0 flex h-dvh shrink-0 flex-col overflow-y-auto bg-primary px-[14px] py-[22px] text-white transition-[width] duration-150',
          collapsed ? 'w-[60px] items-center px-[8px]' : 'w-[236px]',
        )}
      >
        <Link
          to="/admin"
          className={cn(
            'mb-5 flex items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring',
            collapsed ? 'justify-center px-0' : 'gap-[11px] px-2',
          )}
        >
          {/* Isotipo recortado del PNG original (DS-018, PNG temporal —
              deuda DS-020 hacia el vectorial IF-08): 34 px de alto fijo en
              los dos estados de la sidebar (`.sb-mark`, `ds.css`), con
              `srcSet` a @3x para pantallas de alta densidad. Sin nombre
              accesible propio cuando el lockup de texto está visible (el
              nombre lo aporta ese texto, no hay que duplicarlo); cuando la
              sidebar está colapsada es el único contenido del link, así que
              ahí sí lleva `alt`. */}
          <img
            src="/icons/isotipo_blanco_34px@2x.png"
            srcSet="/icons/isotipo_blanco_34px@2x.png 2x, /icons/isotipo_blanco_34px@3x.png 3x"
            alt={collapsed ? 'Extendiendo Servicios' : ''}
            className="h-[34px] w-auto shrink-0"
          />
          {!collapsed && (
            <span className="flex flex-col">
              <span className="text-[12.5px] leading-[1.18] font-bold tracking-[1.3px] uppercase">
                Extendiendo
                <br />
                Servicios
              </span>
              <span
                aria-hidden="true"
                className="mt-1 h-[2px] w-[26px] rounded-full bg-white/55"
              />
            </span>
          )}
        </Link>

        <NavSection
          label="Operación"
          items={ADMIN_NAV_OPERATION}
          pathname={pathname}
          collapsed={collapsed}
        />
        <NavSection
          label="Configuración"
          items={ADMIN_NAV_CONFIGURATION}
          pathname={pathname}
          collapsed={collapsed}
        />

        <div className="mt-auto border-t border-white/16 pt-3">
          <div
            className={cn(
              'flex items-center gap-[10px] rounded-md px-2 py-[6px]',
              collapsed && 'justify-center px-0',
            )}
          >
            <Avatar id="admin-session-user" name={displayName} />
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[12.5px] font-semibold">
                  {displayName}
                </p>
                <p className="truncate text-[10.5px] text-white/70">
                  {roleLabel}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}

function NavSection({
  label,
  items,
  pathname,
  collapsed,
}: {
  label: string
  items: AdminNavItem[]
  pathname: string
  collapsed: boolean
}) {
  return (
    <div>
      {!collapsed && (
        <p className="px-[10px] pt-[14px] pb-[6px] text-[10px] font-semibold tracking-[0.8px] text-white/55 uppercase">
          {label}
        </p>
      )}
      <nav aria-label={label}>
        <ul className="flex flex-col gap-px">
          {items.map((item) => {
            const active = isAdminNavItemActive(pathname, item)
            const link = (
              <Link
                to={item.path}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  'flex items-center gap-[11px] rounded-md px-[11px] py-[9px] text-[13px] text-white/82 outline-none focus-visible:ring-3 focus-visible:ring-ring',
                  active && 'bg-white/20 font-semibold text-white',
                  // Cuadrado de 44 px: con la sidebar en `items-center`, sin
                  // un ancho propio el link medía lo que el ícono, 16 px (P05.6).
                  collapsed && 'size-11 justify-center p-0',
                )}
              >
                <item.icon aria-hidden="true" className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            )

            if (!collapsed) {
              return (
                <li key={item.path} className="list-none">
                  {link}
                </li>
              )
            }

            return (
              <li key={item.path} className="list-none">
                <Tooltip>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

function AdminTabbar({
  pathname,
  onMore,
}: {
  pathname: string
  onMore: () => void
}) {
  return (
    <nav
      className="sticky bottom-0 z-20 flex h-[66px] shrink-0 items-center border-t border-border bg-surface px-1 pb-[6px]"
      style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}
      aria-label="Navegación principal"
    >
      {ADMIN_TABBAR_ITEMS.map((item) => {
        const active = isAdminNavItemActive(pathname, item)
        return (
          <Link
            key={item.path}
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
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex min-h-11 flex-1 flex-col items-center gap-1 pt-2 text-[10px] font-semibold text-text-3"
      >
        <MoreHorizontal aria-hidden="true" className="size-[21px]" />
        Más
      </button>
    </nav>
  )
}
