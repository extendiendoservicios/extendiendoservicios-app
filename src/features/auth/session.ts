import { useSyncExternalStore } from 'react'
import {
  getDevRoleSelection,
  sessionFromDevRoleSelection,
  subscribeDevRoleSelection,
} from './devRole'

/**
 * Sesión del cliente (AUTH-002/AUTH-008, adelanto provisorio para DS-015).
 *
 * `04_Modelo_de_Datos.md` sección 3: `app_role` tiene exactamente estos
 * cuatro valores. Una persona puede tener más de uno a la vez (P-007,
 * "acceso cruzado" de `07_Design_System.md` sección "Shells").
 */
export type Role = 'owner' | 'admin' | 'employee' | 'supervisor'

/**
 * Forma estable que va a devolver `useSession` en todas las fases: hoy la
 * completa `sessionFromDevRoleSelection` (sin red, sin Supabase); en F6
 * (AUTH-002) la va a completar `AuthProvider` a partir de
 * `supabase.auth.getSession()`/`onAuthStateChange` y de los claims del JWT
 * (`03_Plan_Maestro_Tecnico.md` sección 15, `06_API.md` sección 1). El tipo
 * ya incluye `'loading'` aunque la implementación provisoria nunca lo
 * produce (no hay ninguna llamada asíncrona todavía): así `RequireRole` y
 * los shells que ya lo manejan no van a necesitar ningún cambio cuando F6
 * empiece a usarlo de verdad.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; roles: Role[]; displayName: string }

/**
 * Etiquetas en español de cada rol (`04_Modelo_de_Datos.md`, tabla de
 * `app_role`: "Dueño, Administrador, Supervisor, Empleado"). Las usan los
 * shells para el pie de la sidebar, el menú de usuario y el menú "Más".
 */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  supervisor: 'Supervisor',
  employee: 'Empleado',
}

/**
 * `useSession` (DS-015): punto único que leen `RequireRole` y los shells
 * (`AdminShell`, `MobileShell`) para saber si hay sesión, qué rol tiene y
 * qué nombre mostrar. Ver `docs/design-system.md` ("Router y sesión
 * provisoria") para el contrato completo que P06.2 tiene que respetar al
 * reemplazar el cuerpo de esta función por el `AuthProvider` real:
 * `router.tsx`, `RequireRole` y los shells no cambian, solo esta
 * implementación.
 *
 * Hoy no hay ningún backend: el único origen de la sesión es el rol
 * simulado de `/dev/rol` (DS-015, exclusivo de `import.meta.env.DEV` — ver
 * `devRole.ts`). Sin un rol elegido, o fuera de desarrollo, no hay sesión:
 * toda ruta protegida redirige a `/ingresar`, igual que en producción y en
 * staging sin haber iniciado sesión.
 */
export function useSession(): SessionState {
  const devRoleSelection = useSyncExternalStore(
    subscribeDevRoleSelection,
    getDevRoleSelection,
    getDevRoleSelection,
  )
  return sessionFromDevRoleSelection(devRoleSelection)
}
