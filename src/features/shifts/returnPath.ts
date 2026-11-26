/**
 * P33.1 (D-04, P34.2 D-11): dirección a la que vuelve «Nuevo turno» cuando se
 * llegó desde la ficha de un empleado o de un cliente. Solo se acepta una
 * dirección interna de esas fichas; cualquier otra cosa se ignora y el
 * formulario sale como siempre.
 */
const ALLOWED_PREFIXES = ['/admin/empleados/', '/admin/clientes/']

export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || !ALLOWED_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
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

/**
 * P34.2 (D-11): enlace del «+» del calendario de la ficha del cliente. Lleva
 * `fecha`, `cliente`, `sede` y `empleado` (si hay filtro) y `volver` (la
 * dirección actual de la ficha, con el mes mostrado).
 */
export function newShiftFromClientPath(input: {
  date: string
  clientId: string
  siteId?: string
  employeeId?: string
  pathname: string
  search: string
  monthKey: string
}): string {
  const current = new URLSearchParams(input.search)
  if (!current.has('pestana')) {
    current.set('pestana', 'calendario')
  }
  if (!current.has('mes')) {
    current.set('mes', input.monthKey)
  }
  const back = `${input.pathname}?${current.toString()}`
  const params = new URLSearchParams({
    fecha: input.date,
    cliente: input.clientId,
  })
  if (input.siteId) {
    params.set('sede', input.siteId)
  }
  if (input.employeeId) {
    params.set('empleado', input.employeeId)
  }
  params.set('volver', back)
  return `/admin/turnos/nuevo?${params.toString()}`
}
