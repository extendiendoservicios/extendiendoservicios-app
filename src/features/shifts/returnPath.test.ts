import { describe, expect, it } from 'vitest'
import {
  newShiftFromClientPath,
  newShiftFromEmployeePath,
  safeReturnPath,
} from './returnPath'

describe('safeReturnPath (P33.1, D-04)', () => {
  it('acepta direcciones de la ficha de un empleado', () => {
    const path = '/admin/empleados/abc?pestana=calendario&mes=2026-11'
    expect(safeReturnPath(path)).toBe(path)
  })

  it('acepta direcciones de la ficha de un cliente (P34.2)', () => {
    const path = '/admin/clientes/abc?pestana=calendario&mes=2026-11&sede=s1'
    expect(safeReturnPath(path)).toBe(path)
  })

  it.each([
    '/admin/clientes',
    '/admin/clientes//malo.com',
    '//malo.com/admin/clientes/x',
  ])('ignora %s', (raw) => {
    expect(safeReturnPath(raw)).toBeNull()
  })

  it.each([
    null,
    undefined,
    '',
    '/admin/planificacion',
    '/admin/empleados',
    'https://malo.com/admin/empleados/x',
    '//malo.com/admin/empleados/x',
    '/admin/empleados//malo.com',
    '/admin/empleados/x\\y',
    'javascript:alert(1)',
  ])('ignora %s', (raw) => {
    expect(safeReturnPath(raw)).toBeNull()
  })
})

describe('newShiftFromEmployeePath', () => {
  it('arma el enlace con fecha, empleado y vuelta con el mes', () => {
    const link = newShiftFromEmployeePath({
      date: '2026-11-10',
      profileId: 'p1',
      pathname: '/admin/empleados/p1',
      search: '?pestana=calendario',
      monthKey: '2026-11',
    })
    const [path, query] = link.split('?')
    expect(path).toBe('/admin/turnos/nuevo')
    const params = new URLSearchParams(query)
    expect(params.get('fecha')).toBe('2026-11-10')
    expect(params.get('empleado')).toBe('p1')
    expect(safeReturnPath(params.get('volver'))).toBe(
      '/admin/empleados/p1?pestana=calendario&mes=2026-11',
    )
  })
})

describe('newShiftFromClientPath (P34.2, D-11)', () => {
  it('lleva fecha, cliente, sede, empleado y vuelta con pestaña y mes', () => {
    const link = newShiftFromClientPath({
      date: '2026-11-10',
      clientId: 'c1',
      siteId: 's1',
      employeeId: 'e1',
      pathname: '/admin/clientes/c1',
      search: '?sede=s1&empleado=e1',
      monthKey: '2026-11',
    })
    const url = new URL(link, 'http://x')
    expect(url.pathname).toBe('/admin/turnos/nuevo')
    expect(url.searchParams.get('fecha')).toBe('2026-11-10')
    expect(url.searchParams.get('cliente')).toBe('c1')
    expect(url.searchParams.get('sede')).toBe('s1')
    expect(url.searchParams.get('empleado')).toBe('e1')
    const back = url.searchParams.get('volver') ?? ''
    expect(safeReturnPath(back)).toBe(back)
    const backParams = new URL(back, 'http://x').searchParams
    expect(backParams.get('pestana')).toBe('calendario')
    expect(backParams.get('mes')).toBe('2026-11')
    expect(backParams.get('sede')).toBe('s1')
    expect(backParams.get('empleado')).toBe('e1')
  })

  it('sin filtros no manda sede ni empleado y respeta el mes de la dirección', () => {
    const link = newShiftFromClientPath({
      date: '2026-11-10',
      clientId: 'c1',
      pathname: '/admin/clientes/c1',
      search: '?mes=2026-12',
      monthKey: '2026-11',
    })
    const url = new URL(link, 'http://x')
    expect(url.searchParams.has('sede')).toBe(false)
    expect(url.searchParams.has('empleado')).toBe(false)
    const back = new URL(url.searchParams.get('volver') ?? '', 'http://x')
    expect(back.searchParams.get('mes')).toBe('2026-12')
  })
})
