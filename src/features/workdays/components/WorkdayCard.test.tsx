import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { AdminWorkday } from '@/api/workdaysAdmin'
import { WorkdayCard } from './WorkdayCard'

vi.mock('./CorrectWorkdayEventDialog', () => ({
  CorrectWorkdayEventDialog: (props: { event: { id: string } }) => (
    <div role="dialog" aria-label="Corregir">
      corregir:{props.event.id}
    </div>
  ),
}))
vi.mock('./RemoveWorkdayPauseDialog', () => ({
  RemoveWorkdayPauseDialog: (props: { pauseEventId: string }) => (
    <div role="dialog" aria-label="Quitar">
      quitar:{props.pauseEventId}
    </div>
  ),
}))
vi.mock('./AddWorkdayPauseDialog', () => ({
  AddWorkdayPauseDialog: (props: { open: boolean }) =>
    props.open ? <div role="dialog" aria-label="Agregar pausa" /> : null,
}))

function makeWorkday(overrides: Partial<AdminWorkday> = {}): AdminWorkday {
  return {
    id: 'wd1',
    supervisorId: 'sup1',
    supervisorName: 'Ana Pérez',
    workDate: '2026-10-22',
    startedAt: '2026-10-22T11:00:00Z', // 08:00 en Argentina
    endedAt: '2026-10-22T20:55:00Z', // 17:55
    state: 'ended',
    workedMinutes: 515,
    pauseMinutes: 30,
    autoClosed: false,
    autoCloseWarning: false,
    corrected: false,
    pauses: [
      {
        type: 'pause',
        pauseEventId: 'e2',
        resumeEventId: 'e3',
        startsAt: '2026-10-22T15:00:00Z', // 12:00
        endsAt: '2026-10-22T15:30:00Z', // 12:30
        minutes: 30,
        reason: 'Almuerzo',
        corrected: false,
      },
    ],
    supervisions: [
      {
        supervisionId: 'sv1',
        shiftId: 'sh1',
        clientId: 'c1',
        clientName: 'Limpiadora SRL',
        siteId: 'si1',
        siteName: 'Sede Centro',
        status: 'completed',
        checkInAt: '2026-10-22T12:00:00Z',
        checkOutAt: '2026-10-22T13:30:00Z',
        durationMinutes: 90,
        unclosed: false,
      },
    ],
    supervisionsCount: 1,
    events: [
      {
        id: 'e1',
        kind: 'start',
        recordedAt: '2026-10-22T11:00:00Z',
        reason: null,
        supervisionId: null,
        hasPosition: true,
        corrected: false,
        correctedFrom: null,
        correctionReason: null,
        removed: false,
      },
      {
        id: 'e2',
        kind: 'pause',
        recordedAt: '2026-10-22T15:00:00Z',
        reason: 'Almuerzo',
        supervisionId: null,
        hasPosition: false,
        corrected: false,
        correctedFrom: null,
        correctionReason: null,
        removed: false,
      },
      {
        id: 'e4',
        kind: 'supervision_start',
        recordedAt: '2026-10-22T12:00:00Z',
        reason: null,
        supervisionId: 'sv1',
        hasPosition: true,
        corrected: false,
        correctedFrom: null,
        correctionReason: null,
        removed: false,
      },
    ],
    ...overrides,
  }
}

function renderCard(workday: AdminWorkday, canCorrect: boolean) {
  return render(
    <MemoryRouter>
      <WorkdayCard workday={workday} canCorrect={canCorrect} />
    </MemoryRouter>,
  )
}

describe('WorkdayCard', () => {
  it('muestra inicio, fin, horas netas, pausas y la supervisión con su duración informativa', () => {
    renderCard(makeWorkday(), true)
    expect(screen.getByText('8 h 35 min')).toBeVisible()
    expect(screen.getByText(/12:00 a 12:30 · 30 min · Almuerzo/)).toBeVisible()
    expect(screen.getByText('Limpiadora SRL · Sede Centro')).toBeVisible()
    expect(screen.getByText(/1 h 30 min, informativa/)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('una pausa de menos de un minuto figura como «menos de 1 min» y no como 0 min', () => {
    renderCard(
      makeWorkday({
        pauseMinutes: 1,
        pauses: [
          {
            type: 'pause',
            pauseEventId: 'e2',
            resumeEventId: 'e3',
            startsAt: '2026-10-22T23:33:00Z',
            endsAt: '2026-10-22T23:33:20Z',
            minutes: 0,
            reason: null,
            corrected: false,
          },
        ],
      }),
      true,
    )
    expect(screen.getByText(/20:33 a 20:33 · menos de 1 min/)).toBeVisible()
    expect(screen.getByText('1 min')).toBeVisible()
  })

  it('muestra «Cerrada automáticamente» mientras no se corrija (CJ-31)', () => {
    renderCard(makeWorkday({ autoClosed: true, autoCloseWarning: true }), true)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Cerrada automáticamente',
    )
  })

  it('al corregirse, la advertencia desaparece y queda la marca «Corregida» con el historial', () => {
    renderCard(
      makeWorkday({
        autoClosed: true,
        autoCloseWarning: false,
        corrected: true,
        events: [
          {
            id: 'e5',
            kind: 'end',
            recordedAt: '2026-10-22T20:55:00Z',
            reason: null,
            supervisionId: null,
            hasPosition: false,
            corrected: true,
            correctedFrom: '2026-10-23T02:55:00Z',
            correctionReason: 'Terminó a las 17:55 y no finalizó',
            removed: false,
          },
        ],
      }),
      true,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Corregida')).toBeVisible()
    expect(
      screen.getByText(/Motivo: Terminó a las 17:55 y no finalizó/),
    ).toBeVisible()
  })

  it('marca la supervisión «Sin cerrar»', () => {
    renderCard(
      makeWorkday({
        supervisions: [
          {
            ...makeWorkday().supervisions[0]!,
            status: 'in_progress',
            unclosed: true,
          },
        ],
      }),
      false,
    )
    expect(screen.getByText('Sin cerrar')).toBeVisible()
  })

  it('sin manage_attendance no ofrece ninguna corrección', () => {
    renderCard(makeWorkday(), false)
    expect(screen.queryByRole('button', { name: /Corregir hora/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Quitar la pausa/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Agregar pausa' })).toBeNull()
  })

  it('con permiso corrige eventos de la jornada pero no los de supervisión', () => {
    renderCard(makeWorkday(), true)
    // inicio y pausa tienen botón; el inicio de la supervisión no.
    expect(
      screen.getAllByRole('button', { name: /Corregir hora/ }),
    ).toHaveLength(2)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Corregir hora: inicio de la jornada de las 08:00',
      }),
    )
    expect(screen.getByRole('dialog', { name: 'Corregir' })).toHaveTextContent(
      'corregir:e1',
    )
  })

  it('«Quitar pausa» abre la baja de esa pausa y «Agregar pausa» su diálogo', () => {
    renderCard(makeWorkday(), true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Quitar la pausa de las 12:00' }),
    )
    expect(screen.getByRole('dialog', { name: 'Quitar' })).toHaveTextContent(
      'quitar:e2',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Agregar pausa' }))
    expect(
      screen.getByRole('dialog', { name: 'Agregar pausa' }),
    ).toBeInTheDocument()
  })

  it('en la lista de supervisiones enlaza al detalle de cada una', () => {
    renderCard(makeWorkday(), false)
    const link = screen.getByRole('link', {
      name: 'Limpiadora SRL · Sede Centro',
    })
    expect(link).toHaveAttribute('href', '/admin/supervisiones/sv1')
    expect(within(link.closest('li')!).getByText('Completada')).toBeVisible()
  })
})
