import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { UncoveredPanel } from './UncoveredPanel'

function renderPanel() {
  return render(
    <UncoveredPanel
      uncovered={[]}
      days={[]}
      personName="Ana"
      busy={false}
      gridRef={{ current: null }}
      onDrag={() => undefined}
      onAssign={() => undefined}
    />,
  )
}

describe('UncoveredPanel: plegado (DEF-P30-03)', () => {
  beforeEach(() => window.localStorage.clear())

  it('en pantallas anchas se oculta y se recuerda en el navegador', () => {
    const first = renderPanel()
    const body = document.getElementById('panel-sin-cubrir') as HTMLElement
    expect(body).toHaveClass('xl:block')
    const buttons = screen.getAllByRole('button', { name: 'Ocultar' })
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement)
    expect(body).toHaveClass('xl:hidden')
    expect(window.localStorage.getItem('es.sinCubrir.oculto')).toBe('1')
    first.unmount()
    renderPanel()
    expect(document.getElementById('panel-sin-cubrir')).toHaveClass('xl:hidden')
  })

  it('por debajo de 1280 px arranca plegado y se abre con «Mostrar»', () => {
    renderPanel()
    const body = document.getElementById('panel-sin-cubrir') as HTMLElement
    expect(body).toHaveClass('hidden')
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Mostrar' })[0] as HTMLElement,
    )
    expect(body).toHaveClass('block')
  })
})
