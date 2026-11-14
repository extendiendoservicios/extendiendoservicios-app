// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyDayAssignment } from '@/api/myDay'
import { isNewOfficeMessage, rememberOfficeMessages } from './officeMessageSeen'

function a(id: string, shiftNotes: string | null): MyDayAssignment {
  return { assignmentId: id, shiftNotes } as MyDayAssignment
}

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('isNewOfficeMessage (P29 OG-05)', () => {
  it('no distingue si nunca se guardó nada para la asignación', () => {
    expect(isNewOfficeMessage(a('a1', 'Hola'))).toBe(false)
  })

  it('es nuevo si el mensaje cambió o apareció desde lo último visto', () => {
    rememberOfficeMessages([a('a1', 'Hola'), a('a2', null)])
    expect(isNewOfficeMessage(a('a1', 'Hola'))).toBe(false)
    expect(isNewOfficeMessage(a('a1', 'Hola, cambió'))).toBe(true)
    expect(isNewOfficeMessage(a('a2', 'Mensaje nuevo'))).toBe(true)
  })

  it('si se borró el mensaje no es «nuevo»', () => {
    rememberOfficeMessages([a('a1', 'Hola')])
    expect(isNewOfficeMessage(a('a1', null))).toBe(false)
  })

  it('no se rompe si el almacenamiento falla', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denegado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('lleno')
    })
    expect(() => rememberOfficeMessages([a('a1', 'Hola')])).not.toThrow()
    expect(isNewOfficeMessage(a('a1', 'Hola'))).toBe(false)
  })
})
