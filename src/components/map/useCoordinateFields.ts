import * as React from 'react'
import {
  type Coordinates,
  coordinatesEqual,
  formatCoordinate,
  isValidLat,
  isValidLng,
  parseCoordinateInput,
} from './coordinates'

/**
 * Sincronización entre los campos de texto de latitud/longitud y el valor
 * controlado `{ lat, lng } | null` de `MapPicker` (SITE-004). Separado del
 * componente visual para poder testearlo sin montar Leaflet.
 *
 * - Escribir en cualquiera de los dos campos actualiza el otro estado en
 *   cuanto los dos valores son números válidos y en rango; hasta entonces
 *   no se llama a `onChange` (para no mandar un valor a medio escribir) y
 *   se muestra el error debajo del campo que corresponda.
 * - Dejar los dos campos vacíos manda `null` (coordenadas opcionales,
 *   se pueden borrar).
 * - `setCoordinates` es la vía para los cambios que no vienen de estos
 *   campos (clic o arrastre del marcador, resultado de "Buscar dirección"):
 *   pisa los dos campos con el valor nuevo.
 * - Si `value` cambia desde afuera (por ejemplo, el formulario se resetea)
 *   los campos se actualizan solos.
 */
export function useCoordinateFields(
  value: Coordinates | null,
  onChange: (value: Coordinates | null) => void,
) {
  const [latText, setLatText] = React.useState(
    value ? formatCoordinate(value.lat) : '',
  )
  const [lngText, setLngText] = React.useState(
    value ? formatCoordinate(value.lng) : '',
  )
  const lastValueRef = React.useRef(value)

  React.useEffect(() => {
    if (coordinatesEqual(value, lastValueRef.current)) return
    lastValueRef.current = value
    setLatText(value ? formatCoordinate(value.lat) : '')
    setLngText(value ? formatCoordinate(value.lng) : '')
  }, [value])

  function commit(nextLatText: string, nextLngText: string) {
    const latEmpty = nextLatText.trim() === ''
    const lngEmpty = nextLngText.trim() === ''

    if (latEmpty && lngEmpty) {
      lastValueRef.current = null
      onChange(null)
      return
    }

    const lat = parseCoordinateInput(nextLatText)
    const lng = parseCoordinateInput(nextLngText)

    if (
      lat !== undefined &&
      lng !== undefined &&
      isValidLat(lat) &&
      isValidLng(lng)
    ) {
      const next = { lat, lng }
      lastValueRef.current = next
      onChange(next)
    }
    // Campo vacío a medias, no numérico o fuera de rango: no se avisa
    // todavía a `onChange`; el error se calcula más abajo a partir del
    // propio texto y se muestra debajo del campo.
  }

  function handleLatChange(raw: string) {
    setLatText(raw)
    commit(raw, lngText)
  }

  function handleLngChange(raw: string) {
    setLngText(raw)
    commit(latText, raw)
  }

  /** Para los cambios que no vienen de los campos de texto (mapa, búsqueda). */
  function setCoordinates(next: Coordinates | null) {
    lastValueRef.current = next
    setLatText(next ? formatCoordinate(next.lat) : '')
    setLngText(next ? formatCoordinate(next.lng) : '')
    onChange(next)
  }

  function clear() {
    setCoordinates(null)
  }

  const latValue = parseCoordinateInput(latText)
  const lngValue = parseCoordinateInput(lngText)

  const latError =
    latText.trim() !== '' && (latValue === undefined || !isValidLat(latValue))
      ? 'Tiene que ser un número entre -90 y 90.'
      : undefined

  const lngError =
    lngText.trim() !== '' && (lngValue === undefined || !isValidLng(lngValue))
      ? 'Tiene que ser un número entre -180 y 180.'
      : undefined

  return {
    latText,
    lngText,
    latError,
    lngError,
    handleLatChange,
    handleLngChange,
    setCoordinates,
    clear,
  }
}
