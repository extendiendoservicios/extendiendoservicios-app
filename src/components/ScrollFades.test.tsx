import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

describe('TabsList · degradés y centrado (RESP-003)', () => {
  it('monta los dos degradés ocultos cuando las pestañas entran', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Uno</TabsTrigger>
          <TabsTrigger value="b">Dos</TabsTrigger>
        </TabsList>
      </Tabs>,
    )

    const start = container.querySelector('[data-slot="scroll-fade-start"]')
    const end = container.querySelector('[data-slot="scroll-fade-end"]')
    expect(start).toHaveClass('opacity-0')
    expect(end).toHaveClass('opacity-0')
    expect(start).toHaveAttribute('aria-hidden', 'true')
  })

  it('muestra el degradé derecho cuando hay contenido oculto a la derecha', () => {
    const originalScrollWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollWidth',
    )
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth',
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get: () => 600,
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 300,
    })
    try {
      const { container } = render(
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Uno</TabsTrigger>
          </TabsList>
        </Tabs>,
      )
      expect(
        container.querySelector('[data-slot="scroll-fade-end"]'),
      ).toHaveClass('opacity-100')
      expect(
        container.querySelector('[data-slot="scroll-fade-start"]'),
      ).toHaveClass('opacity-0')
    } finally {
      if (originalScrollWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          'scrollWidth',
          originalScrollWidth,
        )
      }
      if (originalClientWidth) {
        Object.defineProperty(
          HTMLElement.prototype,
          'clientWidth',
          originalClientWidth,
        )
      }
    }
  })
})
