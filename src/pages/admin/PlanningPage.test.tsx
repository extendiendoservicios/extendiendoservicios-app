import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

/** OD-26: «Generar turnos del mes» y «Nuevo turno» están en las tres vistas. */

const { auth } = vi.hoisted(() => ({
  auth: { roles: ['owner'] as string[], capabilities: [] as string[] },
}))

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => auth }))
vi.mock('@/features/employees/employeeLeaveStatus', () => ({
  todayInBuenosAires: () => '2026-10-20',
}))
vi.mock('@/features/planning/components/MonthCalendar', () => ({
  MonthCalendar: () => <p>mes</p>,
}))
vi.mock('@/features/planning/components/WeekGrid', () => ({
  WeekGrid: () => <p>semana</p>,
}))
vi.mock('@/features/shifts/components/ShiftsDayList', () => ({
  ShiftsDayList: () => <p>dia</p>,
}))

const { default: PlanningPage } = await import('./PlanningPage')

function renderPage(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PlanningPage />
    </MemoryRouter>,
  )
}

describe('PlanningPage: acciones comunes (OD-26)', () => {
  it.each([
    ['/admin/planificacion', 'mes'],
    ['/admin/planificacion?vista=semana', 'semana'],
    ['/admin/planificacion?vista=dia&fecha=2026-10-21', 'dia'],
  ])('en %s muestra las dos acciones', (url, text) => {
    renderPage(url)
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Generar turnos del mes' }),
    ).toHaveAttribute('href', '/admin/turnos/generar')
    expect(
      screen.getByRole('link', { name: 'Nuevo turno' }),
    ).toBeInTheDocument()
  })

  it('en la vista de día «Nuevo turno» lleva la fecha', () => {
    renderPage('/admin/planificacion?vista=dia&fecha=2026-10-21')
    expect(screen.getByRole('link', { name: 'Nuevo turno' })).toHaveAttribute(
      'href',
      '/admin/turnos/nuevo?fecha=2026-10-21',
    )
  })

  it('en celular el texto queda solo para lectores de pantalla', () => {
    renderPage('/admin/planificacion')
    const label = screen.getByText('Nuevo turno')
    expect(label.className).toContain('max-sm:sr-only')
    expect(screen.getByTestId('planning-actions').className).toContain(
      'max-w-full',
    )
  })

  it('sin permiso no muestra las acciones', () => {
    auth.roles = ['employee']
    renderPage('/admin/planificacion')
    expect(screen.queryByRole('link', { name: 'Nuevo turno' })).toBeNull()
    expect(
      screen.queryByRole('link', { name: 'Generar turnos del mes' }),
    ).toBeNull()
    auth.roles = ['owner']
  })
})
