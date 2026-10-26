import { describe, expect, it } from 'vitest'
import type { SupervisorPriority } from '@/api/supervisorPriorities'
import {
  preferredSupervisorsOfClient,
  preferredSupervisorsOfSite,
  prioritiesOfSupervisor,
} from './priorities'

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

const SITE_PRIORITY = priority({
  id: 'p2',
  kind: 'site',
  siteId: 's1',
  siteName: 'Sede Centro',
})

describe('prioritiesOfSupervisor', () => {
  it('se queda con las del coordinador y pone el cliente entero antes que sus sedes', () => {
    const result = prioritiesOfSupervisor(
      [
        SITE_PRIORITY,
        priority({ id: 'p3', supervisorId: 'otro' }),
        priority({ id: 'p4' }),
        priority({ id: 'p5', clientId: 'c0', clientName: 'Cliente Cero' }),
      ],
      'sup1',
    )
    expect(result.map((item) => item.id)).toEqual(['p5', 'p4', 'p2'])
  })
})

describe('preferredSupervisorsOfClient', () => {
  it('lista el cliente entero y las sedes de ese cliente, no las de otros', () => {
    const result = preferredSupervisorsOfClient(
      [
        SITE_PRIORITY,
        priority({ id: 'p4', supervisorId: 'sup2', supervisorName: 'Bruno' }),
        priority({ id: 'p9', clientId: 'c9', supervisorId: 'sup3' }),
      ],
      'c1',
    )
    expect(result.map((item) => [item.priorityId, item.scope])).toEqual([
      ['p4', 'client'],
      ['p2', 'site'],
    ])
    expect(result.every((item) => !item.inherited)).toBe(true)
  })
})

describe('preferredSupervisorsOfSite', () => {
  it('suma los que llegan por el cliente (también para sedes nuevas) y los marca heredados', () => {
    const result = preferredSupervisorsOfSite(
      [
        SITE_PRIORITY,
        priority({ id: 'p4', supervisorId: 'sup2', supervisorName: 'Bruno' }),
        priority({
          id: 'p6',
          kind: 'site',
          siteId: 's2',
          siteName: 'Otra sede',
        }),
      ],
      's1',
      'c1',
    )
    expect(result.map((item) => [item.priorityId, item.inherited])).toEqual([
      ['p2', false],
      ['p4', true],
    ])
  })
})
