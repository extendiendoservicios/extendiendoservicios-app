import { Link, useLocation } from 'react-router'
import { cn } from 'cn'
import type { Role } from '@/api/users'
import { canViewOwnerOnlyConfig } from '@/features/settings/permissions'

/**
 * Subnavegación de "Configuración" (`05_Pantallas_y_Navegacion.md` sección
 * 2.7): la sidebar de `AdminShell` (`src/app/shells/adminNav.ts`, fuera de
 * este dominio) solo tiene un ítem "Configuración" que lleva a ADM-27 --
 * este componente es la forma de moverse entre las cinco pantallas del
 * grupo una vez adentro, mismas pestañas subrayadas que `Tabs` (`07` sección
 * 2.3) pero enrutadas con `Link` en vez de controlar contenido en el
 * cliente (Radix `Tabs` no sirve acá: cada pestaña es una ruta propia, no
 * una vista alternativa del mismo componente).
 *
 * Se muestra en las cinco páginas (incluida `UsersPage`, agregada en este
 * mismo encargo) para que la navegación sea consistente en cualquiera de
 * ellas. Los ítems solo del dueño (Feriados, Criterios, Eventos de
 * seguridad) no aparecen para un administrador -- si igual escribiera la URL
 * a mano, la pantalla misma se lo niega (`OwnerOnlyNotice`).
 */
interface ConfigNavItem {
  label: string
  path: string
  ownerOnly?: boolean
}

const CONFIG_NAV_ITEMS: ConfigNavItem[] = [
  { label: 'Usuarios', path: '/admin/configuracion/usuarios' },
  { label: 'Empresa', path: '/admin/configuracion/empresa' },
  { label: 'Feriados', path: '/admin/configuracion/feriados', ownerOnly: true },
  {
    label: 'Criterios de calificación',
    path: '/admin/configuracion/criterios',
    ownerOnly: true,
  },
  {
    label: 'Eventos de seguridad',
    path: '/admin/configuracion/seguridad',
    ownerOnly: true,
  },
]

function ConfigNav({ roles }: { roles: Role[] }) {
  const location = useLocation()
  const isOwnerViewer = canViewOwnerOnlyConfig({ roles })
  const items = CONFIG_NAV_ITEMS.filter(
    (item) => !item.ownerOnly || isOwnerViewer,
  )

  return (
    <nav
      aria-label="Secciones de configuración"
      className="flex items-center gap-[2px] overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-border"
    >
      {items.map((item) => {
        const active = location.pathname === item.path
        return (
          <Link
            key={item.path}
            to={item.path}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 border-transparent px-[14px] py-[11px] text-[12.5px] font-semibold whitespace-nowrap text-text-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring',
              active && 'border-primary text-primary-800',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

export { ConfigNav }
