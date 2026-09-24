import { MapPin, Phone } from 'lucide-react'
import { buildMapsUrl } from '../mapsLink'

/**
 * SITE-010: datos de una sede para quien trabaja ahí (dirección,
 * indicaciones de acceso, restricciones informativas y contacto útil), sin
 * nada que dependa de tablas que el empleado o el supervisor no puedan leer
 * por RLS — todas estas columnas son de `sites`, y `sites_select_shift_
 * party` (`0012_rls_policies.sql`) les da la fila completa de la sede de su
 * turno. No incluye nada del cliente (nombre, contactos): quien usa este
 * componente ya lo muestra aparte con los datos que su propia pantalla trae
 * (EMP-04, SUP-03).
 */
export interface SiteInfoData {
  address: string
  city: string | null
  latitude: number | null
  longitude: number | null
  contactName: string | null
  contactPhone: string | null
  accessInstructions: string | null
  buildingHours: string | null
  phoneRestricted: boolean
  photosNotAllowed: boolean
  restrictionsNotes: string | null
}

/**
 * Reutilizable entre `front-admin` (ADM-22) y `front-movil` (EMP-04, SUP-03,
 * fuera de este paquete): solo lectura, sin ninguna llamada propia a la
 * base — quien lo usa le pasa los datos que ya haya traído su pantalla.
 */
export function SiteInfo({ site }: { site: SiteInfoData }) {
  const mapsUrl = buildMapsUrl(site)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[13px] text-text">
          {site.address}
          {site.city ? `, ${site.city}` : ''}
        </p>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary-800 hover:underline"
        >
          <MapPin className="size-3.5" aria-hidden="true" />
          Abrir en el mapa
        </a>
      </div>

      {site.buildingHours && (
        <p className="text-[12px] text-text-2">
          <span className="font-semibold">Horario del edificio: </span>
          {site.buildingHours}
        </p>
      )}

      {site.accessInstructions && (
        <p className="text-[12px] text-text-2">
          <span className="font-semibold">Instrucciones de acceso: </span>
          {site.accessInstructions}
        </p>
      )}

      {(site.phoneRestricted ||
        site.photosNotAllowed ||
        site.restrictionsNotes) && (
        <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-[12px] text-text">
          <p className="font-semibold">Restricciones de la sede</p>
          <ul className="mt-1 list-disc pl-4">
            {site.phoneRestricted && <li>No usar el teléfono en la sede.</li>}
            {site.photosNotAllowed && <li>No se permiten fotos.</li>}
            {site.restrictionsNotes && <li>{site.restrictionsNotes}</li>}
          </ul>
        </div>
      )}

      {(site.contactName || site.contactPhone) && (
        <div className="text-[12px] text-text-2">
          <p className="font-semibold text-text">Contacto en la sede</p>
          {site.contactName && <p>{site.contactName}</p>}
          {site.contactPhone && (
            <a
              href={`tel:${site.contactPhone}`}
              className="inline-flex items-center gap-1 font-semibold text-primary-800 hover:underline"
            >
              <Phone className="size-3.5" aria-hidden="true" />
              {site.contactPhone}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
