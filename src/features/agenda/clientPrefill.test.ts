import { describe, expect, it } from 'vitest'
import {
  buildClientPrefillState,
  readAgendaClientPrefill,
} from './clientPrefill'

describe('precarga del alta de cliente desde la Agenda', () => {
  it('ida y vuelta por location.state', () => {
    const state = buildClientPrefillState({
      agendaItemId: 'abc',
      legalName: 'Edificio Sol',
      adminAddress: 'Calle 1 234',
      notes: 'Llamar el lunes',
      returnTo: '/admin/agenda?mes=2026-11',
    })
    expect(readAgendaClientPrefill(state)).toEqual({
      agendaItemId: 'abc',
      legalName: 'Edificio Sol',
      adminAddress: 'Calle 1 234',
      notes: 'Llamar el lunes',
      returnTo: '/admin/agenda?mes=2026-11',
    })
  })

  it('no vuelve a una dirección ajena a la Agenda', () => {
    const state = {
      agendaPrefill: { agendaItemId: 'abc', returnTo: 'https://otro.sitio' },
    }
    expect(readAgendaClientPrefill(state)?.returnTo).toBe('/admin/agenda')
  })

  it('ignora cualquier otro estado', () => {
    expect(readAgendaClientPrefill(null)).toBeNull()
    expect(readAgendaClientPrefill({})).toBeNull()
    expect(readAgendaClientPrefill({ agendaPrefill: {} })).toBeNull()
    expect(readAgendaClientPrefill({ agendaPrefill: 3 })).toBeNull()
  })
})
