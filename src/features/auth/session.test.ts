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

  it('admin además de empleado, en escritorio: gana /admin (primer caso, explícito)', () => {
    expect(homePathForRoles(['admin', 'employee'], true)).toBe('/admin')
  })

  it('admin además de empleado, en celular: gana /app (el ancho decide)', () => {
    expect(homePathForRoles(['admin', 'employee'], false)).toBe('/app')
  })

  it('admin sin ningún otro rol, en celular: igual va a /admin (no tiene otra vía)', () => {
    expect(homePathForRoles(['admin'], false)).toBe('/admin')
  })

  it('admin además de supervisor, en celular: gana /sup', () => {
    expect(homePathForRoles(['admin', 'supervisor'], false)).toBe('/sup')
  })
})
