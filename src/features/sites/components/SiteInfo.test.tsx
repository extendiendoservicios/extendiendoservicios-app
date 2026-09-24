import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SiteInfo, type SiteInfoData } from './SiteInfo'

const BASE_SITE: SiteInfoData = {
  address: 'Av. Siempre Viva 123',
  city: 'CABA',
  latitude: null,
  longitude: null,
  contactName: null,
  contactPhone: null,
  accessInstructions: null,
  buildingHours: null,
  phoneRestricted: false,
  photosNotAllowed: false,
  restrictionsNotes: null,
}

describe('SiteInfo', () => {
  it('muestra siempre la dirección y el enlace al mapa', () => {
    render(<SiteInfo site={BASE_SITE} />)
    expect(screen.getByText('Av. Siempre Viva 123, CABA')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /abrir en el mapa/i }),
    ).toHaveAttribute('href', expect.stringContaining('google.com/maps'))
  })

  it('sin restricciones ni contacto, no muestra esos bloques', () => {
    render(<SiteInfo site={BASE_SITE} />)
    expect(
      screen.queryByText('Restricciones de la sede'),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Contacto en la sede')).not.toBeInTheDocument()
  })

  it('con restricciones activas, lista cada una', () => {
    render(
      <SiteInfo
        site={{
          ...BASE_SITE,
          phoneRestricted: true,
          photosNotAllowed: true,
          restrictionsNotes: 'No dejar entrar mascotas.',
        }}
      />,
    )
    expect(screen.getByText('Restricciones de la sede')).toBeInTheDocument()
    expect(
      screen.getByText('No usar el teléfono en la sede.'),
    ).toBeInTheDocument()
    expect(screen.getByText('No se permiten fotos.')).toBeInTheDocument()
    expect(screen.getByText('No dejar entrar mascotas.')).toBeInTheDocument()
  })

  it('con contacto cargado, muestra el nombre y el teléfono como enlace tel:', () => {
    render(
      <SiteInfo
        site={{ ...BASE_SITE, contactName: 'Ana', contactPhone: '1122334455' }}
      />,
    )
    expect(screen.getByText('Contacto en la sede')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1122334455' })).toHaveAttribute(
      'href',
      'tel:1122334455',
    )
  })
})
