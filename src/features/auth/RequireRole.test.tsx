import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { RequireRole } from './RequireRole'
import * as sessionModule from './session'
import type { Role, SessionState } from './session'

function renderProtectedRoute(session: SessionState, allow: Role[]) {
  vi.spyOn(sessionModule, 'useSession').mockReturnValue(session)

  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/ingresar" element={<p>Pantalla de ingreso</p>} />
        <Route path="/sin-acceso" element={<p>Sin acceso</p>} />
        <Route
          path="/admin"
          element={
            <RequireRole allow={allow}>
              <p>Contenido protegido</p>
            </RequireRole>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireRole', () => {
  it('sin sesión redirige a /ingresar', () => {
    renderProtectedRoute({ status: 'unauthenticated' }, ['owner', 'admin'])

    expect(screen.getByText('Pantalla de ingreso')).toBeInTheDocument()
    expect(screen.queryByText('Contenido protegido')).not.toBeInTheDocument()
  })

  it('con un rol que no corresponde redirige a /sin-acceso', () => {
    renderProtectedRoute(
      { status: 'authenticated', roles: ['employee'], displayName: 'María' },
      ['owner', 'admin'],
    )

    expect(screen.getByText('Sin acceso')).toBeInTheDocument()
    expect(screen.queryByText('Contenido protegido')).not.toBeInTheDocument()
  })

  it('con el rol correcto muestra el contenido protegido', () => {
    renderProtectedRoute(
      { status: 'authenticated', roles: ['admin'], displayName: 'Andrea' },
      ['owner', 'admin'],
    )

    expect(screen.getByText('Contenido protegido')).toBeInTheDocument()
  })

  it('acepta a quien tiene más de un rol si alguno está permitido', () => {
    renderProtectedRoute(
      {
        status: 'authenticated',
        roles: ['employee', 'supervisor'],
        displayName: 'María',
      },
      ['supervisor'],
    )

    expect(screen.getByText('Contenido protegido')).toBeInTheDocument()
  })
})
