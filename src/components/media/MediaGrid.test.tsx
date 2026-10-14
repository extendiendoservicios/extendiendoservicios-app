import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MediaGrid, formatDuration } from './MediaGrid'
import type { MediaGridGroup, MediaItem } from './types'

const photo = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  kind: 'photo',
  thumbUrl: `https://s.test/${id}.jpg`,
  label: `Foto ${id}`,
  ...extra,
})

const groups: MediaGridGroup[] = [
  {
    id: 't1',
    title: 'Cliente X · Sede Y',
    subtitle: 'jue 13 ago · 08:00 a 12:00',
    items: [
      photo('a'),
      photo('b', { keep: true }),
      {
        id: 'v',
        kind: 'video',
        thumbUrl: 'https://s.test/v.jpg',
        label: 'Video v',
        durationSeconds: 28,
      },
    ],
  },
  {
    id: 't2',
    title: 'Cliente Z · Sede W',
    items: [photo('c'), photo('d', { unavailable: 'expired', thumbUrl: null })],
  },
]

function Selectable({
  onOpen,
}: {
  onOpen?: (i: MediaItem, n: number) => void
}) {
  const [ids, setIds] = React.useState<string[]>([])
  return (
    <>
      <MediaGrid
        groups={groups}
        selectable
        selectedIds={ids}
        onSelectedIdsChange={setIds}
        onOpen={onOpen}
      />
      <output data-testid="seleccion">{ids.join(',')}</output>
    </>
  )
}

describe('MediaGrid', () => {
  it('muestra los grupos con título y detalle', () => {
    render(<MediaGrid groups={groups} />)
    expect(
      screen.getByRole('heading', { name: 'Cliente X · Sede Y' }),
    ).toBeInTheDocument()
    expect(screen.getByText('jue 13 ago · 08:00 a 12:00')).toBeInTheDocument()
    expect(screen.getAllByRole('list')).toHaveLength(2)
  })

  it('una lista sin agrupar no pone títulos', () => {
    render(<MediaGrid items={[photo('a'), photo('b')]} />)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('tocar una miniatura la abre con su posición en la lista plana', () => {
    const onOpen = vi.fn()
    render(<MediaGrid groups={groups} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Foto c' }))
    expect(onOpen).toHaveBeenCalledWith(groups[1]?.items[0], 3)
  })

  it('los videos llevan la duración y lo conservado, la marca', () => {
    render(<MediaGrid groups={groups} />)
    expect(screen.getByText('0:28')).toBeInTheDocument()
    expect(screen.getByText('Conservada')).toBeInTheDocument()
  })

  it('lo vencido se ve como constancia, sin botón para abrirlo', () => {
    render(<MediaGrid groups={groups} />)
    expect(screen.getByText('Vencida')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Foto d' })).toBeNull()
  })

  it('sin selección no hay casillas', () => {
    render(<MediaGrid groups={groups} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('con selección: casillas por archivo, y no en lo vencido', () => {
    render(<Selectable />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Foto a' }),
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Foto c' }),
    )
    expect(screen.getByTestId('seleccion')).toHaveTextContent('a,c')
    expect(
      screen.getByRole('checkbox', { name: 'Seleccionar Foto a' }),
    ).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Foto a' }),
    )
    expect(screen.getByTestId('seleccion')).toHaveTextContent('c')
  })

  it('tocar la casilla no abre el visor', () => {
    const onOpen = vi.fn()
    render(<Selectable onOpen={onOpen} />)
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Seleccionar Foto a' }),
    )
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('«Seleccionar todo» marca el grupo y después lo desmarca', () => {
    render(<Selectable />)
    const first = screen.getByRole('region', { name: 'Cliente X · Sede Y' })
    fireEvent.click(
      within(first).getByRole('button', { name: 'Seleccionar todo' }),
    )
    expect(screen.getByTestId('seleccion')).toHaveTextContent('a,b,v')
    fireEvent.click(
      within(first).getByRole('button', { name: 'Quitar selección' }),
    )
    expect(screen.getByTestId('seleccion')).toHaveTextContent('')
  })

  it('sin nada muestra el texto vacío', () => {
    render(<MediaGrid items={[]} emptyMessage="Sin fotos en este turno." />)
    expect(screen.getByText('Sin fotos en este turno.')).toBeInTheDocument()
  })
})

describe('formatDuration', () => {
  it('formatea m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(28.4)).toBe('0:28')
    expect(formatDuration(65)).toBe('1:05')
  })
})
