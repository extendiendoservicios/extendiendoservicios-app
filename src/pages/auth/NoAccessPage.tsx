import { Navigate } from 'react-router'
import { LogOut, Phone, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBranding } from '@/features/auth/useBranding'
import { RouteFallback } from '@/app/routes/RouteFallback'
import { AuthScreenLayout } from './AuthScreenLayout'

/**
 * COM-05 · Sin acceso / sesión desactivada (AUTH-006, `05` sección 3):
 * a dónde manda `RequireRole` a quien tiene sesión pero ningún rol —hoy,
 * en la práctica, solo "sin roles asignados": la desactivación de verdad
 * (`is_active = false`, `deactivate_user`) todavía no existe, F7. `Acciones:
 * auth.signOut()` — un botón, no un cierre automático: la persona ve el
 * mensaje y el teléfono de soporte antes de que la sesión se vaya.
 */
export default function NoAccessPage() {
  const auth = useAuth()
  const { branding } = useBranding()

  if (auth.status === 'loading') {
    return <RouteFallback />
  }

  if (auth.status === 'unauthenticated') {
    return <Navigate to="/ingresar" replace />
  }

  return (
    <AuthScreenLayout>
      <div className="flex flex-col items-center gap-3 text-center">
        <ShieldAlert aria-hidden="true" className="size-9 text-danger" />
        <h1 className="text-[19px] font-bold text-text">Sin acceso</h1>
        <p className="text-[13px] text-text-2">
          Tu cuenta no tiene ningún rol asignado en Extendiendo Servicios, o fue
          desactivada. Comunicate con Administración para resolverlo.
        </p>
      </div>

      {branding?.supportPhone && (
        <p className="flex items-center justify-center gap-2 text-[12px] text-text-2">
          <Phone
            aria-hidden="true"
            className="size-[15px] shrink-0 text-text-3"
          />
          <a
            href={`tel:${branding.supportPhone.replace(/[^\d+]/g, '')}`}
            className="font-semibold text-text"
          >
            {branding.supportPhone}
          </a>
        </p>
      )}

      <Button
        variant="ghost"
        size="mobile"
        icon={LogOut}
        onClick={() => void auth.signOut()}
      >
        Cerrar sesión
      </Button>
    </AuthScreenLayout>
  )
}
