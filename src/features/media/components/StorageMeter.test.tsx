import { MemoryRouter } from 'react-router'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageUsage } from '@/api/mediaAdmin'

const { usageMock } = vi.hoisted(() => ({ usageMock: vi.fn() }))

vi.mock('@/features/media/queries', () => ({
  useStorageUsageQuery: usageMock,
}))

const { StorageMeter } = await import('./StorageMeter')
const { StorageAlert } = await import('./StorageAlert')

function usage(overrides: Partial<StorageUsage> = {}): StorageUsage {
  return {
    totalBytes: 412 * 1024 * 1024,
    limitBytes: 1073741824,
    percent: 40.2,
    level: 'ok',
    buckets: [
      { bucket: 'avatars', bytes: 5 * 1024 * 1024, objects: 10 },
      { bucket: 'evidence', bytes: 400 * 1024 * 1024, objects: 2000 },
    ],
    ...overrides,
  }
}

describe('StorageMeter', () => {
  it('muestra el total sobre el tope y el desglose por bucket, del más grande al más chico', () => {
    render(<StorageMeter usage={usage()} />)
    expect(screen.getByText('412 MB')).toBeInTheDocument()
    expect(screen.getByText(/de 1,0 GB · 40,2 %/)).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Fotos y videos de los turnos')
    expect(items[0]).toHaveTextContent('400 MB')
    expect(items[1]).toHaveTextContent('Fotos de perfil')
  })

  it('en verde/azul (normal) no da ningún aviso', () => {
    render(<StorageMeter usage={usage()} />)
    expect(screen.getByText('Espacio de sobra')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '40',
    )
    expect(screen.queryByText(/plan pago/)).not.toBeInTheDocument()
  })

  it('amarillo desde el 70 %: lo dice con palabras y con el color de aviso', () => {
    const { container } = render(
      <StorageMeter usage={usage({ percent: 72, level: 'warning' })} />,
    )
    expect(screen.getByText('Se está llenando')).toBeInTheDocument()
    expect(screen.getByText(/plan pago/)).toBeInTheDocument()
    expect(container.querySelector('.bg-warning')).not.toBeNull()
  })

  it('rojo desde el 90 %: lo dice con palabras y con el color de peligro', () => {
    const { container } = render(
      <StorageMeter usage={usage({ percent: 93, level: 'critical' })} />,
    )
    expect(screen.getByText('Casi lleno')).toBeInTheDocument()
    expect(screen.getByText(/Hay que decidir ya/)).toBeInTheDocument()
    expect(container.querySelector('.bg-danger')).not.toBeNull()
  })

  it('la barra nunca pasa del 100 %', () => {
    render(<StorageMeter usage={usage({ percent: 130, level: 'critical' })} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })
})

describe('StorageAlert (ADM-02)', () => {
  beforeEach(() => usageMock.mockReset())

  function renderAlert() {
    return render(
      <MemoryRouter>
        <StorageAlert />
      </MemoryRouter>,
    )
  }

  it('no muestra nada con el espacio en nivel normal', () => {
    usageMock.mockReturnValue({ data: usage() })
    const { container } = renderAlert()
    expect(container).toBeEmptyDOMElement()
  })

  it('no muestra nada mientras carga o si falla la consulta', () => {
    usageMock.mockReturnValue({ data: undefined })
    const { container } = renderAlert()
    expect(container).toBeEmptyDOMElement()
  })

  it('avisa desde el 70 % y enlaza a Fotos y videos', () => {
    usageMock.mockReturnValue({
      data: usage({ percent: 71.5, level: 'warning' }),
    })
    renderAlert()
    expect(
      screen.getByText(/se está llenando: 71,5 % usado/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Ver fotos y videos' }),
    ).toHaveAttribute('href', '/admin/fotos')
  })

  it('con más del 90 % el aviso es de peligro', () => {
    usageMock.mockReturnValue({
      data: usage({ percent: 95, level: 'critical' }),
    })
    renderAlert()
    expect(screen.getByText(/casi lleno: 95 % usado/)).toBeInTheDocument()
  })
})
