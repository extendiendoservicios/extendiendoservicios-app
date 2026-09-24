import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NominatimRateLimitError,
  RateLimiter,
  searchAddress,
} from './nominatimClient'

describe('RateLimiter', () => {
  it('permite el primer pedido', () => {
    const limiter = new RateLimiter(1000)
    expect(() => limiter.check(() => 0)).not.toThrow()
  })

  it('rechaza un segundo pedido antes de que pase el intervalo mínimo', () => {
    const limiter = new RateLimiter(1000)
    limiter.check(() => 0)
    expect(() => limiter.check(() => 500)).toThrow(NominatimRateLimitError)
  })

  it('permite un segundo pedido una vez que pasó el intervalo mínimo', () => {
    const limiter = new RateLimiter(1000)
    limiter.check(() => 0)
    expect(() => limiter.check(() => 1000)).not.toThrow()
  })
})

describe('searchAddress', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('arma la URL con countrycodes=ar, accept-language=es y un límite bajo', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    })
    const limiter = new RateLimiter()

    await searchAddress('Av. Centenario 1450, San Isidro', {
      limiter,
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [calledUrl] = fetchImpl.mock.calls[0] as [string]
    const url = new URL(calledUrl)
    expect(url.origin + url.pathname).toBe(
      'https://nominatim.openstreetmap.org/search',
    )
    expect(url.searchParams.get('countrycodes')).toBe('ar')
    expect(url.searchParams.get('accept-language')).toBe('es')
    expect(url.searchParams.get('format')).toBe('jsonv2')
    expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(5)
    expect(url.searchParams.get('email')).toBeTruthy()
  })

  it('devuelve los resultados con lat/lng numéricos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            lat: '-34.6037',
            lon: '-58.3816',
            display_name: 'Av. Centenario 1450, San Isidro, Buenos Aires',
          },
        ]),
    })

    const result = await searchAddress('San Isidro', {
      limiter: new RateLimiter(),
      fetchImpl,
    })

    expect(result).toEqual([
      {
        lat: -34.6037,
        lng: -58.3816,
        displayName: 'Av. Centenario 1450, San Isidro, Buenos Aires',
      },
    ])
  })

  it('no llama a fetch si la búsqueda está vacía', async () => {
    const fetchImpl = vi.fn()

    const result = await searchAddress('   ', {
      limiter: new RateLimiter(),
      fetchImpl,
    })

    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('respeta el límite de un pedido por segundo entre dos búsquedas', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const limiter = new RateLimiter(1000)
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    await searchAddress('primera dirección', {
      limiter,
      fetchImpl,
    })

    now = 200 // menos de un segundo después
    await expect(
      searchAddress('segunda dirección', {
        limiter,
        fetchImpl,
      }),
    ).rejects.toThrow(NominatimRateLimitError)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('tira un error legible cuando la respuesta no es exitosa', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, json: () => Promise.resolve([]) })

    await expect(
      searchAddress('dirección inexistente', {
        limiter: new RateLimiter(),
        fetchImpl,
      }),
    ).rejects.toThrow('No se pudo consultar Nominatim')
  })
})
