import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { decodeAccessTokenClaims, type Capability } from './claims'
import type { Role } from './session'

/**
 * `AuthProvider`/`useAuth` (AUTH-002, AUTH-008, AUTH-010): reemplaza la
 * sesión provisoria de F5 (`useSession`/`devRole.ts`, ver el comentario de
 * cabecera de `session.ts`) por la sesión real de `supabase-js`.
 *
 * ## De dónde sale cada dato
 *
 * - `status`/`userId`/`email`: de `supabase.auth.onAuthStateChange`, que
 *   dispara `INITIAL_SESSION` una sola vez al montar (con la sesión
 *   persistida, si había una — `persistSession: true`, `src/lib/supabase.ts`)
 *   y después en cada `SIGNED_IN`/`SIGNED_OUT`/`TOKEN_REFRESHED`/
 *   `USER_UPDATED`. Mientras no llegó ese primer evento, `status` es
 *   `'loading'` — con sesión persistida siempre pasa (una consulta a
 *   `localStorage`, no a la red), así que en la práctica dura milisegundos.
 * - `roles`/`capabilities`: del `access_token` de esa sesión, decodificados
 *   por `decodeAccessTokenClaims` (`claims.ts`) — el mismo claim que arma
 *   `app.custom_access_token_hook` y que leen las políticas RLS del lado
 *   del servidor. Se vuelven a decodificar en cada evento, así que un
 *   `TOKEN_REFRESHED` (renovación automática cada ~1 hora, o cuando el
 *   navegador recupera la conexión) actualiza roles y capacidades sin que
 *   nadie tenga que pedirlo.
 * - `profile`: de una lectura aparte a `public.profiles` (política
 *   `profiles_select_own`, `id = auth.uid()`), porque el JWT no lleva
 *   nombre ni apellido (`06_API.md` sección 1 solo documenta `roles`,
 *   `capabilities` como claims). Se carga una vez por `userId` autenticado,
 *   con reintento (`fetchProfileWithRetry`, más abajo) — un hipo de red al
 *   iniciar sesión no debería dejar el nombre vacío para siempre — y se
 *   puede volver a pedir a demanda con `refreshProfile()` (por ejemplo,
 *   después de guardar cambios en COM-04 "Mi perfil", o de subir un avatar
 *   nuevo con `AvatarUpload`, EMP-011).
 *
 * ## La decisión de AUTH-010 (revocación remota): confiar en el claim
 *
 * Este `AuthProvider` NO vuelve a consultar `user_roles`/`admin_capabilities`
 * por su cuenta para "adelantarse" a un cambio de rol: confía en los claims
 * del token vigente, ni más ni menos que las políticas RLS del servidor
 * (`app.has_role`/`app.is_admin`/`app.has_capability`, `0003`/`0012`, leen
 * `auth.jwt()` sin ninguna subconsulta — verificado leyendo esas funciones,
 * no supuesto). Como el frontend y el servidor leen exactamente el mismo
 * dato, no hay ningún estado "más fresco" que el `AuthProvider` pudiera
 * mostrar sin de paso mentir sobre lo que el servidor va a autorizar en ese
 * momento.
 *
 * Ventana de exposición medida (no supuesta) contra `App_dev`, ver el
 * reporte del encargo P06.2 para el detalle completo: revocar una sesión
 * globalmente (`auth.admin.signOut(token, 'global')`, lo que hace
 * `sign_out_user`/`deactivate_user`) bloquea el próximo refresh y las
 * llamadas a los endpoints propios de Auth (`/auth/v1/user`), pero el
 * `access_token` ya emitido SIGUE pasando PostgREST (`select`/`rpc`) hasta
 * su `exp` natural — hasta una hora (`jwt_expiry = 3600`,
 * `supabase/config.toml`) —, porque PostgREST valida el JWT solo por firma
 * y vencimiento, no contra `auth.sessions`. Cerrar esa ventana de verdad es
 * una decisión de infraestructura (bajar `jwt_expiry`, o agregar una
 * verificación de sesión viva en cada política RLS) que este paquete de
 * frontend no puede resolver: ningún sondeo desde acá cambia lo que
 * PostgREST ya le permitió al token viejo.
 *
 * IMPORTANTE, confirmado leyendo `_callRefreshToken` en el propio
 * `@supabase/auth-js` instalado (`node_modules/@supabase/auth-js/dist/
 * module/GoTrueClient.js`, ~línea 4290, comentario "Proactive vs reactive
 * distinction"): ni siquiera **forzar** un `refreshSession()` a mano
 * adelanta el cierre de sesión. La librería, a propósito, distingue un
 * refresh "proactivo" (el `access_token` vigente todavía no venció) de uno
 * "reactivo" (ya venció): si falla un refresh proactivo — exactamente lo
 * que pasa al revocar la sesión mientras el token de una hora sigue
 * vigente — CONSERVA la sesión en `localStorage` tal cual estaba y NO
 * dispara `SIGNED_OUT`, para no desloguear a alguien cuyo `access_token`
 * todavía funciona. Verificado en vivo contra `App_dev` (ver el reporte):
 * revocar la sesión y después llamar `supabase.auth.refreshSession()` a
 * mano devuelve "Invalid Refresh Token: Refresh Token Not Found" pero dejó
 * la sesión intacta y la pantalla siguió mostrando a la persona como
 * autenticada. Recién cuando el `access_token` venza de verdad (el
 * temporizador interno de `autoRefreshToken` reintenta cada 30 s,
 * `AUTO_REFRESH_TICK_DURATION_MS`, y empieza a intentar la renovación 90 s
 * antes del vencimiento, `EXPIRY_MARGIN_MS`) el próximo intento de refresh
 * cae en la rama "reactiva", falla contra el refresh token ya revocado, y
 * recién ahí `supabase-js` limpia la sesión y dispara `SIGNED_OUT`. Ni este
 * `AuthProvider` ni ninguna otra pantalla puede acortar esa espera sin
 * reescribir el manejo de sesión de la librería — no es algo que valga la
 * pena hacer acá (ver "la decisión de AUTH-010" arriba: aunque se acortara
 * la sesión LOCAL antes, PostgREST le seguiría aceptando el token viejo al
 * servidor de todos modos).
 *
 * ## Expiración y "reintento" (AUTH-010)
 *
 * La renovación automática del `access_token` (reintentos incluidos ante
 * un corte de red pasajero) es responsabilidad de `supabase-js`
 * (`autoRefreshToken: true`, `src/lib/supabase.ts`) — este archivo no la
 * reimplementa. Lo que sí es responsabilidad propia:
 * - Reaccionar a que la renovación termine fallando de verdad, ya en la
 *   rama "reactiva" de arriba (sesión revocada, refresh token vencido, y
 *   el `access_token` YA venció): `supabase-js` limpia la sesión y dispara
 *   `SIGNED_OUT`, que acá cae en la misma rama que un cierre de sesión
 *   manual (`session` llega `null`) — `status` pasa a `'unauthenticated'`
 *   sin ningún paso intermedio raro, y `RequireRole` redirige solo a
 *   `/ingresar`. Esta es la "salida limpia" del encargo (con la demora de
 *   hasta una hora explicada arriba, no antes).
 * - El reintento de la carga del perfil (`fetchProfileWithRetry`): esa sí
 *   es una llamada propia (no de la librería), sin reintento automático de
 *   nadie más.
 */

export interface AuthProfile {
  id: string
  firstName: string
  lastName: string
  /** `"{firstName} {lastName}"`, ya recortado — lo que muestran los shells. */
  displayName: string
  contactEmail: string | null
  phone: string | null
  avatarPath: string | null
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | {
      status: 'authenticated'
      userId: string
      email: string | null
      roles: Role[]
      capabilities: Capability[]
      profile: AuthProfile | null
    }

export interface AuthContextValue {
  status: AuthState['status']
  /** `null` salvo `status === 'authenticated'`. */
  userId: string | null
  email: string | null
  /** Arreglo vacío salvo `status === 'authenticated'`. */
  roles: Role[]
  /** Arreglo vacío salvo `status === 'authenticated'`, y siempre vacío para quien no es admin. */
  capabilities: Capability[]
  /** `null` mientras `profiles` todavía no respondió (o falló tres veces). */
  profile: AuthProfile | null
  /** `profile.displayName`, o el email, o `'Cuenta'` — lo que ya pueden usar los shells sin chequear `status`. */
  displayName: string
  /** Cierra la sesión local (`auth.signOut()`, `06_API.md` sección 1: "Cerrar sesión | propio"). */
  signOut: () => Promise<void>
  /** Vuelve a pedir la fila propia de `profiles` (después de editar el perfil o subir un avatar). */
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const EMPTY_ROLES: Role[] = []
const EMPTY_CAPABILITIES: Capability[] = []

async function fetchProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, contact_email, phone, avatar_path')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return {
    id: data.id,
    firstName: data.first_name,
    lastName: data.last_name,
    displayName: `${data.first_name} ${data.last_name}`.trim(),
    contactEmail: data.contact_email,
    phone: data.phone,
    avatarPath: data.avatar_path,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `fetchProfile` con reintento creciente (0, 300 ms, 900 ms — tres intentos
 * en total): cubre un hipo de red al iniciar sesión sin reintentar para
 * siempre. Si las tres fallan, devuelve `null` — el consumo (`displayName`)
 * ya tiene un respaldo con el email, y `refreshProfile()` puede reintentarlo
 * después a demanda.
 */
async function fetchProfileWithRetry(
  userId: string,
): Promise<AuthProfile | null> {
  const delaysMs = [0, 300, 900]
  let profile: AuthProfile | null = null
  for (const delayMs of delaysMs) {
    if (delayMs > 0) {
      await sleep(delayMs)
    }
    profile = await fetchProfile(userId)
    if (profile) {
      return profile
    }
  }
  return profile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  // Evita recargar el perfil en cada TOKEN_REFRESHED (mismo usuario, nuevo
  // access_token): solo se pide de nuevo cuando cambia el `userId`.
  const profileLoadedFor = useRef<string | null>(null)

  const applySession = useCallback((session: Session | null) => {
    if (!session) {
      profileLoadedFor.current = null
      setState({ status: 'unauthenticated' })
      return
    }

    const { roles, capabilities } = decodeAccessTokenClaims(
      session.access_token,
    )
    const userId = session.user.id

    setState((previous) => ({
      status: 'authenticated',
      userId,
      email: session.user.email ?? null,
      roles,
      capabilities,
      profile:
        previous.status === 'authenticated' && previous.userId === userId
          ? previous.profile
          : null,
    }))

    if (profileLoadedFor.current !== userId) {
      profileLoadedFor.current = userId
      void fetchProfileWithRetry(userId).then((profile) => {
        setState((previous) =>
          previous.status === 'authenticated' && previous.userId === userId
            ? { ...previous, profile }
            : previous,
        )
      })
    }
  }, [])

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session)
    })
    return () => subscription.unsubscribe()
  }, [applySession])

  const signOut = useCallback(async () => {
    // Cierre local (`06_API.md` sección 1: "Cerrar sesión | auth.signOut() |
    // propio"). El cierre GLOBAL ("cerrar todas las sesiones de otra
    // persona") es la Edge Function `admin-users`/`sign_out_user`
    // (F7, `06_API.md` sección 2.1) — no algo que la propia sesión haga
    // sobre sí misma. `onAuthStateChange` dispara `SIGNED_OUT` y limpia el
    // estado; no hace falta setearlo acá también.
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback(async () => {
    if (state.status !== 'authenticated') {
      return
    }
    const userId = state.userId
    const profile = await fetchProfile(userId)
    setState((current) =>
      current.status === 'authenticated' && current.userId === userId
        ? { ...current, profile }
        : current,
    )
  }, [state])

  const value = useMemo<AuthContextValue>(() => {
    if (state.status !== 'authenticated') {
      return {
        status: state.status,
        userId: null,
        email: null,
        roles: EMPTY_ROLES,
        capabilities: EMPTY_CAPABILITIES,
        profile: null,
        displayName: 'Cuenta',
        signOut,
        refreshProfile,
      }
    }
    return {
      status: 'authenticated',
      userId: state.userId,
      email: state.email,
      roles: state.roles,
      capabilities: state.capabilities,
      profile: state.profile,
      displayName: state.profile?.displayName ?? state.email ?? 'Cuenta',
      signOut,
      refreshProfile,
    }
  }, [state, signOut, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Único punto de lectura de la sesión (AUTH-002/AUTH-008): lo usan
 * `RequireRole`, `AdminShell`, `MobileShell`, `ProfileLayout`
 * (`commonRoutes.tsx`) y, desde el paquete siguiente, las pantallas COM-01
 * a COM-05. Tiene que llamarse dentro de `<AuthProvider>` (montado una sola
 * vez en `src/main.tsx`, por encima de `<RouterProvider>`); si no, lanza —
 * mejor un error temprano en desarrollo que una sesión `undefined` filtrada
 * en silencio.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth se tiene que usar dentro de <AuthProvider>.')
  }
  return context
}
