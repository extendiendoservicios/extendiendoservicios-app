import { tz } from '@date-fns/tz'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { brandingLogoUrl } from '@/features/auth/useBranding'
import { useCompanySettingsQuery } from '@/features/settings/queries'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'

/** «8 de octubre de 2026, 14:05» en hora de Argentina. */
export function formatIssuedAt(date: Date): string {
  return format(date, "d 'de' MMMM 'de' yyyy, HH:mm", {
    locale: es,
    in: tz(BUENOS_AIRES_TIME_ZONE),
  })
}

interface PrintableLetterheadProps {
  /** Título del documento, p. ej. «Detalle de asistencia». */
  title: string
  /** Momento de emisión (inyectable para los tests). */
  issuedAt: Date
}

/**
 * Membrete de las hojas imprimibles (AJ-06 y AJ-09): logo y nombre de la
 * empresa (`company_settings` y el bucket público `branding`), el título del
 * documento y la fecha de emisión. Reutilizable por cualquier hoja nueva.
 * Mientras carga la configuración (o si falla) muestra solo el título, sin
 * inventar una marca.
 */
function PrintableLetterhead({ title, issuedAt }: PrintableLetterheadProps) {
  const settingsQuery = useCompanySettingsQuery()
  const settings = settingsQuery.data
  const logoUrl = settings?.logoPath ? brandingLogoUrl(settings.logoPath) : null

  return (
    <header className="print-keep-together mb-4 flex items-start justify-between gap-4 border-b-2 border-black pb-3">
      <div className="flex min-w-0 items-center gap-3">
        {logoUrl && (
          <img
            src={logoUrl}
            alt={settings?.name ? `Logo de ${settings.name}` : 'Logo'}
            className="h-14 w-auto max-w-[40mm] object-contain"
          />
        )}
        <div className="min-w-0">
          <p className="text-[16px] font-bold text-black">
            {settings?.name ?? 'Extendiendo Servicios'}
          </p>
          {settings?.supportPhone && (
            <p className="text-[11px] text-neutral-700">
              Tel. {settings.supportPhone}
            </p>
          )}
        </div>
      </div>
      <div className="text-right">
        <h1 className="text-[16px] font-bold text-black">{title}</h1>
        <p className="text-[11px] text-neutral-700">
          Emitido el {formatIssuedAt(issuedAt)}
        </p>
      </div>
    </header>
  )
}

export { PrintableLetterhead }
