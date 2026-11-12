import { describe, expect, it } from 'vitest'
import {
  EMPTY_CALENDAR_FILTERS,
  describeCalendarFilters,
  filterShiftsOfDay,
  hasActiveFilters,
  leaveCoversDate,
  leaveEmployeesByDate,
  leaveEntryText,
  leaveReasonLabel,
  leaveReasonOn,
  leaveSummaryLabel,
  readCalendarFilters,
  toBoardFilters,
  visibleLeaves,
  writeCalendarFilters,
  type CalendarFilters,
} from './calendarFilters'

const LEAVES = [
  {
    employeeId: 'e1',
    startsOn: '2026-10-05',
    endsOn: '2026-10-07',
    reason: null,
  },
  { employeeId: 'e2', startsOn: '2026-10-06', endsOn: null, reason: 'Franco' },
]

describe('filtros en la URL', () => {
  it('sin parámetros son todos «all»', () => {
    expect(readCalendarFilters(new URLSearchParams())).toEqual(
      EMPTY_CALENDAR_FILTERS,
    )
  })

  it('escribe y lee de ida y vuelta, y deja intactos los otros parámetros', () => {
    const filters: CalendarFilters = {
      clientId: 'c1',
      siteId: 's1',
      employeeId: 'e1',
      status: 'assigned',
    }
    const params = writeCalendarFilters(
      new URLSearchParams('vista=semana&fecha=2026-10-05'),
      filters,
    )
    expect(params.get('vista')).toBe('semana')
    expect(params.get('cliente')).toBe('c1')
    expect(readCalendarFilters(params)).toEqual(filters)
  })

  it('al volver a «todos» quita el parámetro', () => {
    const params = writeCalendarFilters(
      new URLSearchParams('cliente=c1&estado=assigned'),
      { ...EMPTY_CALENDAR_FILTERS, clientId: 'c2' },
    )
    expect(params.get('cliente')).toBe('c2')
    expect(params.has('estado')).toBe(false)
  })

  it('hasActiveFilters y toBoardFilters ignoran «all»', () => {
    expect(hasActiveFilters(EMPTY_CALENDAR_FILTERS)).toBe(false)
    const filters = { ...EMPTY_CALENDAR_FILTERS, employeeId: 'e1' }
    expect(hasActiveFilters(filters)).toBe(true)
    expect(toBoardFilters(filters)).toEqual({
      clientId: undefined,
      siteId: undefined,
      employeeId: 'e1',
      status: undefined,
    })
  })
})

describe('describeCalendarFilters (encabezado impreso)', () => {
  it('sin filtros lo dice', () => {
    expect(describeCalendarFilters(EMPTY_CALENDAR_FILTERS, {})).toEqual([
      'Sin filtros',
    ])
  })

  it('nombra cada filtro aplicado con el estado en español', () => {
    expect(
      describeCalendarFilters(
        {
          clientId: 'c1',
          siteId: 's1',
          employeeId: 'e1',
          status: 'uncovered',
        },
        { client: 'Limpia Ya', site: 'Centro', employee: 'Ana Gómez' },
      ),
    ).toEqual([
      'Cliente: Limpia Ya',
      'Sede: Centro',
      'Empleado: Ana Gómez',
      'Estado: Sin cubrir',
    ])
  })
})

describe('filterShiftsOfDay', () => {
  const shifts = [
    { id: 't1', clientId: 'c1', siteId: 's1', displayStatus: 'assigned' },
    { id: 't2', clientId: 'c2', siteId: 's2', displayStatus: 'scheduled' },
    { id: 't3', clientId: 'c1', siteId: 's3', displayStatus: 'scheduled' },
  ]

  it('sin filtros devuelve todos', () => {
    expect(
      filterShiftsOfDay(shifts, EMPTY_CALENDAR_FILTERS, null),
    ).toHaveLength(3)
  })

  it('combina cliente y estado', () => {
    const result = filterShiftsOfDay(
      shifts,
      { ...EMPTY_CALENDAR_FILTERS, clientId: 'c1', status: 'scheduled' },
      null,
    )
    expect(result.map((shift) => shift.id)).toEqual(['t3'])
  })

  it('por sede', () => {
    const result = filterShiftsOfDay(
      shifts,
      { ...EMPTY_CALENDAR_FILTERS, siteId: 's2' },
      null,
    )
    expect(result.map((shift) => shift.id)).toEqual(['t2'])
  })

  it('por empleado usa el conjunto de sus turnos; sin conjunto no deja pasar nada', () => {
    const filters = { ...EMPTY_CALENDAR_FILTERS, employeeId: 'e1' }
    expect(
      filterShiftsOfDay(shifts, filters, new Set(['t2'])).map(
        (shift) => shift.id,
      ),
    ).toEqual(['t2'])
    expect(filterShiftsOfDay(shifts, filters, null)).toEqual([])
  })
})

describe('licencias en el calendario (OD-14)', () => {
  it('con un empleado elegido muestra solo sus licencias', () => {
    expect(
      visibleLeaves(LEAVES, { ...EMPTY_CALENDAR_FILTERS, employeeId: 'e2' }),
    ).toEqual([LEAVES[1]])
  })

  it('con cliente, sede o estado y sin empleado no muestra licencias', () => {
    for (const patch of [
      { clientId: 'c1' },
      { siteId: 's1' },
      { status: 'assigned' },
    ]) {
      expect(
        visibleLeaves(LEAVES, { ...EMPTY_CALENDAR_FILTERS, ...patch }),
      ).toEqual([])
    }
  })

  it('con empleado y cliente a la vez conserva las licencias del empleado', () => {
    expect(
      visibleLeaves(LEAVES, {
        ...EMPTY_CALENDAR_FILTERS,
        employeeId: 'e1',
        clientId: 'c1',
      }),
    ).toEqual([LEAVES[0]])
  })

  it('sin filtros muestra todas', () => {
    expect(visibleLeaves(LEAVES, EMPTY_CALENDAR_FILTERS)).toHaveLength(2)
  })

  it('leaveCoversDate incluye los bordes y trata el fin vacío como abierto', () => {
    expect(leaveCoversDate(LEAVES[0]!, '2026-10-05')).toBe(true)
    expect(leaveCoversDate(LEAVES[0]!, '2026-10-07')).toBe(true)
    expect(leaveCoversDate(LEAVES[0]!, '2026-10-08')).toBe(false)
    expect(leaveCoversDate(LEAVES[1]!, '2027-01-01')).toBe(true)
    expect(leaveCoversDate(LEAVES[1]!, '2026-10-05')).toBe(false)
  })

  it('leaveEmployeesByDate agrupa por día y omite los días sin licencias', () => {
    const byDate = leaveEmployeesByDate(LEAVES, [
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-08',
    ])
    expect([...byDate.keys()]).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-08',
    ])
    expect(byDate.get('2026-10-05')).toEqual(['e1'])
    expect(byDate.get('2026-10-06')).toEqual(['e1', 'e2'])
    expect(byDate.get('2026-10-08')).toEqual(['e2'])
  })

  it('leaveSummaryLabel nombra a uno solo y cuenta a varios', () => {
    expect(leaveSummaryLabel(['Ana Gómez'])).toBe('Licencia: Ana Gómez')
    expect(leaveSummaryLabel(['Ana Gómez'], ['Franco'])).toBe(
      'Franco: Ana Gómez',
    )
    expect(leaveSummaryLabel(['Ana Gómez', 'Luis Díaz'])).toBe('2 licencias')
  })

  it('leaveReasonOn devuelve el motivo de la licencia de ese día', () => {
    expect(leaveReasonOn(LEAVES, 'e2', '2026-10-06')).toBe('Franco')
    expect(leaveReasonOn(LEAVES, 'e1', '2026-10-06')).toBeNull()
    expect(leaveReasonOn(LEAVES, 'e2', '2026-10-01')).toBeNull()
  })

  it('leaveReasonOn junta los motivos si hay licencias superpuestas (OF-20)', () => {
    const overlapped = [
      {
        employeeId: 'e1',
        startsOn: '2026-10-05',
        endsOn: '2026-10-09',
        reason: 'Vacaciones',
      },
      {
        employeeId: 'e1',
        startsOn: '2026-10-07',
        endsOn: '2026-10-08',
        reason: 'Enfermedad',
      },
    ] as unknown as typeof LEAVES
    expect(leaveReasonOn(overlapped, 'e1', '2026-10-06')).toBe('Vacaciones')
    expect(leaveReasonOn(overlapped, 'e1', '2026-10-07')).toBe(
      'Vacaciones / Enfermedad',
    )
  })

  it('leaveReasonLabel y leaveEntryText usan el motivo o «Licencia»', () => {
    expect(leaveReasonLabel('Franco')).toBe('Franco')
    expect(leaveReasonLabel(null)).toBe('Licencia')
    expect(leaveEntryText({ name: 'Ana', reason: 'Franco' })).toBe(
      'Ana (Franco)',
    )
    expect(leaveEntryText({ name: 'Ana', reason: null })).toBe('Ana')
  })
})
