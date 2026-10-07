import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { at, makeAssignment } from '@/features/dashboard/fixtures'
import { buildAttendanceEntries } from '@/features/attendance/detailSheet'
import { AttendanceDetailSheet } from './AttendanceDetailSheet'

vi.mock('@/features/settings/queries', () => ({
  useCompanySettingsQuery: () => ({
    data: {
      name: 'Extendiendo Servicios',
      logoPath: 'logo.png',
      supportPhone: '11 5555-0000',
    },
  }),
}))

vi.mock('@/features/auth/useBranding', () => ({
  brandingLogoUrl: (path: string) => `https://example.test/branding/${path}`,
}))

afterEach(() => {
  vi.restoreAllMocks()
})

const entries = buildAttendanceEntries(
  [
    makeAssignment({
      id: 'a1',
      shiftDate: '2026-09-28',
      clientName: 'Logística Central',
      siteName: 'Munro',
      checkInAt: at('08:01'),
      checkOutAt: at('12:00'),
      workedMinutes: 239,
    }),
  ],
  [],
)

function renderSheet(onClose = vi.fn()) {
  render(
    <AttendanceDetailSheet
      person={{
        name: 'Carlos Medina',
        employeeNumber: 19,
        roleLabels: ['Empleado'],
        signerLabel: 'Empleado',
      }}
      from="2026-09-01"
      to="2026-09-30"
      entries={entries}
      issuedAt={new Date('2026-10-08T17:05:00Z')}
      onClose={onClose}
    />,
  )
  return onClose
}

describe('AttendanceDetailSheet (AJ-06)', () => {
  it('muestra membrete, datos de la persona, tabla, total y los dos espacios de firma', () => {
    renderSheet()

    expect(
      screen.getByRole('heading', { name: 'Detalle de asistencia' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Extendiendo Servicios')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Logo de/ })).toHaveAttribute(
      'src',
      'https://example.test/branding/logo.png',
    )
    expect(
      screen.getByText(/Emitido el 8 de octubre de 2026, 14:05/),
    ).toBeInTheDocument()
    expect(screen.getByText('Carlos Medina')).toBeInTheDocument()
    expect(screen.getByText('Logística Central')).toBeInTheDocument()
    expect(screen.getAllByText('3 h 59 min').length).toBe(2) // fila y total
    expect(screen.getByText('Total del período')).toBeInTheDocument()
    expect(screen.getByText('Responsable (administración)')).toBeInTheDocument()
    expect(screen.getByText('Empleado', { selector: 'p' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Las partes prestan conformidad con el detalle de horas consignado.',
      ),
    ).toBeInTheDocument()
  })

  it('imprime con window.print() y cierra con el botón o con Escape', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const onClose = renderSheet()

    fireEvent.click(
      screen.getByRole('button', { name: /Imprimir o guardar como PDF/ }),
    )
    expect(print).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
