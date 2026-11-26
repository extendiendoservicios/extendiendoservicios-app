/**
 * P33.1 (D-04): dirección a la que vuelve «Nuevo turno» cuando se llegó desde
 * la ficha de un empleado. Solo se acepta una dirección interna de empleados;
 * cualquier otra cosa se ignora y el formulario sale como siempre.
 */
const EMPLOYEES_PREFIX = '/admin/empleados/'

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith(EMPLOYEES_PREFIX)) {
    return null
  }
  const hasControlChar = Array.from(raw).some((char) => char.charCodeAt(0) < 32)
  if (raw.includes('//') || raw.includes('\\') || hasControlChar) {
    return null
  }
  return raw
}

/**
 * Enlace de «Agregar turno» desde el calendario de la ficha: lleva `fecha`,
 * `empleado` y `volver` (la dirección actual, con el mes mostrado).
 */
export function newShiftFromEmployeePath(input: {
  date: string
  profileId: string
  pathname: string
  search: string
  monthKey: string
}): string {
  const current = new URLSearchParams(input.search)
  if (!current.has('mes')) {
    current.set('mes', input.monthKey)
  }
  const back = `${input.pathname}?${current.toString()}`
  const params = new URLSearchParams({
    fecha: input.date,
    empleado: input.profileId,
    volver: back,
  })
  return `/admin/turnos/nuevo?${params.toString()}`
}
