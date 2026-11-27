import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AttendanceBoardRow } from '@/api/attendance'
import { scheduleSortKey, statusSortKey } from '../servicesToday'
import { ServicesTodayTable } from './ServicesTodayTable'

/**
 * OH-01 y OH-02: «Servicios de hoy» con alto acotado (unas 10 filas, encabezado
 * fijo), columnas redimensionables y orden por encabezado que se recuerda.
 */

vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

function makeRow(overrides: Partial<AttendanceBoardRow>): AttendanceBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-18',
    shiftStatus: 'assigned',
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Gómez',
    employeeAvatarPath: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    startsAt: null,
    endsAt: null,
    status: 'expected',
    displayStatus: 'expected',
    notes: null,
    checkInAt: null,
    checkOutAt: null,
    minutesEarlyLeave: null,
    lastNoticeMinutesLate: null,
    lastNoticeEstimatedArrivalAt: null,
    plannedMinutes: 240,
    workedMinutes: null,
    ...overrides,
  } as AttendanceBoardRow
}

const ROWS: AttendanceBoardRow[] = [
  makeRow({
    id: 'a1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Zapata',
    startTime: '14:00:00',
    endTime: '18:00:00',
    clientName: 'Banco Sur',
  }),
  makeRow({
    id: 'a2',
    employeeFirstName: 'Luis',
    employeeLastName: 'Díaz',
    startTime: '06:00:00',
    endTime: '10:00:00',
    clientName: 'Colegio Mayor',
    status: 'present',
    displayStatus: 'present',
    checkInAt: '2026-11-18T09:05:00Z',
  }),
  makeRow({
    id: 'a3',
    employeeFirstName: 'Marta',
    employeeLastName: 'Acosta',
    startTime: '10:00:00',
    endTime: '14:00:00',
    clientName: 'Estudio Norte',
    displayStatus: 'no_record',
  }),
]

function renderTable(rows: AttendanceBoardRow[] = ROWS) {
  return render(
    <MemoryRouter>
      <ServicesTodayTable
        rows={rows}
        isLoading={false}
        phones={undefined}
        canRecord={() => false}
        canAssign={() => false}
        onRecord={() => undefined}
        onAssign={() => undefined}
      />
    </MemoryRouter>,
  )
}

function employeeNames(): string[] {
  const table = screen.getByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('ServicesTodayTable: claves de orden (OH-02)', () => {
  it('el horario se ordena por hora de inicio, con las horas de un dígito bien', () => {
    expect(
      scheduleSortKey({ startTime: '09:00:00', endTime: '13:00:00' }) <
        scheduleSortKey({ startTime: '14:00:00', endTime: '18:00:00' }),
    ).toBe(true)
  })

  it('el estado se ordena por urgencia: sin fichar antes que presente', () => {
    const noRecord = statusSortKey({
      status: 'expected',
      displayStatus: 'no_record',
      shiftStatus: 'assigned',
      minutesEarlyLeave: null,
      lastNoticeMinutesLate: null,
    })
    const present = statusSortKey({
      status: 'present',
      displayStatus: 'present',
      shiftStatus: 'assigned',
      minutesEarlyLeave: null,
      lastNoticeMinutesLate: null,
    })
    expect(noRecord).toBeLessThan(present)
  })
})

describe('ServicesTodayTable: alto acotado, orden y anchos (OH-01, OH-02)', () => {
  it('acota el alto a unas 10 filas con scroll propio', () => {
    renderTable()
    const scroller = screen.getByRole('table').closest('div[style]')
    expect(scroller).not.toBeNull()
    expect((scroller as HTMLElement).style.maxHeight).toBe(
      'calc(37.5rem)', // 2,5 rem de encabezado + 10 filas de 3,5 rem,
    )
  })

  it('ordena por Horario ascendente, descendente y vuelve al orden original', () => {
    renderTable()
    expect(employeeNames()[0]).toContain('Zapata')

    const header = screen.getByRole('button', { name: /Horario/ })
    fireEvent.click(header)
    expect(employeeNames().map((name) => name.trim())).toEqual([
      expect.stringContaining('Díaz'),
      expect.stringContaining('Acosta'),
      expect.stringContaining('Zapata'),
    ])
    fireEvent.click(screen.getByRole('button', { name: /Horario/ }))
    expect(employeeNames()[0]).toContain('Zapata')
    fireEvent.click(screen.getByRole('button', { name: /Horario/ }))
    expect(employeeNames()[0]).toContain('Zapata')
    expect(employeeNames()[1]).toContain('Díaz')
  })

  it('ordena por Empleado por apellido', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Empleado/ }))
    expect(employeeNames()[0]).toContain('Acosta')
  })

  it('ordena por Estado por urgencia', () => {
    renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Estado/ }))
    expect(employeeNames()[0]).toContain('Acosta')
  })

  it('Acciones no se ordena', () => {
    renderTable()
    expect(
      screen.queryByRole('button', { name: /Acciones/ }),
    ).not.toBeInTheDocument()
  })

  it('recuerda el orden en el navegador (persistKey)', () => {
    const { unmount } = renderTable()
    fireEvent.click(screen.getByRole('button', { name: /Empleado/ }))
    expect(
      window.localStorage.getItem('datatable:resumen-servicios-hoy'),
    ).toContain('employee')
    unmount()

    renderTable()
    expect(employeeNames()[0]).toContain('Acosta')
  })

  it('tiene asas para redimensionar las columnas', () => {
    renderTable()
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(0)
  })
})

describe('ServicesTodayTable: columna «Supervisión» (D-10, P35)', () => {
  it('muestra la segunda línea solo en los servicios que ya empezaron', () => {
    renderTable([
      makeRow({
        id: 'a1',
        checkInAt: '2026-11-18T09:05:00Z',
        displayStatus: 'present',
        status: 'present',
        supervisionState: 'done',
        supervisorName: 'Sofía Ruiz',
      }),
      makeRow({ id: 'a2', supervisionState: 'none' }),
      makeRow({
        id: 'a3',
        displayStatus: 'no_record',
        supervisionState: 'none',
      }),
    ])
    expect(screen.getByText('Supervisado')).toHaveAttribute(
      'title',
      'Sofía Ruiz',
    )
    expect(screen.getAllByText('Sin supervisar')).toHaveLength(1)
    expect(
      screen.getByRole('columnheader', { name: /Supervisión/ }),
    ).toBeInTheDocument()
  })
})
