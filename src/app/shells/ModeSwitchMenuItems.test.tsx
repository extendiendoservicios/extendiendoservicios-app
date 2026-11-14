import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ModeSwitchMenuItems } from './ModeSwitchMenuItems'

const rolesMock = vi.hoisted(() => ({ current: ['admin'] as string[] }))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ roles: rolesMock.current }),
}))

// Menú forzado abierto: lo que se prueba son las opciones según los roles.
function renderItems(roles: string[]) {
  rolesMock.current = roles
  return render(
    <MemoryRouter>
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger>Menú</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ModeSwitchMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>
    </MemoryRouter>,
  )
}

describe('ModeSwitchMenuItems (P29.2, OG-08)', () => {
  afterEach(() => {
    rolesMock.current = ['admin']
  })

  it('sin rol de empleado ni de coordinador no muestra opciones', () => {
    renderItems(['owner'])
    expect(screen.queryByText(/Ir a mi app/)).not.toBeInTheDocument()
  })

  it('con rol empleado: "Ir a mi app de empleado" lleva a /app', () => {
    renderItems(['admin', 'employee'])
    expect(
      screen.getByRole('menuitem', { name: /Ir a mi app de empleado/ }),
    ).toHaveAttribute('href', '/app')
    expect(screen.queryByText(/Ir a mi app de coordinador/)).toBeNull()
  })

  it('con rol coordinador: "Ir a mi app de coordinador" lleva a /sup', () => {
    renderItems(['owner', 'supervisor'])
    expect(
      screen.getByRole('menuitem', { name: /Ir a mi app de coordinador/ }),
    ).toHaveAttribute('href', '/sup')
    expect(screen.queryByText(/Ir a mi app de empleado/)).toBeNull()
  })

  it('con ambos roles muestra las dos opciones', () => {
    renderItems(['admin', 'employee', 'supervisor'])
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })
})
