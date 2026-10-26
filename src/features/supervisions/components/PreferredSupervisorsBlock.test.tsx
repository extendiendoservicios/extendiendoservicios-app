import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupervisorPriority } from '@/api/supervisorPriorities'
import { PreferredSupervisorsBlock } from './PreferredSupervisorsBlock'

const { auth, state, removeMutate } = vi.hoisted(() => ({
  auth: {
    roles: ['owner'] as string[],
    capabilities: [] as string[],
  },
  state: { priorities: [] as unknown[] },
  removeMutate: vi.fn(),
}))

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => auth }))
vi.mock('@/features/supervisions/queries', () => ({
  useSupervisorPrioritiesQuery: () => ({
    isLoading: false,
    data: state.priorities,
  }),
  useSupervisorCandidatesQuery: () => ({
    data: [{ profileId: 'sup9', firstName: 'Carla', lastName: 'Díaz' }],
  }),
  useSetSupervisorPriorityMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRemoveSupervisorPriorityMutation: () => ({
    mutateAsync: removeMutate,
    isPending: false,
  }),
}))

function priority(overrides: Partial<SupervisorPriority>): SupervisorPriority {
  return {
    id: 'p1',
    supervisorId: 'sup1',
    supervisorName: 'Ana Pérez',
    kind: 'client',
    clientId: 'c1',
    clientName: 'Cliente Uno',
    siteId: null,
    siteName: null,
    createdAt: '2026-10-23T10:00:00Z',
    ...overrides,
  }
}

/** `PersonCell` repite el nombre en un texto solo para lectores de pantalla. */
function expectName(name: string) {
  expect(screen.getAllByText(name).length).toBeGreaterThan(0)
}

function renderBlock(props: { clientId: string; siteId?: string }) {
  return render(
    <MemoryRouter>
      <PreferredSupervisorsBlock {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.roles = ['owner']
  auth.capabilities = []
  state.priorities = []
  removeMutate.mockReset()
  removeMutate.mockResolvedValue(undefined)
})

describe('PreferredSupervisorsBlock', () => {
  it('sin prioridades avisa que todavía no hay coordinadores preferenciales', () => {
    renderBlock({ clientId: 'c1' })
    expect(
      screen.getByRole('heading', { name: 'Coordinadores preferenciales' }),
    ).toBeVisible()
    expect(
      screen.getByText('Todavía no hay coordinadores preferenciales.'),
    ).toBeVisible()
  })

  it('en la ficha del cliente lista al del cliente entero y al que tiene una de sus sedes', () => {
    state.priorities = [
      priority({}),
      priority({
        id: 'p2',
        supervisorId: 'sup2',
        supervisorName: 'Bruno Gómez',
        kind: 'site',
        siteId: 's1',
        siteName: 'Sede Centro',
      }),
      priority({ id: 'p3', clientId: 'otro', supervisorName: 'Ajeno' }),
    ]
    renderBlock({ clientId: 'c1' })
    expectName('Ana Pérez')
    expect(screen.getByText('Cliente entero, todas sus sedes')).toBeVisible()
    expectName('Bruno Gómez')
    expect(screen.getByText('Sede Sede Centro')).toBeVisible()
    expect(screen.queryAllByText('Ajeno')).toHaveLength(0)
  })

  it('en la ficha de la sede el que llega por el cliente no se quita desde ahí', () => {
    state.priorities = [
      priority({}),
      priority({
        id: 'p2',
        supervisorId: 'sup2',
        supervisorName: 'Bruno Gómez',
        kind: 'site',
        siteId: 's1',
        siteName: 'Sede Centro',
      }),
    ]
    renderBlock({ clientId: 'c1', siteId: 's1' })
    expect(screen.getByText('Por el cliente entero')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Quitar a Ana Pérez' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Quitar a Bruno Gómez' }),
    ).toBeVisible()
  })

  it('quitar llama a la baja con el id de esa prioridad', () => {
    state.priorities = [priority({})]
    renderBlock({ clientId: 'c1' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar a Ana Pérez' }))
    expect(removeMutate).toHaveBeenCalledWith('p1')
  })

  it('el administrador sin manage_supervisions solo lee: sin Agregar ni Quitar', () => {
    auth.roles = ['admin']
    auth.capabilities = []
    state.priorities = [priority({})]
    renderBlock({ clientId: 'c1' })
    expectName('Ana Pérez')
    expect(screen.queryByRole('button', { name: 'Agregar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Quitar/ })).toBeNull()
  })

  it('el administrador con manage_supervisions ve Agregar', () => {
    auth.roles = ['admin']
    auth.capabilities = ['manage_supervisions']
    renderBlock({ clientId: 'c1' })
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeDisabled()
  })
})
