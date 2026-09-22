import { useState } from 'react'
import { Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { supabase } from '@/lib/supabase'
import { FORGOT_PASSWORD_CONFIRMATION } from '@/features/auth/authErrors'
import { AuthScreenLayout } from './AuthScreenLayout'

/**
 * COM-02 · Recuperar contraseña (AUTH-005, `05` sección 3): un email, un
 * mensaje de confirmación genérico.
 *
 * "No revela si el email existe" (la propia fila de COM-02 en `05`, punto 1
 * de "tres cosas que quiero remarcar" del encargo P06.3) está comprobado,
 * no solo declarado: `auth.resetPasswordForEmail` devuelve el mismo
 * resultado sin error tanto para un email con cuenta real como para uno que
 * no existe (probado contra `App_dev`, ver el reporte del encargo) —
 * Supabase ya lo unifica del lado del servidor. Por eso el único caso que
 * cambia el mensaje de acá es un error que NO tiene nada que ver con si la
 * cuenta existe (`over_email_send_rate_limit`, un corte de red): cualquier
 * otra cosa, incluido "no existe", cae en el mismo texto de siempre.
 */
const forgotPasswordSchema = z.object({
  email: z.email('Ingresá un email válido.'),
})
type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [rateLimited, setRateLimited] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  async function onSubmit({ email }: ForgotPasswordFormValues) {
    setRateLimited(false)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/restablecer`,
    })
    // Cualquier resultado que no sea el límite de envíos termina en la
    // misma confirmación genérica — con error de Auth o sin él, exista o no
    // exista la cuenta (ver el comentario de arriba).
    if (error?.code === 'over_email_send_rate_limit') {
      setRateLimited(true)
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <AuthScreenLayout>
        <div className="flex flex-col items-center gap-3 text-center">
          <MailCheck aria-hidden="true" className="size-9 text-primary-800" />
          <h1 className="text-[19px] font-bold text-text">Revisá tu correo</h1>
          <p className="text-[13px] text-text-2">
            {FORGOT_PASSWORD_CONFIRMATION}
          </p>
        </div>
        <Link
          to="/ingresar"
          className="text-center text-[12.5px] font-semibold text-primary-800 underline-offset-4 hover:underline"
        >
          Volver a ingresar
        </Link>
      </AuthScreenLayout>
    )
  }

  return (
    <AuthScreenLayout>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[19px] font-bold text-text">
          Recuperar contraseña
        </h1>
        <p className="text-[13px] text-text-2">
          Ingresá tu email y te mandamos instrucciones para elegir una
          contraseña nueva.
        </p>
      </div>

      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field data-invalid={Boolean(errors.email) || undefined}>
          <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
          <Input
            id="forgot-email"
            type="email"
            icon={Mail}
            autoComplete="username"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          {errors.email && <FieldError>{errors.email.message}</FieldError>}
        </Field>

        {rateLimited && (
          <Alert variant="crit">
            <AlertDescription>
              Hiciste demasiados pedidos. Esperá un momento y probá de nuevo.
            </AlertDescription>
          </Alert>
        )}

        <Button type="submit" size="mobile" loading={isSubmitting}>
          Mandar instrucciones
        </Button>
      </form>

      <Link
        to="/ingresar"
        className="text-center text-[12.5px] font-semibold text-primary-800 underline-offset-4 hover:underline"
      >
        Volver a ingresar
      </Link>
    </AuthScreenLayout>
  )
}
