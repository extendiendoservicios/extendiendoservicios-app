import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { Constants } from '@/lib/database.types'

/**
 * Defecto 0.29.1: «Gestionar stock» no aparecía en «Roles y capacidades»
 * porque `ALL_ADMIN_CAPABILITIES` no sumó `manage_stock` (0069).
 */

vi.mock('@/api/users', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/users')>()
  return {
    ...original,
    fetchAdminCapabilities: () =>
      Promise.resolve(
        Object.fromEntries(
          original.ALL_ADMIN_CAPABILITIES.map((c) => [c, false]),
        ),
      ),
  }
})

const { ALL_ADMIN_CAPABILITIES } = await import('@/api/users')
const { RolesCapabilitiesSheet } = await import('./RolesCapabilitiesSheet')

describe('ALL_ADMIN_CAPABILITIES', () => {
  it('contiene todos los valores del enum admin_capability', () => {
    expect([...ALL_ADMIN_CAPABILITIES].sort()).toEqual(
      [...Constants.public.Enums.admin_capability].sort(),
    )
  })
})

describe('RolesCapabilitiesSheet', () => {
  it('muestra «Gestionar stock» entre las capacidades de un administrador', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <RolesCapabilitiesSheet
          open
          onOpenChange={vi.fn()}
          user={{
            profileId: 'p1',
            firstName: 'Ana',
            lastName: 'Pérez',
            isActive: true,
            deletedAt: null,
            roles: ['admin'],
            avatarPath: null,
            hasEmployeeRecord: false,
          }}
        />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Gestionar stock')).toBeInTheDocument()
  })
})
