import { describe, expect, it } from 'vitest'
import {
  defaultMediaFilters,
  toApiFilters,
  withClient,
  withStateFilter,
} from './filters'

const TODAY = '2026-10-13'

describe('filtros de ADM-32', () => {
  it('por defecto, los últimos 30 días', () => {
    const filters = defaultMediaFilters(TODAY)
    expect(filters.dateFrom).toBe('2026-09-13')
    expect(filters.dateTo).toBe(TODAY)
    expect(toApiFilters(filters, TODAY)).toEqual({
      dateFrom: '2026-09-13',
      dateTo: TODAY,
      clientId: undefined,
      siteId: undefined,
      uploadedBy: undefined,
      kind: undefined,
      keepOnly: undefined,
      expiresBy: undefined,
    })
  })

  it('«Conservadas» manda keepOnly', () => {
    const filters = withStateFilter(defaultMediaFilters(TODAY), 'keep', TODAY)
    expect(toApiFilters(filters, TODAY).keepOnly).toBe(true)
  })

  it('«Por vencer en 7 días» manda hoy + 7', () => {
    const filters = withStateFilter(
      defaultMediaFilters(TODAY),
      'expiring',
      TODAY,
    )
    expect(toApiFilters(filters, TODAY).expiresBy).toBe('2026-10-20')
  })

  it('al activar «Conservadas» o «Por vencer» se vacía el rango por defecto (lo por vencer es más viejo)', () => {
    const filters = withStateFilter(
      defaultMediaFilters(TODAY),
      'expiring',
      TODAY,
    )
    expect(filters.dateFrom).toBe('')
    expect(filters.dateTo).toBe('')
  })

  it('un rango elegido a mano se respeta al activar «Conservadas»', () => {
    const custom = { ...defaultMediaFilters(TODAY), dateFrom: '2026-08-01' }
    const filters = withStateFilter(custom, 'keep', TODAY)
    expect(filters.dateFrom).toBe('2026-08-01')
  })

  it('al volver a «Todas» con el rango vacío, vuelve el de por defecto', () => {
    const expiring = withStateFilter(
      defaultMediaFilters(TODAY),
      'expiring',
      TODAY,
    )
    const back = withStateFilter(expiring, 'all', TODAY)
    expect(back.dateFrom).toBe('2026-09-13')
    expect(back.dateTo).toBe(TODAY)
  })

  it('cambiar de cliente limpia la sede', () => {
    const filters = withClient(
      { ...defaultMediaFilters(TODAY), clientId: 'c1', siteId: 's1' },
      'c2',
    )
    expect(filters.clientId).toBe('c2')
    expect(filters.siteId).toBe('all')
  })

  it('cliente, sede, persona y tipo pasan al API cuando se eligen', () => {
    const api = toApiFilters(
      {
        ...defaultMediaFilters(TODAY),
        clientId: 'c1',
        siteId: 's1',
        uploadedBy: 'p1',
        kind: 'video',
      },
      TODAY,
    )
    expect(api).toMatchObject({
      clientId: 'c1',
      siteId: 's1',
      uploadedBy: 'p1',
      kind: 'video',
    })
  })
})
