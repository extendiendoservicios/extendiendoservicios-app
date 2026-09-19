import type { Role, SessionState } from './session'

/**
 * Simulador de rol para desarrollo (DS-015, "Solo en desarrollo... agregá
 * una forma de simular un rol para recorrer los shells").
 *
 * Nada de esto se usa fuera de `import.meta.env.DEV`: `getDevRoleSelection`
 * devuelve siempre `'none'` (sin sesión) apenas se compila para producción
 * o staging, antes de tocar `localStorage` — así, en cualquier build real
 * (`pnpm build`), `useSession` (`session.ts`) resuelve siempre a
 * `unauthenticated` sin depender de que nadie haya registrado `/dev/rol` en
 * el router. La página `/dev/rol` (`src/pages/dev/DevRole.tsx`) es la única
 * que llama a `setDevRoleSelection`, y el router la registra igual que
 * `/dev/design`, detrás de `if (import.meta.env.DEV)`: no queda en
 * `dist/` (verificado en este encargo).
 */
export type DevRoleSelection =
  'none' | 'owner' | 'admin' | 'employee' | 'supervisor' | 'employee_supervisor'

const STORAGE_KEY = 'es-dev-role'
const CHANGE_EVENT = 'es:dev-role-change'

const VALID_SELECTIONS: DevRoleSelection[] = [
  'none',
  'owner',
  'admin',
  'employee',
  'supervisor',
  'employee_supervisor',
]

function isDevRoleSelection(value: string | null): value is DevRoleSelection {
  return value !== null && VALID_SELECTIONS.includes(value as DevRoleSelection)
}

/** Lectura sincrónica actual (para `useSyncExternalStore`). */
export function getDevRoleSelection(): DevRoleSelection {
  if (!import.meta.env.DEV) {
    return 'none'
  }
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isDevRoleSelection(stored) ? stored : 'none'
}

/** Solo la llama `/dev/rol`. Notifica a `useSession` en la misma pestaña. */
export function setDevRoleSelection(selection: DevRoleSelection): void {
  if (!import.meta.env.DEV) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, selection)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** El evento de `storage` nativo no llega a la misma pestaña que escribe. */
export function subscribeDevRoleSelection(onChange: () => void): () => void {
  if (!import.meta.env.DEV) {
    return () => {}
  }
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Nombres de ejemplo (mismas personas que el mockup: D01, M02, M04). */
const DEV_ROLE_SESSIONS: Record<
  Exclude<DevRoleSelection, 'none'>,
  { roles: Role[]; displayName: string }
> = {
  owner: { roles: ['owner'], displayName: 'Andrea Ríos' },
  admin: { roles: ['admin'], displayName: 'Andrea Ríos' },
  employee: { roles: ['employee'], displayName: 'María Gómez' },
  supervisor: { roles: ['supervisor'], displayName: 'Paula Lemos' },
  employee_supervisor: {
    roles: ['employee', 'supervisor'],
    displayName: 'María Gómez',
  },
}

export function sessionFromDevRoleSelection(
  selection: DevRoleSelection,
): SessionState {
  if (selection === 'none') {
    return { status: 'unauthenticated' }
  }
  const { roles, displayName } = DEV_ROLE_SESSIONS[selection]
  return { status: 'authenticated', roles, displayName }
}
