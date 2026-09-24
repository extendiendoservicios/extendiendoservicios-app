import * as React from 'react'
import {
  NominatimRateLimitError,
  type NominatimResult,
  RateLimiter,
  searchAddress,
} from './nominatimClient'

export type AddressSearchStatus = 'idle' | 'loading' | 'success' | 'error'

/**
 * Estado del botón "Buscar dirección" de `MapPicker` (SITE-004): una
 * consulta por clic (nunca por tecla, `ADR-017`), con el limitador de
 * Nominatim compartido entre pedidos de esta misma instancia. Separado del
 * componente visual para poder testearlo sin montar Leaflet.
 */
export function useAddressSearch() {
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState<AddressSearchStatus>('idle')
  const [results, setResults] = React.useState<NominatimResult[]>([])
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const limiterRef = React.useRef<RateLimiter>(null)
  if (limiterRef.current === null) {
    limiterRef.current = new RateLimiter()
  }

  async function search() {
    if (query.trim() === '') {
      setStatus('error')
      setErrorMessage('Escribí una dirección para buscar.')
      return
    }

    setStatus('loading')
    setErrorMessage(null)

    try {
      const found = await searchAddress(query, {
        limiter: limiterRef.current as RateLimiter,
      })
      setResults(found)
      setStatus('success')
      if (found.length === 0) {
        setErrorMessage('No se encontró ninguna dirección con ese texto.')
      }
    } catch (error) {
      setResults([])
      setStatus('error')
      setErrorMessage(
        error instanceof NominatimRateLimitError
          ? error.message
          : 'No se pudo buscar la dirección. Probá de nuevo.',
      )
    }
  }

  function reset() {
    setResults([])
    setStatus('idle')
    setErrorMessage(null)
  }

  return { query, setQuery, status, results, errorMessage, search, reset }
}
