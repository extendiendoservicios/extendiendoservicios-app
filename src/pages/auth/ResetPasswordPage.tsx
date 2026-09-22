import { useState } from 'react'
import { Link, Navigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { homePathForRoles } from '@/features/auth/session'
import { updatePasswordErrorMessage } from '@/features/auth/authErrors'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { RouteFallback } from '@/app/routes/RouteFallback'
import { AuthScreenLayout } from './AuthScreenLayout'

/**
 * COM-03 · Restablecer contraseña (AUTH-005, `05` sección 3): nueva
 * contraseña y confirmación, mínimo 8 (P-106, la base la exige de verdad —
 * este formulario solo la replica para avisar antes de mandar el pedido).
 *
 * ## Cómo llega el token de verdad (comprobado contra `App_dev`, no
 * supuesto — encargo P06.3, punto 2 de "tres cosas que quiero remarcar")
 *
 * El correo de COM-02 no manda a un `token` que esta pantalla tenga que
 * leer de la URL a mano: `supabase-js` (`detectSessionInUrl: true`,
 * `src/lib/supabase.ts`) lo procesa solo, ANTES de que cualquier componente
 * de React llegue a montarse (`GoTrueClient._initialize()`, que arranca en
 * el momento en que se crea el cliente, en el import de `supabase.ts`).
 * Con el flujo implícito de Auth (`flowType` por omisión, no se pisa en
 * este proyecto), ese procesamiento hace una llamada real a
 * `/auth/v1/user` para validar el `access_token` de la URL antes de armar
 * la sesión — un viaje de red que tarda muchísimo más que lo que React
 * tarda en montar `AuthProvider` y suscribirse a `onAuthStateChange`, así
 * que en la práctica el listener siempre llega a tiempo (verificado leyendo
 * `GoTrueClient.js`, no solo probado una vez). El resultado: para cuando
 * esta pantalla se renderiza, YA HAY una sesión completa y autenticada
 * (con roles y todo) — no un estado intermedio "a mitad de camino".
 *
 * Eso convierte a COM-03 en una ruta "intermedia", ni pública ni protegida
 * por `RequireRole`: no puede exigir un rol (nadie con `roles: []` podría
 * entrar nunca a cambiar su contraseña si la desactivación existiera hoy),
 * pero tampoco puede tratar "tiene sesión" como "vino con el enlace" —
 * cualquiera con una sesión normal (por ejemplo, alguien que guardó esta
 * URL en favoritos) también cae en `status: 'authenticated'`. La señal real
 * es el EVENTO que entregó esa sesión: `PASSWORD_RECOVERY`, no `SIGNED_IN`
 * (`GoTrueClient.js`, línea ~424) — `AuthProvider` ya lo captura en
 * `isPasswordRecovery` (ver su comentario) para que esta pantalla no tenga
 * que suscribirse por su cuenta ni arriesgar una carrera con el
 * `AuthProvider` de más arriba.
 *
 * **Hallazgo aparte, de infraestructura, no de este archivo:** el
 * `redirect_to` configurado en `additional_redirect_urls`
 * (`supabase/config.toml`, incluye `.../restablecer`) no se está
 * respetando en `App_dev` ahora mismo — probado con
 * `auth.admin.generateLink` contra tres valores distintos (`.../restablecer`,
 * la raíz del sitio, y hasta el propio `site_url`): los tres volvieron con
 * `redirect_to` pisado por el `site_url` pelado, sin `/restablecer`. Un
 * enlace de recuperación real hoy deja a la persona en `/` con el token en
 * el hash, no en esta ruta. Por eso el `RootLayout` (`router.tsx`) hace un
 * redirect defensivo a `/restablecer` para cualquier ruta cuando
 * `isPasswordRecovery` es `true`: funciona HOY (`detectSessionInUrl` lee el
 * hash sin importar qué ruta esté montada) y sigue funcionando el día que
 * alguien corrija el `redirect_to` en el proyecto real (deja de hacer
 * falta, pero no rompe nada si sigue). Se reporta como hallazgo, no se
 * corrige acá: tocar `config.toml`/`config push` no es de este paquete.
 */
const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'La contraseña tiene que tener al menos 8 caracteres.'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  })
type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

export default function ResetPasswordPage() {
  const auth = useAuth()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [justUpdated, setJustUpdated] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
  })

  // Se resuelve ANTES que cualquier otro estado: apenas se guardó la
  // contraseña nueva, `isPasswordRecovery` ya bajó a `false` (evento
  // `USER_UPDATED`, `AuthProvider`) y, sin este chequeo primero, la rama de
  // "autenticado pero sin venir del enlace" de más abajo mandaría a
  // `/perfil` en vez de a la vía del rol — que es lo que pide `05` ("Navega
  // a: Según rol").
  if (justUpdated) {
    return (
      <Navigate
        to={homePathForRoles(auth.roles, isDesktop) ?? '/sin-acceso'}
        replace
      />
    )
  }

  if (auth.status === 'loading') {
    return <RouteFallback />
  }

  if (auth.status === 'unauthenticated') {
    return (
      <AuthScreenLayout>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-[19px] font-bold text-text">
            El enlace no es válido
          </h1>
          <p className="text-[13px] text-text-2">
            Este enlace de restablecimiento venció o ya se usó. Pedí uno nuevo
            desde "Olvidé mi contraseña".
          </p>
        </div>
        <Link
          to="/recuperar"
          className="text-center text-[12.5px] font-semibold text-primary-800 underline-offset-4 hover:underline"
        >
          Pedir un enlace nuevo
        </Link>
      </AuthScreenLayout>
    )
  }

  // Autenticado, pero no por este enlace (sesión propia de siempre): acá no
  // se cambia la contraseña sin más — eso ya existe en COM-04.
  if (!auth.isPasswordRecovery) {
    return <Navigate to="/perfil" replace />
  }

  async function onSubmit(values: ResetPasswordFormValues) {
    setFormError(null)
    const { error } = await supabase.auth.updateUser({
      password: values.password,
    })
    if (error) {
      setFormError(updatePasswordErrorMessage(error))
      return
    }
    setJustUpdated(true)
  }

  return (
    <AuthScreenLayout>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-[19px] font-bold text-text">
          Elegí una contraseña nueva
        </h1>
        <p className="text-[13px] text-text-2">Mínimo 8 caracteres.</p>
      </div>

      <form
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Field data-invalid={Boolean(errors.password) || undefined}>
          <FieldLabel htmlFor="reset-password">Contraseña nueva</FieldLabel>
          <Input
            id="reset-password"
            type="password"
            icon={Lock}
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          {errors.password && (
            <FieldError>{errors.password.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.confirmPassword) || undefined}>
          <FieldLabel htmlFor="reset-confirm-password">
            Confirmar contraseña
          </FieldLabel>
          <Input
            id="reset-confirm-password"
            type="password"
            icon={Lock}
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <FieldError>{errors.confirmPassword.message}</FieldError>
          )}
        </Field>

        {formError && (
          <Alert variant="crit">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" size="mobile" loading={isSubmitting}>
          Guardar contraseña
        </Button>
      </form>
    </AuthScreenLayout>
  )
}
