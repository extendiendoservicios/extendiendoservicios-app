import { describe, expect, it } from 'vitest'
import { newClientPickerOptions, newSitePickerOptions } from './pickerOptions'

describe('newClientPickerOptions', () => {
  const clients = [
    { id: 'c1', tradeName: 'Limpia Ya', legalName: 'L SRL', status: 'active' },
    { id: 'c2', tradeName: null, legalName: 'Susp SA', status: 'suspended' },
    { id: 'c3', tradeName: 'Baja', legalName: 'B SA', status: 'inactive' },
  ]

  it('deja fuera a los clientes suspendidos y dados de baja', () => {
    expect(newClientPickerOptions(clients)).toEqual([
      { value: 'c1', label: 'Limpia Ya' },
    ])
  })

  it('conserva el cliente vigente al editar, marcado como inactivo', () => {
    expect(newClientPickerOptions(clients, 'c2')).toEqual([
      { value: 'c1', label: 'Limpia Ya' },
      { value: 'c2', label: 'Susp SA (suspendido)' },
    ])
  })
})

describe('newSitePickerOptions', () => {
  const sites = [
    { id: 's1', name: 'Centro', status: 'active' },
    { id: 's2', name: 'Norte', status: 'inactive' },
  ]

  it('deja fuera las sedes inactivas', () => {
    expect(newSitePickerOptions(sites)).toEqual([
      { value: 's1', label: 'Centro' },
    ])
  })

  it('conserva la sede vigente al editar', () => {
    expect(newSitePickerOptions(sites, 's2')).toContainEqual({
      value: 's2',
      label: 'Norte (inactiva)',
    })
  })
})
