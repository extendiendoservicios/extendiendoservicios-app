import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { GeofenceMiniMap } from '@/components/map'
import {
  OUTSIDE_REASON_MAX_LENGTH,
  secondsLeft,
} from '@/features/employee/liveGeo'
import type { GeoFichaje } from '@/features/employee/useGeoFichaje'

/**
 * `GeoFichajePanel` (módulo B1, B-04, B-06, B-18): lo que se ve al fichar con
 * ubicación, en EMP-05 (inicio), EMP-10 (fin) y SUP-04 -- el mini mapa con la
 * sede (círculo verde, rojo o gris en vivo), el punto propio con su círculo
 * de precisión, la precisión en vivo, «Esperar mejor señal» con cuenta
 * regresiva y, si el resultado en vivo es «Fuera de zona», el motivo
 * opcional. Es solo presentación: el estado vive en `useGeoFichaje`.
 *
 * Privacidad (B-40): la posición propia solo se ve acá, en vivo mientras se
 * ficha; las coordenadas nunca se escriben como texto.
 */
export interface GeoFichajePanelProps {
  fichaje: GeoFichaje
  /** Sede para el mapa. `null` = sede sin coordenadas: no hay mapa. */
  site: { lat: number; lng: number; name: string } | null
  /** Deshabilita los controles mientras se registra. */
  busy?: boolean
}

export function GeoFichajePanel({
  fichaje,
  site,
  busy = false,
}: GeoFichajePanelProps) {
  const { live, view, reasonText, setReasonText } = fichaje

  return (
    <div className="flex flex-col gap-3" data-testid="geo-panel">
      {view.enabled && site && (
        <GeofenceMiniMap
          site={{
            lat: site.lat,
            lng: site.lng,
            radiusM: view.radiusM,
            name: site.name,
          }}
          position={live.position}
          status={view.mapStatus}
          height={220}
        />
      )}

      {view.accuracyLabel && (
        <p
          className="text-center text-[12.5px] font-semibold text-text-2"
          data-testid="geo-accuracy"
        >
          {view.accuracyLabel}
        </p>
      )}

      {view.message && (
        <Alert
          variant={view.message.tone === 'warn' ? 'warn' : 'info'}
          data-testid="geo-message"
        >
          <AlertDescription>{view.message.text}</AlertDescription>
        </Alert>
      )}

      {view.canOfferWait && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-text-3">
            La señal todavía es poco precisa. Podés esperar hasta 30 segundos a
            que mejore, o registrar igual.
          </p>
          <Button
            size="mobile"
            variant="ghost"
            onClick={live.startWait}
            disabled={busy}
          >
            Esperar mejor señal
          </Button>
        </div>
      )}
      {view.waiting && (
        <p className="text-center text-[12.5px] text-text-2" role="status">
          Esperando mejor señal… {secondsLeft(live.waitRemainingMs)} s
        </p>
      )}
      {view.waitExpired && (
        <p className="text-center text-[12px] text-text-3" role="status">
          Terminó la espera. Podés registrar igual.
        </p>
      )}

      {view.showOutsideReason && (
        <div className="flex flex-col gap-[6px]">
          <label
            htmlFor="outside-reason"
            className="text-[12.5px] font-semibold text-text"
          >
            ¿Por qué estás fuera de la zona? (opcional)
          </label>
          <Textarea
            id="outside-reason"
            mobile
            rows={3}
            maxLength={OUTSIDE_REASON_MAX_LENGTH}
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            placeholder="Por ejemplo: el GPS no anda en el subsuelo"
            disabled={busy}
          />
          <p className="self-end text-[11px] text-text-3">
            {reasonText.length}/{OUTSIDE_REASON_MAX_LENGTH}
          </p>
        </div>
      )}
    </div>
  )
}
