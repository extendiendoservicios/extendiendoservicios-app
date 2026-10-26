import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { makeStatusRow } from '@/features/geo/coordinatorFixtures'
import { summarizeCoordinatorWorkdays } from '../coordinatorWorkdays'
import { SupervisionsTodayBlock } from './SupervisionsTodayBlock'

const rows = [
  makeStatusRow({
    supervisorId: 'a',
    firstName: 'Ana',
    lastName: 'Gómez',
    status: 'supervising',
    clientName: 'Logística Central',
    siteName: 'Munro',
    workedMinutes: 125,
  }),
  makeStatusRow({
    supervisorId: 'b',
    firstName: 'Beto',
    lastName: 'Paz',
    status: 'paused',
    pauseReason: 'Almuerzo',
  }),
  makeStatusRow({
    supervisorId: 'c',
    firstName: 'Carla',
    lastName: 'Luna',
    status: 'finished',
    endedAt: '2026-10-23T02:55:00Z',
    autoClosed: true,
    workedMinutes: 840,
  }),
  makeStatusRow({
    supervisorId: 'd',
    firstName: 'Dora',
    lastName: 'Sosa',
    status: 'finished',
    workedMinutes: 300,
  }),
  makeStatusRow({
    supervisorId: 'e',
    firstName: 'Eli',
    lastName: 'Vega',
    status: 'not_started',
    startedAt: null,
    workdayId: null,
  }),
]

describe('summarizeCoordinatorWorkdays (DASH-007, P24.4)', () => {
  it('separa las jornadas abiertas de las cerradas automáticamente; el resto no entra', () => {
    const summary = summarizeCoordinatorWorkdays(rows)
    expect(summary.open.map((row) => row.supervisorId).sort()).toEqual([
      'a',
      'b',
    ])
    expect(summary.autoClosed.map((row) => row.supervisorId)).toEqual(['c'])
  })
})

describe('SupervisionsTodayBlock (DASH-007, P24.4)', () => {
  function renderBlock(data = rows, isLoading = false) {
    render(
      <MemoryRouter>
        <SupervisionsTodayBlock rows={data} isLoading={isLoading} />
      </MemoryRouter>,
    )
  }

  it('lista las jornadas abiertas y las cerradas automáticamente, con enlace a la ficha', () => {
    renderBlock()

    expect(screen.getByText('Jornadas abiertas: 2')).toBeInTheDocument()
    expect(screen.getByText('Cerradas automáticamente: 1')).toBeInTheDocument()
    const ana = screen.getByRole('link', { name: /Sofía|Ana/ })
    expect(ana).toHaveAttribute('href', '/admin/empleados/a?pestana=jornadas')
    expect(
      screen.getByText(/Supervisando: Logística Central · Munro/),
    ).toBeInTheDocument()
    expect(screen.getByText(/En pausa: Almuerzo/)).toBeInTheDocument()
    // Cerrada sola y sin corregir: lleva la advertencia.
    const carla = screen.getByText('Carla Luna').closest('li')
    expect(carla).not.toBeNull()
    expect(
      within(carla as HTMLElement).getByText('Cerrada automáticamente'),
    ).toBeInTheDocument()
    // Quien terminó normalmente y quien no empezó no figuran.
    expect(screen.queryByText('Dora Sosa')).not.toBeInTheDocument()
    expect(screen.queryByText('Eli Vega')).not.toBeInTheDocument()
  })

  it('no hay «asignadas» ni «no realizadas»', () => {
    renderBlock()
    expect(screen.queryByText(/asignada/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/no realizada/i)).not.toBeInTheDocument()
  })

  it('sin jornadas abiertas lo dice, y no muestra el grupo de cerradas', () => {
    renderBlock([rows[3] as (typeof rows)[number]])
    expect(
      screen.getByText('No hay coordinadores con la jornada abierta.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Cerradas automáticamente:/)).toBeNull()
  })

  it('mientras carga muestra «Cargando…»', () => {
    renderBlock([], true)
    expect(screen.getByText('Cargando…')).toBeInTheDocument()
  })
})
