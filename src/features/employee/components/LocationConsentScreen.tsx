import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

/**
 * `LocationConsentScreen` (EMP-06, MOB-EMP-006, ADR-009, P-067, P-091,
 * P-108): explica por qué la aplicación pide la ubicación y deja elegir
 * "Aceptar y continuar" o "Continuar sin ubicación". Puramente de
 * presentación (sin `supabase`, sin `useAuth`, sin navegación): quien la
 * usa (`LocationConsentPage`, EMP-06 del empleado; SUP-04 del supervisor en
 * F15) resuelve el guardado de `location_consent_at`, el pedido real del
 * permiso del navegador y a dónde ir después — así el mismo componente
 * sirve para las dos vías sin acoplarse a ninguna.
 *
 * El orden real (P-091, `05` fila EMP-06: "El permiso del navegador se pide
 * después de aceptar") lo respeta quien llama a `onAccept`, no este
 * componente: acá solo hay dos botones y un texto.
 */
export interface LocationConsentScreenProps {
  /** `company_settings.location_consent_text`, con sus saltos de línea (párrafos) respetados. `null`/vacío → texto de reserva. */
  consentText: string | null
  onAccept: () => void
  onSkip: () => void
  /** `true` mientras se guarda el consentimiento (deshabilita los dos botones para evitar un doble toque). */
  busy?: boolean
  /** `true` sin conexión (`useOnlineStatus`): ninguna de las dos acciones puede escribir en la Base. */
  offline?: boolean
}

const FALLBACK_TEXT =
  'Para registrar el inicio y el fin de tu turno, la aplicación puede guardar tu ubicación en ese momento. Es opcional: podés seguir usándola igual sin darla.'

export function LocationConsentScreen({
  consentText,
  onAccept,
  onSkip,
  busy = false,
  offline = false,
}: LocationConsentScreenProps) {
  const text = consentText?.trim() ? consentText : FALLBACK_TEXT
  const disabled = busy || offline

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col items-center gap-3 pt-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary">
          <MapPin aria-hidden="true" className="size-6" />
        </div>
        <h1 className="text-[16px] font-semibold text-text">
          Tu ubicación al fichar
        </h1>
      </div>

      {/* `whitespace-pre-line` respeta los saltos de línea del texto cargado
          por la empresa (párrafos separados por líneas en blanco), sin que
          haga falta partirlo a mano en varios `<p>`. */}
      <p className="text-[13px] leading-[1.5] whitespace-pre-line text-text-2">
        {text}
      </p>

      {offline && (
        <Alert variant="warn">
          <AlertDescription>
            Estás sin conexión. Conectate para continuar.
          </AlertDescription>
        </Alert>
      )}

      <div className="mt-auto flex flex-col gap-[9px] pt-4">
        <Button
          size="mobile"
          onClick={onAccept}
          loading={busy}
          disabled={disabled}
        >
          Aceptar y continuar
        </Button>
        <Button
          size="mobile"
          variant="ghost"
          onClick={onSkip}
          disabled={disabled}
        >
          Continuar sin ubicación
        </Button>
      </div>
    </div>
  )
}
