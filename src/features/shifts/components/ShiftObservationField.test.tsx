import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShiftObservationField } from './ShiftObservationField'

function Harness({ initial = true }: { initial?: boolean }) {
  const [showInPrint, setShowInPrint] = useState(initial)
  return (
    <>
      <ShiftObservationField
        id="t"
        textareaProps={{}}
        showInPrint={showInPrint}
        onShowInPrintChange={setShowInPrint}
      />
      <output data-testid="valor">{String(showInPrint)}</output>
    </>
  )
}

describe('ShiftObservationField (AJ2-15)', () => {
  it('OG-05: la etiqueta avisa que la ven los empleados y hay una ayuda', () => {
    render(<Harness />)
    expect(
      screen.getByLabelText('Observación (la ven los empleados asignados)'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Sirve para mandarles un recado. Si la cambiás, les aparece como novedad.',
      ),
    ).toBeInTheDocument()
  })

  it('muestra la observación y la casilla «Mostrar en la impresión» tildada', () => {
    render(<Harness />)
    expect(screen.getByLabelText(/^Observación/)).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', { name: 'Mostrar en la impresión' }),
    ).toBeChecked()
  })

  it('al destildar avisa el cambio', () => {
    render(<Harness />)
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Mostrar en la impresión' }),
    )
    expect(screen.getByTestId('valor')).toHaveTextContent('false')
  })
})
