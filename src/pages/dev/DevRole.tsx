import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { LogOut } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { homePathForRoles } from '@/features/auth/session'

/**
 * `/dev/rol` (solo en desarrollo, P06.2, sigue en pie tras P06.3): desde
 * que existe `AuthProvider` (AUTH-002), esta página dejó de simular una
 * sesión falsa (el `devRole.ts` de F5 se borró entero) y pasó a ser un
 * atajo para entrar rápido con una cuenta REAL del seed de `App_dev`. Llama
 * al mismo `supabase.auth.signInWithPassword` que usa COM-01
 * (`/ingresar`, ya construida en P06.3) — no hay ningún camino paralelo
 * que mantener.
 *
 * Se decidió CONSERVARLA (no borrarla) ahora que COM-01 existe de verdad:
 * sigue siendo más rápida para ir probando cada vía durante el desarrollo
 * (un clic sobre una de las 14 cuentas rellena el email, sin tener que
 * escribirlo cada vez) — decisión menor del encargo P06.3, ver el reporte.
 * Nunca llega a `dist/` (mismo patrón `lazy()` + `if (import.meta.env.DEV)`
 * de siempre, `router.tsx`).
 *
 * La contraseña (`SEED_DEV_PASSWORD` de `.env.local`) NO está acá: es una
 * variable sin prefijo `VITE_` a propósito (`scripts/seed-dev.ts`), así que
 * Vite nunca la expone al bundle del cliente. Quien use este atajo la
 * escribe a mano una vez (el navegador se acuerda con el autocompletado).
 *
 * Registrada en `router.tsx` con el mismo patrón que `/dev/design`
 * (`lazy()` + `if (import.meta.env.DEV)`): no queda en `dist/`.
 */
const SEED_ACCOUNTS: { email: string; label: string }[] = [
  { email: 'extserviciosapp@gmail.com', label: 'Lucas Enríquez — dueño' },
  {
    email: 'andrea.rios@extendiendoservicios.com',
    label: 'Andrea Ríos — administradora',
  },
  {
    email: 'paula.lemos@extendiendoservicios.com',
    label: 'Paula Lemos — supervisora',
  },
  {
    email: 'noelia.vera@extendiendoservicios.com',
    label: 'Noelia Vera — supervisora',
  },
  {
    email: 'maria.gomez@extendiendoservicios.com',
    label: 'María Gómez — empleada',
  },
  {
    email: 'juan.perez@extendiendoservicios.com',
    label: 'Juan Pérez — empleado',
  },
  {
    email: 'sofia.ruiz@extendiendoservicios.com',
    label: 'Sofía Ruiz — empleada',
  },
  {
    email: 'carlos.medina@extendiendoservicios.com',
    label: 'Carlos Medina — empleado',
  },
  {
    email: 'lucia.torres@extendiendoservicios.com',
    label: 'Lucía Torres — empleada',
  },
  {
    email: 'rocio.aguirre@extendiendoservicios.com',
    label: 'Rocío Aguirre — empleada',
  },
  {
    email: 'valeria.paz@extendiendoservicios.com',
    label: 'Valeria Paz — empleada',
  },
  {
    email: 'diego.fabbri@extendiendoservicios.com',
    label: 'Diego Fabbri — empleado',
  },
  {
    email: 'martin.sosa@extendiendoservicios.com',
    label: 'Martín Sosa — empleado',
  },
  {
    email: 'patricia.nunez@extendiendoservicios.com',
    label: 'Patricia Núñez — empleada',
  },
]

function DevRolePage() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [goTo, setGoTo] = useState<string | null>(null)

  if (goTo) {
    return <Navigate to={goTo} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    setSubmitting(false)
    if (signInError) {
      setError(signInError.message)
    }
  }

  async function handleSignOut() {
    await auth.signOut()
  }

  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto flex max-w-xl flex-col gap-6 p-6 text-text">
        <header>
          <h1 className="text-[17px] font-semibold text-text">
            /dev/rol — Atajo de desarrollo
          </h1>
          <p className="mt-1 text-[13px] text-text-3">
            Solo en desarrollo: entrá con una cuenta real del seed de{' '}
            <code>App_dev</code> (misma sesión que va a usar `/ingresar` cuando
            exista, P06.3). La contraseña es la que Mike eligió en{' '}
            <code>SEED_DEV_PASSWORD</code> — no está guardada acá.
          </p>
        </header>

        {auth.status === 'authenticated' ? (
          <div className="flex flex-col gap-3 rounded-md border border-border-strong bg-surface p-4">
            <p className="text-[13px] text-text">
              Sesión iniciada como <strong>{auth.displayName}</strong>
              {auth.email && auth.email !== auth.displayName
                ? ` (${auth.email})`
                : ''}
              . Roles del JWT:{' '}
              {auth.roles.length > 0 ? auth.roles.join(', ') : 'ninguno'}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setGoTo(homePathForRoles(auth.roles) ?? '/sin-acceso')
                }
              >
                Ir a mi vía
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleSignOut()}
              >
                <LogOut /> Cerrar sesión
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="dev-rol-email">Email</Label>
              <Input
                id="dev-rol-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="maria.gomez@extendiendoservicios.com"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="dev-rol-password">Contraseña</Label>
              <Input
                id="dev-rol-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={error ?? undefined}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        )}

        <div
          className="flex flex-col gap-2"
          role="group"
          aria-label="Cuentas del seed (clic para completar el email)"
        >
          <p className="text-[11px] font-semibold tracking-[0.8px] text-text-3 uppercase">
            Cuentas del seed
          </p>
          {SEED_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => setEmail(account.email)}
              className={cn(
                'flex flex-col gap-[2px] rounded-md border px-4 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring',
                email === account.email
                  ? 'border-primary bg-primary-50'
                  : 'border-border-strong bg-surface hover:bg-bg',
              )}
            >
              <span className="text-[13px] font-semibold text-text">
                {account.label}
              </span>
              <span className="text-[11px] text-text-3">{account.email}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/ingresar">Ir a /ingresar (COM-01)</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">Ir a /admin</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/app">Ir a /app</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/sup">Ir a /sup</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/perfil">Ir a /perfil</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/dev/design">/dev/design</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}

export default DevRolePage
