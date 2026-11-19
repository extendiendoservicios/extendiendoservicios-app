/**
 * DEF-P30-05: hora escrita con el teclado en las casillas del calendario y de
 * la pizarra. Acepta «0830», «830», «8:30», «8.30», «8h30», «8» (= 08:00) y
 * «08:30». Devuelve `HH:MM` o `null` si no se entiende o está fuera de rango.
 */
export function parseTypedTime(raw: string): string | null {
  const text = raw.trim().toLowerCase()
  let hours: string
  let minutes: string
  const separated = /^(\d{1,2})[:.,h](\d{1,2})$/.exec(text)
  if (separated) {
    hours = separated[1] as string
    minutes = (separated[2] as string).padStart(2, '0')
  } else if (/^\d{1,4}$/.test(text)) {
    if (text.length <= 2) {
      hours = text
      minutes = '00'
    } else {
      hours = text.slice(0, -2)
      minutes = text.slice(-2)
    }
  } else {
    return null
  }
  const h = Number(hours)
  const m = Number(minutes)
  if (h > 23 || m > 59) {
    return null
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Normaliza lo escrito a `HH:MM`; si no se entiende devuelve el texto tal cual
 * para que la pantalla muestre su propio aviso de hora inválida.
 */
export function normalizeTypedTime(raw: string): string {
  return parseTypedTime(raw) ?? raw.trim()
}
