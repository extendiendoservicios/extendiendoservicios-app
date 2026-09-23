import { useState } from 'react'
import { Navigate, Link } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Mail, Lock, Phone, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { homePathForRoles } from '@/features/auth/session'
import { loginErrorMessage } from '@/features/auth/authErrors'
import { useBranding, brandingLogoUrl } from '@/features/auth/useBranding'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { RouteFallback } from '@/app/routes/RouteFallback'
import { AuthScreenLayout } from './AuthScreenLayout'

/**
 * COM-01 · Ingreso (AUTH-003, `05` sección 3): email y contraseña, enlace a
 * COM-02, teléfono de soporte si `v_public_branding` lo tiene cargado.
 *
 * AUTH-004 (la redirección al entrar) vive acá adentro, no en el router:
 * mientras `status !== 'authenticated'` esta pantalla se queda quieta; en
 * cuanto `AuthProvider` confirma la sesión (el mismo `onAuthStateChange` que
 * ya dispara `signInWithPassword`, sin que este componente tenga que
 * "esperar" la respuesta a mano), este mismo render calcula
 * `homePathForRoles(roles, isDesktop)` y redirige — cubre tanto "acabo de
 * loguearme" como "ya tenía sesión y entré a /ingresar por las mías" con la
 * misma línea.
 */
const loginSchema = z.object({
  email: z.email('Ingresá un email válido.'),
  password: z.string().min(1, 'Ingresá tu contraseña.'),
})
type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const auth = useAuth()
  const { branding } = useBranding()
  // `05` sección 7: 1024 px es el quiebre real entre el `AdminShell` con
  // sidebar/tabbar (`/admin`, cualquier ancho) y las vías mobile-first
  // (`/app`, `/sup`) — el mismo quiebre que ya usan `AdminShell`/`DataTable`
  // (`useMediaQuery`, no uno nuevo inventado acá).
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) })

  if (auth.status === 'loading') {
    return <RouteFallback />
  }

  if (auth.status === 'authenticated' && !auth.isPasswordRecovery) {
    return (
      <Navigate
        to={homePathForRoles(auth.roles, isDesktop) ?? '/sin-acceso'}
        replace
      />
    )
  }

  async function onSubmit(values: LoginFormValues) {
    setFormError(null)
    const { error } = await supabase.auth.signInWithPassword(values)
    if (error) {
      setFormError(loginErrorMessage(error))
      return
    }
    // Sin error: `onAuthStateChange` (`AuthProvider`) ya actualizó
    // `status`/`roles` antes de que esta función termine de correr (el
    // evento sale del mismo `await`), así que el próximo render entra por
    // la rama de arriba y redirige solo.
  }

  const logoSrc = branding?.logoPath
    ? brandingLogoUrl(branding.logoPath)
    : '/favicon.png'
  const logoAlt = branding?.name ?? 'Extendiendo Servicios'

  return (
    <AuthScreenLayout>
      <div className="flex flex-col items-center gap-3 text-center">
        <img src={logoSrc} alt={logoAlt} className="h-12 w-12 object-contain" />
        <h1 className="text-[19px] font-bold text-text">Ingresar</h1>
      </div>

      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field data-invalid={Boolean(errors.email) || undefined}>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input
            id="login-email"
            type="email"
            icon={Mail}
            autoComplete="username"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          {errors.email && <FieldError>{errors.email.message}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.password) || undefined}>
          <FieldLabel htmlFor="login-password">Contraseña</FieldLabel>
          <Input
            id="login-password"
            type="password"
            icon={Lock}
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {errors.password && (
            <FieldError>{errors.password.message}</FieldError>
          )}
        </Field>

        {formError && (
          <Alert variant="crit">
            <TriangleAlert aria-hidden="true" />
            <div>
              <AlertTitle>No pudimos iniciar sesión</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </div>
          </Alert>
        )}

        <Button type="submit" size="mobile" loading={isSubmitting}>
          Ingresar
        </Button>
      </form>

      <Link
        to="/recuperar"
        className="text-center text-[12.5px] font-semibold text-primary-800 underline-offset-4 hover:underline"
      >
        ¿Olvidaste tu contraseña?
      </Link>

      {branding?.supportPhone && (
        <p className="flex items-center justify-center gap-2 border-t border-border pt-4 text-center text-[12px] text-text-2">
          <Phone
            aria-hidden="true"
            className="size-[15px] shrink-0 text-text-3"
          />
          Si no podés entrar, comunicate con Administración al{' '}
          <span className="whitespace-nowrap">
            <a
              href={`tel:${branding.supportPhone.replace(/[^\d+]/g, '')}`}
              className="font-semibold text-text"
            >
              {branding.supportPhone}
            </a>
            .
          </span>
        </p>
      )}
    </AuthScreenLayout>
  )
}
