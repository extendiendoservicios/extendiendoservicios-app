import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { tz } from '@date-fns/tz'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { isApiError } from '@/api/errors'
import { CREDENTIAL_SOURCE_LABELS, type Credentials } from '@/api/credentials'
import {
  useAccessStatusQuery,
  useGetCredentialsMutation,
  useInvalidateAccessStatus,
  useUpdateEmailMutation,
} from '@/features/users/queries'
import {
  updateEmailSchema,
  type UpdateEmailFormValues,
} from '@/features/users/schemas'
import { ResetEmployeePasswordDialog } from '@/features/employees/components/EmployeeAccountDialogs'

/**
 * P26.2 / P26.2b (CR-01, CR-03, CR-10, CR-11, CR-14): filas "Usuario" y
 * "Contraseña" de la persona. Las usa el bloque principal de ADM-17 (debajo
 * de los botones de la derecha, visible desde todas las pestañas) y ADM-27
 * ("Ver acceso", panel lateral). Quien lo monta decide si corresponde con
 * `canViewCredentials` (`features/users/permissions.ts`); el servidor vuelve
 * a verificar.
 *
 * El usuario, el origen y la fecha vienen de `get_access_status`, que no trae
 * la contraseña ni deja eventos: se pide al abrir. La contraseña nace tapada
 * y recién "Mostrar" o "Copiar" llaman a `get_credentials` (que deja un
 * evento `credentials_viewed`).
 *
 * La contraseña vive solo en el estado de este componente: se tapa a los
 * 30 segundos, al desmontarse, al cambiar de persona y cuando cambia la
 * fecha de la copia; nunca va al caché de consultas, al título de la página
 * ni a la consola.
 */

/** Cuánto queda visible la contraseña tras "Mostrar" (CR-10). */
export const PASSWORD_VISIBLE_MS = 30_000
const COPIED_NOTICE_MS = 3_000
const MASK = '••••••••'

const NONE_HELP =
  'La cuenta se creó antes de que la app guardara las contraseñas.'
const UNREADABLE_HELP = 'No se pudo leer la copia guardada.'

const buenosAires = tz(BUENOS_AIRES_TIME_ZONE)

/** "28 oct 2026, 14:05" en hora de Argentina (CR-11). */
export function formatCredentialDate(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy, HH:mm', {
    locale: es,
    in: buenosAires,
  })
}

export interface AccessPerson {
  profileId: string
  firstName: string
  lastName: string
}

const LABEL = 'pt-1.5 text-[11.5px] text-text-muted'
const VALUE = 'min-w-0 break-all font-mono text-[13px] text-text'

function AccessBlock({
  person,
  showChangePassword = true,
  className,
}: {
  person: AccessPerson
  /**
   * ADM-17 ya tiene "Cambiar contraseña" arriba; ADM-27 no, así que ahí
   * hace falta el "Cambiar" de la fila.
   */
  showChangePassword?: boolean
  className?: string
}) {
  const getCredentials = useGetCredentialsMutation()
  const accessQuery = useAccessStatusQuery(person.profileId)
  const invalidateAccessStatus = useInvalidateAccessStatus()
  const [password, setPassword] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copiedLabel, setCopiedLabel] = useState('')
  const [dialog, setDialog] = useState<'email' | 'password' | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  const access = accessQuery.data
  const status = access?.status ?? null
  const unavailable = status === 'none' || status === 'unreadable'
  const setAt = access?.setAt ?? null

  // Cambiar de persona: se borra todo lo que hubiera de la anterior.
  useEffect(() => {
    return () => {
      setPassword(null)
      setErrorMessage(null)
      setCopiedLabel('')
    }
  }, [person.profileId])

  // Si la copia cambió (desde este bloque o desde el botón de arriba), la contraseña que se veía ya no vale.
  const [seenSetAt, setSeenSetAt] = useState(setAt)
  if (seenSetAt !== setAt) {
    setSeenSetAt(setAt)
    setPassword(null)
  }

  // La contraseña se vuelve a tapar a los 30 segundos y al desmontar.
  useEffect(() => {
    if (password === null) return undefined
    const timer = setTimeout(() => setPassword(null), PASSWORD_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [password])

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  const clearAll = useCallback(() => {
    setPassword(null)
    setErrorMessage(null)
    invalidateAccessStatus()
  }, [invalidateAccessStatus])

  async function request(): Promise<Credentials | null> {
    setErrorMessage(null)
    try {
      const credentials = await getCredentials.mutateAsync(person.profileId)
      if (credentials.status !== status) {
        // La vista estaba desactualizada: se refresca el estado.
        invalidateAccessStatus()
      }
      return credentials
    } catch (error) {
      setErrorMessage(
        isApiError(error) ? error.message : 'No pudimos obtener el acceso.',
      )
      return null
    }
  }

  function announceCopied(label: string) {
    clearTimeout(copiedTimer.current)
    setCopiedLabel(`${label} copiado.`)
    copiedTimer.current = setTimeout(() => setCopiedLabel(''), COPIED_NOTICE_MS)
  }

  async function writeToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      announceCopied(label)
    } catch {
      toast.error('No pudimos copiar. Copialo a mano.')
    }
  }

  async function handleShow() {
    const credentials = await request()
    if (credentials?.status === 'ok') {
      setPassword(credentials.password)
    }
  }

  async function handleCopyPassword() {
    if (password !== null) {
      await writeToClipboard(password, 'Contraseña')
      return
    }
    const credentials = await request()
    if (credentials?.status === 'ok' && credentials.password !== null) {
      // Se copia sin mostrarla y sin guardarla.
      await writeToClipboard(credentials.password, 'Contraseña')
    }
  }

  async function handleCopyEmail() {
    if (access?.email) {
      await writeToClipboard(access.email, 'Usuario')
    }
  }

  const personName = `${person.firstName} ${person.lastName}`
  const loadError = accessQuery.isError
    ? isApiError(accessQuery.error)
      ? accessQuery.error.message
      : 'No pudimos obtener el acceso.'
    : null
  const emailText = access
    ? (access.email ?? 'Sin email')
    : accessQuery.isError
      ? '—'
      : 'Cargando…'

  return (
    <section
      aria-label="Acceso a la app"
      className={cn(
        'grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1',
        className,
      )}
    >
      <span className={LABEL}>Usuario</span>
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <span className={VALUE} data-testid="access-email">
          {emailText}
        </span>
        <div className="flex flex-wrap items-center gap-x-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!access?.email}
            aria-label={`Copiar usuario de ${personName}`}
            onClick={() => void handleCopyEmail()}
          >
            Copiar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Cambiar usuario de ${personName}`}
            onClick={() => setDialog('email')}
          >
            Cambiar
          </Button>
        </div>
      </div>

      <span className={LABEL}>Contraseña</span>
      {unavailable ? (
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-1">
            <span className="text-[13px] text-text-muted">No disponible</span>
            {showChangePassword && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setDialog('password')}
              >
                Poner una nueva
              </Button>
            )}
          </div>
          <p className="text-[11.5px] text-text-muted">
            {status === 'none' ? NONE_HELP : UNREADABLE_HELP}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-1">
            <span className={VALUE} data-testid="access-password">
              {password ?? MASK}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={getCredentials.isPending}
              aria-label={
                password === null
                  ? `Mostrar contraseña de ${personName}`
                  : `Ocultar contraseña de ${personName}`
              }
              onClick={() =>
                password === null ? void handleShow() : setPassword(null)
              }
            >
              {password === null ? 'Mostrar' : 'Ocultar'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Copiar contraseña de ${personName}`}
              onClick={() => void handleCopyPassword()}
            >
              Copiar
            </Button>
            {showChangePassword && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Cambiar contraseña de ${personName}`}
                onClick={() => setDialog('password')}
              >
                Cambiar
              </Button>
            )}
          </div>
          {access?.source && access.setAt && (
            <p className="text-[11.5px] text-text-muted">
              {CREDENTIAL_SOURCE_LABELS[access.source]} ·{' '}
              {formatCredentialDate(access.setAt)}
            </p>
          )}
        </div>
      )}

      {(errorMessage ?? loadError) && (
        <p
          role="alert"
          className="col-span-2 pt-1 text-[12.5px] text-danger-800"
        >
          {errorMessage ?? loadError}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {copiedLabel}
      </p>
      {copiedLabel && (
        <p
          aria-hidden="true"
          className="col-span-2 text-[11.5px] text-primary-800"
        >
          {copiedLabel}
        </p>
      )}

      <ResetEmployeePasswordDialog
        employee={person}
        open={dialog === 'password'}
        onOpenChange={(open) => setDialog(open ? 'password' : null)}
        onReset={clearAll}
      />
      <ChangeEmailDialog
        person={person}
        open={dialog === 'email'}
        onOpenChange={(open) => setDialog(open ? 'email' : null)}
        onChanged={clearAll}
      />
    </section>
  )
}

/** CR-14: cambiar el email de login con la acción `update_email` que ya existe. */
function ChangeEmailDialog({
  person,
  open,
  onOpenChange,
  onChanged,
}: {
  person: AccessPerson
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}) {
  const updateEmail = useUpdateEmailMutation()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateEmailFormValues>({
    resolver: zodResolver(updateEmailSchema),
  })

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  async function onSubmit(values: UpdateEmailFormValues) {
    try {
      await updateEmail.mutateAsync({
        profileId: person.profileId,
        email: values.email,
      })
      toast.success(
        `Cambiamos el email de login de ${person.firstName} ${person.lastName}.`,
      )
      onChanged()
      handleOpenChange(false)
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar el email.',
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar email de login</DialogTitle>
          <DialogDescription>
            Nuevo email de login de {person.firstName} {person.lastName}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
          <Field data-invalid={Boolean(errors.email) || undefined}>
            <FieldLabel htmlFor="access-email-new">Email nuevo</FieldLabel>
            <Input
              id="access-email-new"
              type="email"
              aria-invalid={Boolean(errors.email)}
              {...register('email')}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={updateEmail.isPending}>
              Cambiar email
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** ADM-27: "Ver acceso" abre el mismo bloque en un panel lateral. */
function AccessSheet({
  person,
  open,
  onOpenChange,
}: {
  person: AccessPerson
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            Acceso de {person.firstName} {person.lastName}
          </SheetTitle>
          <SheetDescription>
            Usuario y contraseña para ingresar a la app.
          </SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-6">
          <AccessBlock key={person.profileId} person={person} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { AccessBlock, AccessSheet }
