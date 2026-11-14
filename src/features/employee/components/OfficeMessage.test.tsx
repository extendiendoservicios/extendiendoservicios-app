import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { MyDayAssignment } from '@/api/myDay'
import { OfficeMessage } from './OfficeMessage'
import { ServiceCard } from './ServiceCard'

const LONG = 'Mensaje largo de la oficina. '.repeat(10)

describe('OfficeMessage (P29 OG-05)', () => {
  it('no muestra nada sin texto', () => {
    const { container } = render(<OfficeMessage text={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra el título y el texto respetando los saltos de línea', () => {
    render(<OfficeMessage text={'Uno\nDos'} />)
    expect(screen.getByText('Mensaje de la oficina')).toBeInTheDocument()
    const body = screen.getByText(/Uno/)
    expect(body.className).toContain('whitespace-pre-line')
    expect(body.className).not.toContain('line-clamp-2')
  })

  it('sin clamp no ofrece «Ver más» aunque sea largo', () => {
    render(<OfficeMessage text={LONG} />)
    expect(screen.queryByText('Ver más')).not.toBeInTheDocument()
  })

  it('con clamp y texto corto no ofrece «Ver más»', () => {
    render(<OfficeMessage text="Corto" clamp />)
    expect(screen.queryByText('Ver más')).not.toBeInTheDocument()
  })

  it('con clamp y texto largo recorta a 2 líneas y «Ver más» lo expande', () => {
    render(<OfficeMessage text={LONG} clamp />)
    const body = screen.getByText(/Mensaje largo/)
    expect(body.className).toContain('line-clamp-2')
    fireEvent.click(screen.getByText('Ver más'))
    expect(body.className).not.toContain('line-clamp-2')
    expect(screen.getByText('Ver menos')).toBeInTheDocument()
  })
})

describe('ServiceCard con mensaje de la oficina', () => {
  const base = {
    assignmentId: 'a1',
    clientName: 'Limpia Ya',
    siteName: 'Sede Centro',
    siteAddress: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    noCheckout: false,
    status: 'expected',
    shiftStatus: 'scheduled',
    checkInAt: null,
    checkOutAt: null,
    notes: 'Mi observación',
  } as unknown as MyDayAssignment

  it('muestra el mensaje y no lo confunde con la observación propia', () => {
    render(
      <MemoryRouter>
        <ServiceCard assignment={{ ...base, shiftNotes: 'Llevar llaves' }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Llevar llaves')).toBeInTheDocument()
    expect(screen.queryByText('Mi observación')).not.toBeInTheDocument()
  })

  it('«Ver más» no navega al detalle', () => {
    render(
      <MemoryRouter>
        <ServiceCard assignment={{ ...base, shiftNotes: LONG }} />
      </MemoryRouter>,
    )
    const notPrevented = fireEvent.click(screen.getByText('Ver más'))
    expect(notPrevented).toBe(false)
  })

  it('sin mensaje no hay bloque', () => {
    render(
      <MemoryRouter>
        <ServiceCard assignment={{ ...base, shiftNotes: null }} />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('office-message')).not.toBeInTheDocument()
  })
})
