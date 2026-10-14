import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MediaViewer, type MediaViewerProps } from './MediaViewer'
import type { MediaItem } from './types'

const photo = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  kind: 'photo',
  thumbUrl: `https://s.test/${id}_thumb.jpg`,
  url: `https://s.test/${id}.jpg`,
  label: `Foto ${id}`,
  authorName: 'Ana Pérez',
  // 11:00 UTC = 08:00 en Buenos Aires
  takenAt: '2026-10-13T11:00:00Z',
  expiresOn: '2026-12-12',
  ...extra,
})

const video = (id: string): MediaItem => ({
  id,
  kind: 'video',
  thumbUrl: `https://s.test/${id}_thumb.jpg`,
  url: `https://s.test/${id}.mp4`,
  label: `Video ${id}`,
  authorName: 'Luis Gómez',
  takenAt: '2026-10-13T12:30:00Z',
  expiresOn: '2026-11-12',
})

/** Contenedor con estado, como lo usaría una pantalla. */
function Harness(
  props: Partial<MediaViewerProps> & { items: MediaItem[]; start?: number },
) {
  const { items, start = 0, ...rest } = props
  const [index, setIndex] = React.useState(start)
  return (
    <MediaViewer
      open
      onOpenChange={vi.fn()}
      items={items}
      index={index}
      onIndexChange={setIndex}
      {...rest}
    />
  )
}

describe('MediaViewer: datos', () => {
  it('muestra autor, hora en Buenos Aires, vencimiento y posición', () => {
    render(<Harness items={[photo('a'), photo('b')]} />)
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByText(/08:00/)).toBeInTheDocument()
    expect(screen.getByText(/Vence el 12 dic 2026/)).toBeInTheDocument()
    expect(screen.getByText('1 de 2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Foto a' })).toHaveAttribute(
      'src',
      'https://s.test/a.jpg',
    )
  })

  it('lo conservado dice que no vence', () => {
    render(<Harness items={[photo('a', { keep: true })]} />)
    expect(screen.getByText(/Conservada: no vence/)).toBeInTheDocument()
    expect(screen.queryByText(/Vence el/)).toBeNull()
  })

  it('un video se muestra con controles y la miniatura de portada', () => {
    const { container } = render(<Harness items={[video('v')]} />)
    const element = container.ownerDocument.querySelector('video')
    expect(element).not.toBeNull()
    expect(element).toHaveAttribute('controls')
    expect(element).toHaveAttribute('src', 'https://s.test/v.mp4')
    expect(element).toHaveAttribute('poster', 'https://s.test/v_thumb.jpg')
    expect(screen.getByText('Luis Gómez')).toBeInTheDocument()
  })

  it('un archivo vencido explica que queda la constancia', () => {
    render(
      <Harness
        items={[photo('a', { url: null, unavailable: 'expired' })]}
        onDownload={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/ya venció y se borró\. Queda la constancia del turno/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled()
  })

  it('pide la URL firmada recién al llegar al archivo', async () => {
    const resolveUrl = vi.fn(() =>
      Promise.resolve('https://s.test/firmada.jpg'),
    )
    render(
      <Harness items={[photo('a', { url: null })]} resolveUrl={resolveUrl} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…')
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Foto a' })).toHaveAttribute(
        'src',
        'https://s.test/firmada.jpg',
      ),
    )
    expect(resolveUrl).toHaveBeenCalledTimes(1)
  })
})

describe('MediaViewer: navegación', () => {
  it('los botones y las flechas del teclado cambian de archivo', () => {
    render(<Harness items={[photo('a'), photo('b'), photo('c')]} />)
    expect(screen.queryByRole('button', { name: 'Anterior' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByText('2 de 3')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' })
    expect(screen.getByText('3 de 3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' })
    expect(screen.getByText('2 de 3')).toBeInTheDocument()
  })

  it('deslizar a la izquierda avanza y a la derecha vuelve', () => {
    render(<Harness items={[photo('a'), photo('b')]} />)
    const image = screen.getByRole('img', { name: 'Foto a' })
    fireEvent.pointerDown(image, { clientX: 300, clientY: 200 })
    fireEvent.pointerUp(image, { clientX: 150, clientY: 210 })
    expect(screen.getByText('2 de 2')).toBeInTheDocument()

    const next = screen.getByRole('img', { name: 'Foto b' })
    fireEvent.pointerDown(next, { clientX: 100, clientY: 200 })
    fireEvent.pointerUp(next, { clientX: 260, clientY: 190 })
    expect(screen.getByText('1 de 2')).toBeInTheDocument()
  })

  it('un toque corto o un gesto vertical no cambian de archivo', () => {
    render(<Harness items={[photo('a'), photo('b')]} />)
    const image = screen.getByRole('img', { name: 'Foto a' })
    fireEvent.pointerDown(image, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(image, { clientX: 110, clientY: 100 })
    fireEvent.pointerDown(image, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(image, { clientX: 20, clientY: 300 })
    expect(screen.getByText('1 de 2')).toBeInTheDocument()
  })
})

describe('MediaViewer: acciones opcionales', () => {
  it('sin handlers no aparece ningún botón de acción', () => {
    render(<Harness items={[photo('a')]} />)
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Conservar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull()
  })

  it('«Quitar», «Conservar» y «Descargar» llaman a sus handlers con el archivo', () => {
    const onRemove = vi.fn()
    const onToggleKeep = vi.fn()
    const onDownload = vi.fn()
    const item = photo('a')
    render(
      <Harness
        items={[item]}
        onRemove={onRemove}
        onToggleKeep={onToggleKeep}
        onDownload={onDownload}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Quitar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Conservar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    expect(onRemove).toHaveBeenCalledWith(item)
    expect(onToggleKeep).toHaveBeenCalledWith(item, true)
    expect(onDownload).toHaveBeenCalledWith(item)
  })

  it('si ya está conservada, el botón ofrece dejar de conservar', () => {
    const onToggleKeep = vi.fn()
    const item = photo('a', { keep: true })
    render(<Harness items={[item]} onToggleKeep={onToggleKeep} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de conservar' }))
    expect(onToggleKeep).toHaveBeenCalledWith(item, false)
  })

  it('canRemove=false oculta «Quitar» solo en ese archivo', () => {
    render(
      <Harness
        items={[photo('a', { canRemove: false }), photo('b')]}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument()
  })

  it('busy apaga las acciones', () => {
    render(
      <Harness
        items={[photo('a')]}
        busy
        onRemove={vi.fn()}
        onDownload={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeDisabled()
  })
})

describe('MediaViewer: cierre', () => {
  it('«Cerrar el visor» y Escape avisan con onOpenChange(false)', () => {
    const onOpenChange = vi.fn()
    render(<Harness items={[photo('a')]} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el visor' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)

    onOpenChange.mockClear()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('si se quita el último archivo, se cierra solo', () => {
    const onOpenChange = vi.fn()
    render(<Harness items={[]} onOpenChange={onOpenChange} />)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('MediaViewer: datos de administración', () => {
  it('con details muestra rol, lugar, turno, cuándo y archivo', () => {
    render(
      <Harness
        items={[
          photo('a', {
            details: {
              place: 'Limpia Ya · Sede Centro',
              shiftLabel: 'Turno del mar 13 oct, 13:45 a 17:45',
              authorRole: 'Empleado/a',
              uploadedAt: '2026-10-13T21:14:00Z',
              sizeBytes: 170000,
            },
          }),
        ]}
      />,
    )
    expect(screen.getByText('Ana Pérez · Empleado/a')).toBeInTheDocument()
    expect(screen.getByText('Limpia Ya · Sede Centro')).toBeInTheDocument()
    expect(
      screen.getByText('Turno del mar 13 oct, 13:45 a 17:45'),
    ).toBeInTheDocument()
    expect(screen.getByText('Subida mar 13 oct, 18:14')).toBeInTheDocument()
    expect(
      screen.getByText('Foto · 166 KB · Vence el 12 dic 2026'),
    ).toBeInTheDocument()
  })
})
