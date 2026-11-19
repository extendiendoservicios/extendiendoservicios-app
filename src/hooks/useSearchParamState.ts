import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/**
 * OH-03: estado de pantalla guardado en la dirección (`?mes=2027-01`).
 *
 * Mes, vista, pestaña y filtros viven en la URL en vez de un `useState`, así
 * «Volver» (o el botón atrás del navegador) regresa a la pantalla tal como
 * estaba. Cambiar el valor usa `replace`: no agrega una entrada al historial
 * por cada mes o filtro que se prueba. Los demás parámetros de la dirección se
 * conservan. Si el valor es el de por defecto, el parámetro se quita para que
 * la dirección quede limpia.
 *
 * - `parse` convierte el texto de la dirección en el valor; si devuelve
 *   `undefined` (texto inválido, editado a mano) se usa el valor por defecto.
 * - `serialize` hace el camino inverso. Por defecto, `String(valor)`.
 *
 * Sin `parse`/`serialize` el estado es un texto.
 */
export interface SearchParamCodec<T> {
  parse: (raw: string) => T | undefined
  serialize?: (value: T) => string
}

type SetSearchParamState<T> = (
  next: T | ((current: T) => T),
  options?: { replace?: boolean },
) => void

export function useSearchParamState(
  key: string,
  defaultValue: string,
): [string, SetSearchParamState<string>]
export function useSearchParamState<T>(
  key: string,
  defaultValue: T,
  codec: SearchParamCodec<T>,
): [T, SetSearchParamState<T>]
export function useSearchParamState<T>(
  key: string,
  defaultValue: T,
  codec?: SearchParamCodec<T>,
): [T, SetSearchParamState<T>] {
  const [searchParams, setSearchParams] = useSearchParams()
  // DEF-P30-01: react-router le pasa al setter funcional la dirección del
  // último render. Con dos cambios seguidos antes de que se vuelva a dibujar,
  // el segundo partía de la dirección vieja. Se guarda la última dirección
  // escrita hasta que el render la refleje.
  const written = useRef<URLSearchParams | null>(null)
  useEffect(() => {
    written.current = null
  }, [searchParams])

  const read = (raw: string | null): T => {
    if (raw === null) {
      return defaultValue
    }
    return codec ? (codec.parse(raw) ?? defaultValue) : (raw as T)
  }
  const serialize = (input: T): string =>
    codec?.serialize ? codec.serialize(input) : String(input)

  // El setter no es estable entre renders (depende de `codec`, que suele ser
  // un objeto literal): no usarlo como dependencia de efectos.
  const setValue: SetSearchParamState<T> = (next, options) => {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(written.current ?? previous)
        const nextValue =
          typeof next === 'function'
            ? (next as (current: T) => T)(read(params.get(key)))
            : next
        const nextRaw = serialize(nextValue)
        if (nextRaw === serialize(defaultValue)) {
          params.delete(key)
        } else {
          params.set(key, nextRaw)
        }
        written.current = new URLSearchParams(params)
        return params
      },
      { replace: options?.replace ?? true },
    )
  }

  return [read(searchParams.get(key)), setValue]
}
