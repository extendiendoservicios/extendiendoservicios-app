import { describe, expect, it } from 'vitest'
import {
  canEditRatingsAlways,
  canManageSupervisions,
  canMarkSupervisionNotDone,
} from './permissions'

const owner = { roles: ['owner' as const], capabilities: [] }
const adminSinCapacidades = { roles: ['admin' as const], capabilities: [] }
const adminCompleto = {
  roles: ['admin' as const],
  capabilities: ['manage_supervisions' as const, 'edit_ratings' as const],
}
const supervisor = { roles: ['supervisor' as const], capabilities: [] }

describe('permisos de supervisiones', () => {
  it('marcar como no realizada no exige capacidad para O/A', () => {
    expect(canMarkSupervisionNotDone(owner)).toBe(true)
    expect(canMarkSupervisionNotDone(adminSinCapacidades)).toBe(true)
    expect(canMarkSupervisionNotDone(supervisor)).toBe(false)
  })

  it('asignar y cancelar exigen manage_supervisions al administrador', () => {
    expect(canManageSupervisions(owner)).toBe(true)
    expect(canManageSupervisions(adminSinCapacidades)).toBe(false)
    expect(canManageSupervisions(adminCompleto)).toBe(true)
  })

  it('editar calificaciones siempre exige edit_ratings al administrador', () => {
    expect(canEditRatingsAlways(owner)).toBe(true)
    expect(canEditRatingsAlways(adminSinCapacidades)).toBe(false)
    expect(canEditRatingsAlways(adminCompleto)).toBe(true)
  })
})
