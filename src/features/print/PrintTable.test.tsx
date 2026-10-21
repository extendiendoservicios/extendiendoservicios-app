import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PrintTable, type PrintColumn } from './PrintTable'

const columns: PrintColumn[] = [
  { key: 'date', header: 'Fecha' },
  { key: 'client', header: 'Cliente', wrap: true },
  { key: 'site', header: 'Sede', wrap: true },
  { key: 'hours', header: 'Horas', align: 'right' },
]

describe('PrintTable: columnas cortas y largas', () => {
  it('las columnas cortas no se parten y las largas parten por palabras', () => {
    render(
      <PrintTable
        columns={columns}
        rows={[
          {
            key: 'a',
            date: '21 sep 2026',
            client: 'Cliente con nombre largo',
            site: 'Sede',
            hours: '48 h 13 min',
          },
        ]}
        footer={{ label: 'Total', value: '48 h 13 min' }}
        emptyText="Vacío"
      />,
    )
    for (const text of ['21 sep 2026', 'Fecha', 'Horas']) {
      expect(screen.getByText(text)).toHaveClass('whitespace-nowrap')
    }
    // Fila de datos y total: «48 h 13 min» aparece dos veces, ambas sin partir.
    for (const cell of screen.getAllByText('48 h 13 min')) {
      expect(cell).toHaveClass('whitespace-nowrap')
    }
    const long = screen.getByText('Cliente con nombre largo')
    expect(long).toHaveClass('[overflow-wrap:break-word]')
    expect(long).not.toHaveClass('whitespace-nowrap')
    expect(long.className).not.toContain('anywhere')
  })

  it('une celdas de una fila con colSpan, desde la columna inicial hasta la final', () => {
    render(
      <PrintTable
        columns={columns}
        rows={[
          {
            key: 'l',
            date: '17 oct 2026',
            client:
              'Licencia del 17/10/2026 al 21/10/2026 — Controles de Salud',
            site: '',
            hours: '—',
          },
        ]}
        spans={{ l: { from: 'client', to: 'site' } }}
        emptyText="Vacío"
      />,
    )
    const merged = screen.getByText(/Licencia del 17\/10\/2026/)
    expect(merged).toHaveAttribute('colspan', '2')
    expect(merged.closest('tr')?.querySelectorAll('td')).toHaveLength(3)
  })
})
