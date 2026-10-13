import { describe, expect, it } from 'vitest'
import headers from '../../public/_headers?raw'

/**
 * Regresión de `public/_headers`: las e2e corren sobre Vite, que no sirve este
 * archivo, así que una CSP o una Permissions-Policy mal puestas (cámara
 * bloqueada, videos que no se reproducen) solo se notaban en staging.
 */

function headerValue(name: string): string {
  const line = headers
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${name}:`))
  if (!line) throw new Error(`Falta la cabecera ${name} en public/_headers`)
  return line.slice(name.length + 1).trim()
}

function cspDirective(name: string): string[] {
  const directive = headerValue('Content-Security-Policy')
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
  if (!directive) throw new Error(`Falta la directiva ${name} en la CSP`)
  return directive.split(/\s+/).slice(1)
}

const SUPABASE_HOSTS = [
  'https://anesttvrnpsaaaxaquce.supabase.co',
  'https://fysuppdadwvabrjpnnoh.supabase.co',
]

describe('public/_headers', () => {
  it('la CSP permite reproducir videos (media-src con blob: y Supabase)', () => {
    const sources = cspDirective('media-src')
    expect(sources).toContain("'self'")
    expect(sources).toContain('blob:')
    for (const host of SUPABASE_HOSTS) expect(sources).toContain(host)
  })

  it('Permissions-Policy habilita cámara y micrófono para el propio sitio', () => {
    const policy = headerValue('Permissions-Policy')
      .split(',')
      .map((p) => p.trim())
    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('microphone=(self)')
  })
})
