import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BankDetailsCard } from './BankDetailsCard'
import { BankDetailsFields } from './BankDetailsFields'
import type { BankFormValues } from '@/features/bank/schemas'

function Harness({ errors = {} }: { errors?: Record<string, string> }) {
  const [values, setValues] = useState<BankFormValues>({
    bankName: '',
    cbu: '',
    alias: '',
  })
  return (
    <>
      <BankDetailsFields
        id="t"
        values={values}
        errors={errors}
        onChange={(field, value) =>
          setValues((previous) => ({ ...previous, [field]: value }))
        }
      />
      <output data-testid="cbu">{values.cbu}</output>
    </>
  )
}

describe('BankDetailsFields (AJ2-04)', () => {
  it('agrupa el CBU mientras se escribe e ignora lo que no son dígitos', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('CBU'), {
      target: { value: '0170-0992 20000067797370999' },
    })
    expect(screen.getByTestId('cbu')).toHaveTextContent(
      '01700992 20000067797370',
    )
  })

  it('muestra el error de cada campo', () => {
    render(
      <Harness
        errors={{ cbu: 'El CBU tiene que tener exactamente 22 dígitos.' }}
      />,
    )
    expect(
      screen.getByText('El CBU tiene que tener exactamente 22 dígitos.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('CBU')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('BankDetailsCard (AJ2-04)', () => {
  it('muestra banco, CBU agrupado y alias', () => {
    render(
      <BankDetailsCard
        details={{
          bankName: 'Banco Nación',
          cbu: '0170099220000067797370',
          alias: 'mi.alias',
        }}
      />,
    )
    expect(screen.getByText('Datos bancarios')).toBeInTheDocument()
    expect(screen.getByText('Banco Nación')).toBeInTheDocument()
    expect(screen.getByText('01700992 20000067797370')).toBeInTheDocument()
    expect(screen.getByText('mi.alias')).toBeInTheDocument()
  })

  it('sin datos dice «Sin datos bancarios cargados.»', () => {
    render(<BankDetailsCard details={null} />)
    expect(
      screen.getByText('Sin datos bancarios cargados.'),
    ).toBeInTheDocument()
  })
})
