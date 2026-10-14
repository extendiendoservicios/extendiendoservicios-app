import { CheckCircle2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { GeoStatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import type { AttendanceGeo } from '@/api/attendanceGeo'

/**
 * `AttendanceResultScreen` (módulo B1, B-03, B-37): lo que se muestra justo
 * después de fichar el inicio o el fin. La hora es la que devolvió el
 * servidor y la validación es la que calculó y guardó la base (no la que se
 * calculó en el celular para pintar el mapa). Sin coordenadas (B-40).
 */
export interface AttendanceResultScreenProps {
  /** «Inicio registrado» / «Fin registrado». */
  title: string
  /** Hora oficial que devolvió la RPC (`recorded_at`). */
  recordedAt: string
  geo: AttendanceGeo
  /** Cliente y sede, para que quede claro de qué fichaje se habla. */
  heading?: { primary: string; secondary?: string }
  onContinue: () => void
  continueLabel?: string
}

/** Explicación corta de lo que quedó guardado, según el resultado de la base. */
export function geoResultExplanation(geo: AttendanceGeo): string {
  if (geo.overridden) {
    return 'La administración revisó este registro y lo marcó como válido.'
  }
  if (geo.status === 'valid') {
    return 'Tu ubicación coincide con la zona del servicio.'
  }
  if (geo.status === 'outside') {
    return 'Quedó registrado fuera de la zona del servicio. El registro se hizo igual.'
  }
  switch (geo.reason) {
    case 'site_without_coords':
      return 'La sede todavía no tiene ubicación cargada, así que no se pudo validar. El registro se hizo igual.'
    case 'low_accuracy':
      return 'La señal de ubicación era poco precisa para validar. El registro se hizo igual.'
    case 'admin_record':
      return 'Lo registró la administración.'
    default:
      return 'No tuvimos tu ubicación, así que quedó sin validar. El registro se hizo igual.'
  }
}

export function AttendanceResultScreen({
  title,
  recordedAt,
  geo,
  heading,
  onContinue,
  continueLabel = 'Continuar',
}: AttendanceResultScreenProps) {
  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="attendance-result">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary">
          <CheckCircle2 aria-hidden="true" className="size-6" />
        </div>
        <h1 className="text-[16px] font-semibold text-text">{title}</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-[10px]">
          {heading && (
            <div className="flex flex-col gap-[2px]">
              <p className="text-[14px] font-semibold text-text">
                {heading.primary}
              </p>
              {heading.secondary && (
                <p className="text-[12px] text-text-3">{heading.secondary}</p>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-text-3">Hora registrada</span>
            <span className="text-[13px] font-semibold tabular-nums text-text">
              {formatTime(recordedAt)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-text-3">Ubicación</span>
            <GeoStatusBadge
              status={geo.status}
              reason={geo.reason}
              distanceM={geo.distanceM}
              showDistance={geo.status === 'outside' && !geo.overridden}
              corrected={geo.overridden}
            />
          </div>
          <p className="text-[12px] text-text-3">{geoResultExplanation(geo)}</p>
        </CardContent>
      </Card>

      <Button size="mobile" onClick={onContinue} className="mt-auto">
        {continueLabel}
      </Button>
    </div>
  )
}
