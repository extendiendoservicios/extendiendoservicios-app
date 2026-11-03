import { describe, expect, it } from 'vitest'
import {
  acceptedNames,
  canOwnerDelete,
  confirmNameMatches,
  normalizeName,
} from './matching'

describe('canOwnerDelete', () => {
  it('solo el dueño', () => {
    expect(canOwnerDelete({ roles: ['owner'] })).toBe(true)
    expect(canOwnerDelete({ roles: ['admin'] })).toBe(false)
    expect(canOwnerDelete({ roles: ['admin', 'employee'] })).toBe(false)
    expect(canOwnerDelete({ roles: [] })).toBe(false)
  })
})

describe('confirmNameMatches', () => {
  const service = { name: 'Limpieza  mañana', alternativeNames: [] }

  it('ignora mayúsculas y espacios de más', () => {
    expect(normalizeName('  LIMPIEZA   mañana ')).toBe('limpieza mañana')
    expect(confirmNameMatches('service', service, ' limpieza MAÑANA ')).toBe(
      true,
    )
  })

  it('no confirma con vacío ni con otro nombre', () => {
    expect(confirmNameMatches('service', service, '')).toBe(false)
    expect(confirmNameMatches('service', service, '   ')).toBe(false)
    expect(confirmNameMatches('service', service, 'Limpieza tarde')).toBe(false)
  })

  it('el turno no pide nombre', () => {
    expect(confirmNameMatches('shift', service, '')).toBe(true)
  })

  it('el cliente acepta razón social y nombre comercial', () => {
    const client = {
      name: 'Fantasía',
      alternativeNames: ['Razón Social SRL', 'Fantasía'],
    }
    expect(confirmNameMatches('client', client, 'razón social srl')).toBe(true)
    expect(confirmNameMatches('client', client, 'Fantasía')).toBe(true)
  })

  it('el empleado acepta «Nombre Apellido» y «Apellido Nombre»', () => {
    const employee = { name: 'Ana Gómez', alternativeNames: [] }
    expect(acceptedNames('employee', employee)).toContain('Gómez Ana')
    expect(confirmNameMatches('employee', employee, 'Ana Gómez')).toBe(true)
    expect(confirmNameMatches('employee', employee, 'gómez ana')).toBe(true)
    expect(confirmNameMatches('employee', employee, 'Ana')).toBe(false)
  })
})
