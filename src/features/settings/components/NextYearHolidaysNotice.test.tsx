import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextYearHolidaysNotice } from './NextYearHolidaysNotice'

const { holidaysQueryMock, loadMutateMock } = vi.hoisted(() => ({
  holidaysQueryMock: vi.fn(),
  loadMutateMock: vi.fn(),
}))

vi.mock('@/features/settings/queries', () => ({
  useHolidaysQuery: holidaysQueryMock,
  useLoadNationalHolidaysMutation: () => ({
    mutateAsync: loadMutateMock,
    isPending: false,
  }),
}))

beforeEach(() => {
  holidaysQueryMock.mockReset()
  loadMutateMock.mockReset().mockResolvedValue({
    created: 12,
    reactivated: 0,
    skipped: 0,
  })
})

describe('NextYearHolidaysNotice (AJ2-13)', () => {
  it('desde octubre y sin feriados del año siguiente muestra el aviso y carga los nacionales', async () => {
    holidaysQueryMock.mockReturnValue({ data: [] })
    render(
      <NextYearHolidaysNotice
        userId="owner-1"
        selectedYear={2026}
        today="2026-10-09"
      />,
    )

    expect(holidaysQueryMock).toHaveBeenCalledWith(2027)
    expect(
      screen.getByText(/2027 todavía no tiene feriados cargados/),
    ).toBeInTheDocument()
    expect(screen.getByText(/se agregan a mano/)).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Cargar feriados nacionales de 2027',
      }),
    )
    await waitFor(() =>
      expect(loadMutateMock).toHaveBeenCalledWith({ createdBy: 'owner-1' }),
    )
  })

  it('antes de octubre no muestra nada', () => {
    holidaysQueryMock.mockReturnValue({ data: [] })
    const { container } = render(
      <NextYearHolidaysNotice
        userId="owner-1"
        selectedYear={2026}
        today="2026-09-30"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('si el año siguiente ya tiene feriados activos no muestra nada', () => {
    holidaysQueryMock.mockReturnValue({
      data: [
        {
          id: 'h1',
          holidayDate: '2027-01-01',
          name: 'Año Nuevo',
          deletedAt: null,
        },
      ],
    })
    const { container } = render(
      <NextYearHolidaysNotice
        userId="owner-1"
        selectedYear={2026}
        today="2026-10-09"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('los feriados dados de baja no cuentan como cargados', () => {
    holidaysQueryMock.mockReturnValue({
      data: [
        {
          id: 'h1',
          holidayDate: '2027-01-01',
          name: 'Año Nuevo',
          deletedAt: '2026-10-01T00:00:00Z',
        },
      ],
    })
    render(
      <NextYearHolidaysNotice
        userId="owner-1"
        selectedYear={2026}
        today="2026-10-09"
      />,
    )
    expect(screen.getByText(/todavía no tiene feriados/)).toBeInTheDocument()
  })

  it('si ya se está mirando el año siguiente no duplica el botón', () => {
    holidaysQueryMock.mockReturnValue({ data: [] })
    const { container } = render(
      <NextYearHolidaysNotice
        userId="owner-1"
        selectedYear={2027}
        today="2026-10-09"
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
