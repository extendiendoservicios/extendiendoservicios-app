import { describe, expect, it } from 'vitest'
import { homePathForRoles } from './session'

/**
 * `homePathForRoles` (AUTH-004/AUTH-008, comentario grande de `session.ts`): pura, sin React —
 * hasta P06.4 no tenía un test propio (`LoginPage.test.tsx` y `RequireRole.test.tsx` la ejercitan
 * de paso, pero ninguno cubre las cinco combinaciones que describe su propio comentario). Cubre
 * TEST-003 (08_Fases_y_Backlog.md F6, "Unitarios de AuthProvider... claims → roles").
 */
describe('homePathForRoles', () => {
  it('sin ningún rol, no hay vía propia', () => {
    expect(homePathForRoles([])).toBeNull()
  })

  it('owner o admin, en escritorio (por omisión), van a /admin', () => {
    expect(homePathForRoles(['owner'])).toBe('/admin')
    expect(homePathForRoles(['admin'])).toBe('/admin')
  })

  it('empleado va a /app', () => {
    expect(homePathForRoles(['employee'])).toBe('/app')
  })

  it('supervisor va a /sup', () => {
    expect(homePathForRoles(['supervisor'])).toBe('/sup')
  })

  it('empleado y supervisor a la vez: gana /app (el acceso a supervisión queda en Más)', () => {
    expect(homePathForRoles(['employee', 'supervisor'])).toBe('/app')
  })

  it('owner o admin además de empleado: siempre /admin, también en celular (OG-06)', () => {
    expect(homePathForRoles(['admin', 'employee'])).toBe('/admin')
    expect(homePathForRoles(['owner', 'employee'])).toBe('/admin')
  })

  it('admin además de coordinador: /admin', () => {
    expect(homePathForRoles(['admin', 'supervisor'])).toBe('/admin')
  })

  it('owner con los tres roles: /admin', () => {
    expect(homePathForRoles(['owner', 'employee', 'supervisor'])).toBe('/admin')
  })
})
