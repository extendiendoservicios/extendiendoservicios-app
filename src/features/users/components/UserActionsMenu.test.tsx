import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UserActionsMenu } from './UserActionsMenu'
import type { AdminUserRow } from '@/api/users'
import type { UsersScreenActor } from '@/features/users/permissions'

/**
 * USERS-011: si una fila tiene alguna acción disponible, se ve el botón
 * "…" que abre el menú (`permissions.test.ts` ya prueba, sin renderizar
 * nada, exactamente qué acciones trae cada combinación de actor/fila --
 * abrir de verdad un `DropdownMenu` de Radix en jsdom con `fireEvent` es
 * frágil, así que ese detalle queda ahí). Se mockean los hooks de mutación
 * (sin red, sin `QueryClientProvider`).
 */
vi.mock('@/features/users/queries', () => ({
  useResetPasswordMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEmailMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSignOutUserMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeactivateUserMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactivateUserMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const owner: UsersScreenActor = { roles: ['owner'], capabilities: [] }
const adminWithManageUsers: UsersScreenActor = {
  roles: ['admin'],
  capabilities: ['manage_users'],
}

function activeUser(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    profileId: 'p1',
    firstName: 'Ana',
    lastName: 'Gómez',
    isActive: true,
    deletedAt: null,
    roles: ['employee'],
    ...overrides,
  }
}

describe('UserActionsMenu', () => {
  it('el dueño ve el botón de acciones sobre un empleado activo', () => {
    render(
      <UserActionsMenu
        user={activeUser()}
        actor={owner}
        onEditRolesAndCapabilities={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: /acciones para ana gómez/i }),
    ).toBeInTheDocument()
  })

  it('un administrador con manage_users no ve ningún botón sobre otro administrador', () => {
    render(
      <UserActionsMenu
        user={activeUser({ roles: ['admin'] })}
        actor={adminWithManageUsers}
        onEditRolesAndCapabilities={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /acciones para/i }),
    ).not.toBeInTheDocument()
  })

  it('un administrador con manage_users no ve nada sobre un usuario desactivado (reactivar es solo del dueño)', () => {
    render(
      <UserActionsMenu
        user={activeUser({
          deletedAt: '2026-09-01T00:00:00Z',
          isActive: false,
        })}
        actor={adminWithManageUsers}
        onEditRolesAndCapabilities={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /acciones para/i }),
    ).not.toBeInTheDocument()
  })

  it('el dueño sí ve el botón sobre un usuario desactivado (puede reactivarlo)', () => {
    render(
      <UserActionsMenu
        user={activeUser({
          deletedAt: '2026-09-01T00:00:00Z',
          isActive: false,
        })}
        actor={owner}
        onEditRolesAndCapabilities={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('button', { name: /acciones para/i }),
    ).toBeInTheDocument()
  })
})
