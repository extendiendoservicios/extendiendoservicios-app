import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LogOut, MapPin } from 'lucide-react'
import { AvatarUpload } from '@/components/AvatarUpload'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { ROLE_LABELS } from '@/features/auth/session'
import { updatePasswordErrorMessage } from '@/features/auth/authErrors'
import { formatShortDate, formatTime } from '@/lib/format'

/**
 * COM-04 · Perfil propio (AUTH-007, `05` sección 3): datos propios, email
 * de contacto, teléfono, foto, cambio de contraseña, roles, consentimiento
 * de ubicación, cerrar sesión. Nombre y email de login son de solo lectura
 * (el encargo P06.3 lo remarca: "el nombre y el email de login son de
 * solo lectura") — el nombre lo escribe un administrador (ADM-27, F7), el
 * email de login solo lo cambia el dueño o un administrador (P-037).
 *
 * La foto (EMP-011, P09.2) usa `AvatarUpload` con el `profileId` propio —
 * el mismo componente que va a usar ADM-18 (front-admin) para la foto de
 * otra persona.
 *
 * Sin `<h1>` propio: la ruta lleva `handle: {screenId: 'COM-04', title:
 * 'Mi perfil'}` (`commonRoutes.tsx`) y los dos shells ya lo muestran en su
 * topbar/cabecera (`useRouteHandle`) — repetirlo acá duplicaría el título.
 */
const contactSchema = z.object({
  contactEmail: z.union([z.email('Ingresá un email válido.'), z.literal('')]),
  phone: z.string(),
})
type ContactFormValues = z.infer<typeof contactSchema>

const passwordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'La contraseña tiene que tener al menos 8 caracteres.'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmPassword'],
  })
type PasswordFormValues = z.infer<typeof passwordSchema>

/** `company_settings.location_consent_text` (P-108): el texto lo provee la empresa, no este archivo. */
function useLocationConsentText(): string | null {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    supabase
      .from('company_settings')
      .select('location_consent_text')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setText(data.location_consent_text)
      })
    return () => {
      active = false
    }
  }, [])
  return text
}

export default function ProfilePage() {
  const auth = useAuth()
  const consentText = useLocationConsentText()

  const [contactStatus, setContactStatus] = useState<
    'idle' | 'saved' | 'error'
  >('idle')
  const {
    register: registerContact,
    handleSubmit: handleContactSubmit,
    formState: { errors: contactErrors, isSubmitting: isSavingContact },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    values: {
      contactEmail: auth.profile?.contactEmail ?? '',
      phone: auth.profile?.phone ?? '',
    },
  })

  async function onSaveContact(values: ContactFormValues) {
    if (!auth.userId) return
    setContactStatus('idle')
    const { error } = await supabase
      .from('profiles')
      .update({
        contact_email: values.contactEmail || null,
        phone: values.phone || null,
      })
      .eq('id', auth.userId)
    if (error) {
      setContactStatus('error')
      return
    }
    await auth.refreshProfile()
    setContactStatus('saved')
  }

  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    reset: resetPasswordForm,
    formState: { errors: passwordErrors, isSubmitting: isSavingPassword },
  } = useForm<PasswordFormValues>({ resolver: zodResolver(passwordSchema) })

  async function onChangePassword(values: PasswordFormValues) {
    setPasswordError(null)
    setPasswordSaved(false)
    const { error } = await supabase.auth.updateUser({
      password: values.newPassword,
    })
    if (error) {
      setPasswordError(updatePasswordErrorMessage(error))
      return
    }
    resetPasswordForm()
    setPasswordSaved(true)
  }

  const [consentBusy, setConsentBusy] = useState(false)
  async function setLocationConsent(consent: boolean) {
    if (!auth.userId) return
    setConsentBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        location_consent_at: consent ? new Date().toISOString() : null,
      })
      .eq('id', auth.userId)
    setConsentBusy(false)
    if (!error) {
      await auth.refreshProfile()
    }
  }

  const locationConsentAt = auth.profile?.locationConsentAt ?? null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Datos de la cuenta</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {auth.userId && (
            <AvatarUpload
              profileId={auth.userId}
              name={auth.displayName}
              avatarPath={auth.profile?.avatarPath ?? null}
              onChange={() => void auth.refreshProfile()}
            />
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-name">Nombre</FieldLabel>
              <Input
                id="profile-name"
                value={auth.displayName}
                disabled
                readOnly
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-login-email">
                Email de login
              </FieldLabel>
              <Input
                id="profile-login-email"
                value={auth.email ?? ''}
                disabled
                readOnly
              />
            </Field>
          </div>
          <Field>
            <FieldLabel>Roles</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {auth.roles.map((role) => (
                <Badge key={role} variant="primary">
                  {ROLE_LABELS[role]}
                </Badge>
              ))}
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacto</CardTitle>
        </CardHeader>
        <form
          onSubmit={(event) => void handleContactSubmit(onSaveContact)(event)}
        >
          <CardContent className="flex flex-col gap-4">
            <Field
              data-invalid={Boolean(contactErrors.contactEmail) || undefined}
            >
              <FieldLabel htmlFor="profile-contact-email">
                Email de contacto
              </FieldLabel>
              <Input
                id="profile-contact-email"
                type="email"
                aria-invalid={Boolean(contactErrors.contactEmail)}
                {...registerContact('contactEmail')}
              />
              {contactErrors.contactEmail && (
                <FieldError>{contactErrors.contactEmail.message}</FieldError>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-phone">Teléfono</FieldLabel>
              <Input id="profile-phone" {...registerContact('phone')} />
            </Field>
            {contactStatus === 'saved' && (
              <Alert variant="info">
                <AlertDescription>Guardamos los cambios.</AlertDescription>
              </Alert>
            )}
            {contactStatus === 'error' && (
              <Alert variant="crit">
                <AlertDescription>
                  No pudimos guardar los cambios. Probá de nuevo.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" size="sm" loading={isSavingContact}>
              Guardar contacto
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
        </CardHeader>
        <form
          onSubmit={(event) =>
            void handlePasswordSubmit(onChangePassword)(event)
          }
        >
          <CardContent className="flex flex-col gap-4">
            <Field
              data-invalid={Boolean(passwordErrors.newPassword) || undefined}
            >
              <FieldLabel htmlFor="profile-new-password">
                Contraseña nueva
              </FieldLabel>
              <PasswordInput
                id="profile-new-password"
                autoComplete="new-password"
                aria-invalid={Boolean(passwordErrors.newPassword)}
                {...registerPassword('newPassword')}
              />
              {passwordErrors.newPassword && (
                <FieldError>{passwordErrors.newPassword.message}</FieldError>
              )}
            </Field>
            <Field
              data-invalid={
                Boolean(passwordErrors.confirmPassword) || undefined
              }
            >
              <FieldLabel htmlFor="profile-confirm-password">
                Confirmar contraseña
              </FieldLabel>
              <PasswordInput
                id="profile-confirm-password"
                autoComplete="new-password"
                aria-invalid={Boolean(passwordErrors.confirmPassword)}
                {...registerPassword('confirmPassword')}
              />
              {passwordErrors.confirmPassword && (
                <FieldError>
                  {passwordErrors.confirmPassword.message}
                </FieldError>
              )}
            </Field>
            {passwordSaved && (
              <Alert variant="info">
                <AlertDescription>Cambiamos tu contraseña.</AlertDescription>
              </Alert>
            )}
            {passwordError && (
              <Alert variant="crit">
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" size="sm" loading={isSavingPassword}>
              Cambiar contraseña
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ubicación</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="flex items-start gap-2 text-[12.5px] text-text-2">
            <MapPin
              aria-hidden="true"
              className="mt-px size-[15px] shrink-0 text-text-3"
            />
            {consentText ??
              'Para registrar el inicio y el fin de tu turno con tu ubicación, Extendiendo Servicios necesita tu permiso de geolocalización. Podés usar la app igual sin darlo.'}
          </p>
          {locationConsentAt ? (
            <p className="text-[12px] text-text-3">
              Diste tu consentimiento el {formatShortDate(locationConsentAt)},{' '}
              {formatTime(locationConsentAt)}.
            </p>
          ) : (
            <p className="text-[12px] text-text-3">
              Todavía no diste tu consentimiento de ubicación.
            </p>
          )}
        </CardContent>
        <CardFooter className="justify-end">
          {locationConsentAt ? (
            <Button
              variant="ghost"
              size="sm"
              loading={consentBusy}
              onClick={() => void setLocationConsent(false)}
            >
              Quitar consentimiento
            </Button>
          ) : (
            <Button
              size="sm"
              loading={consentBusy}
              onClick={() => void setLocationConsent(true)}
            >
              Dar mi consentimiento
            </Button>
          )}
        </CardFooter>
      </Card>

      <Button
        variant="ghost"
        icon={LogOut}
        className="self-start"
        onClick={() => void auth.signOut()}
      >
        Cerrar sesión
      </Button>
    </div>
  )
}
