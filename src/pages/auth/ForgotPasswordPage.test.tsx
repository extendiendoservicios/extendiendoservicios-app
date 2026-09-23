import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPasswordPage from './ForgotPasswordPage'

/**
 * COM-02 (AUTH-005): el punto central es que el mensaje final es el MISMO
 * exista o no exista la cuenta (`05` sección 3, fila COM-02) — comprobado
 * contra `App_dev` que `resetPasswordForEmail` ya no distingue del lado del
 * servidor (ver el comentario de cabecera del archivo y el reporte del
 * encargo P06.3), así que acá alcanza con probar que el resultado SIN error
 * siempre cae en la misma confirmación genérica.
 */
interface ResetPasswordForEmailResult {
  data: Record<string, never> | null
  error: { code: string; message: string; status: number; name: string } | null
}
// `vi.hoisted`: ver el comentario largo de `LoginPage.test.tsx` — sin esto,
// referenciar `resetPasswordForEmailMock` directo dentro de la factory
// explota con la suite completa (`pnpm test`), aunque el archivo solo pase.
const { resetPasswordForEmailMock } = vi.hoisted(() => ({
  resetPasswordForEmailMock:
    vi.fn<
      (
        email: string,
        options: { redirectTo: string },
      ) => Promise<ResetPasswordForEmailResult>
    >(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: resetPasswordForEmailMock } },
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/recuperar']}>
      <ForgotPasswordPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  resetPasswordForEmailMock.mockReset()
})

describe('ForgotPasswordPage (COM-02)', () => {
  it('con una cuenta real, muestra el mensaje de confirmación genérico', async () => {
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null })
    renderPage()

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'carlos.medina@extendiendoservicios.com' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Mandar instrucciones' }),
    )

    expect(
      await screen.findByRole('heading', { name: 'Revisá tu correo' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Si ese email tiene una cuenta, te mandamos un correo con instrucciones para restablecer la contraseña.',
      ),
    ).toBeInTheDocument()
  })

  it('con un email que no existe, muestra EL MISMO mensaje de confirmación', async () => {
    // Comprobado contra App_dev (ver el reporte): sin error también para un
    // email sin cuenta — no hay ninguna forma de que este componente
    // distinga los dos casos, ni falta que le hace.
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null })
    renderPage()

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'esta-cuenta-no-existe@extendiendoservicios.com' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Mandar instrucciones' }),
    )

    expect(
      await screen.findByRole('heading', { name: 'Revisá tu correo' }),
    ).toBeInTheDocument()
  })

  it('el límite de envíos sí se avisa distinto (no tiene que ver con si el email existe)', async () => {
    resetPasswordForEmailMock.mockResolvedValue({
      data: null,
      error: {
        code: 'over_email_send_rate_limit',
        message: 'x',
        status: 429,
        name: 'AuthApiError',
      },
    })
    renderPage()

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'carlos.medina@extendiendoservicios.com' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Mandar instrucciones' }),
    )

    expect(
      await screen.findByText(
        'Hiciste demasiados pedidos. Esperá un momento y probá de nuevo.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Revisá tu correo' }),
    ).not.toBeInTheDocument()
  })
})
