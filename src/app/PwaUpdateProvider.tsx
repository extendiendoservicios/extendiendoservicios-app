import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * `PwaUpdateProvider`/`usePwaUpdate` (RESP-009, adelantado de F17 a antes
 * del primer pase a producción — ver el reporte del encargo). Reemplaza el
 * `registerSW.js` genérico que `vite-plugin-pwa` inyectaba solo (ver
 * `injectRegister: false` en `vite.config.ts`) por un registro propio con
 * `virtual:pwa-register/react`, para poder mostrar un aviso cuando hay una
 * versión nueva en vez de dejarla esperando en silencio hasta que se
 * cierren todas las pestañas.
 *
 * Un único punto de registro para toda la sesión de la pestaña (se monta
 * una sola vez en `main.tsx`, junto a `AuthProvider`): `useRegisterSW`
 * guarda el registro con `useState(() => registerSW(...))`, así que
 * aunque este componente se re-renderice, el service worker se registra
 * una sola vez.
 *
 * ## Cada cuánto se chequea, y por qué
 *
 * Un service worker no avisa solo de una versión nueva salvo que alguien
 * se lo pregunte (`registration.update()`): el navegador hace ese chequeo
 * por su cuenta en cada navegación de página completa, pero acá adentro no
 * hay navegaciones completas — es una SPA, el router cambia de pantalla
 * sin recargar — y encima ese chequeo automático del navegador está
 * limitado a como mucho una vez cada 24 horas por especificación. Alguien
 * que deja la aplicación instalada abierta todo el turno (fichando,
 * cargando observaciones) podría no enterarse de una actualización en todo
 * el día.
 *
 * Por eso se fuerza un chequeo cada una hora (`CHECK_INTERVAL_MS`) mientras
 * la aplicación sigue abierta, más uno extra apenas la persona vuelve a la
 * pestaña/app después de tenerla en segundo plano (`visibilitychange`):
 * `setInterval` se pausa en la mayoría de los navegadores cuando la pestaña
 * no está visible (para ahorrar batería), así que sin ese chequeo extra
 * alguien que reabre la PWA después de tenerla minimizada podría esperar
 * hasta la próxima hora completa para enterarse de una actualización que ya
 * estaba lista.
 *
 * Una hora es un número elegido, no el único posible, pero se justifica
 * así: `dist/sw.js` pesa apenas un puñado de kB (2,4 kB en esta entrega,
 * verificado con `pnpm build`) y ya lleva `Cache-Control: no-cache`
 * (`public/_headers`, RESP-001), así que cada chequeo es una revalidación
 * liviana -- costo prácticamente nulo de datos móviles aun revisando varias
 * veces por turno --, y bastante más frecuente que el chequeo "gratis" del
 * navegador (una vez cada 24 horas) sin llegar a ser tan seguido como para
 * generar tráfico de fondo perceptible.
 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

export interface PwaUpdateContextValue {
  /** Hay un service worker nuevo esperando: corresponde mostrar el aviso. */
  needRefresh: boolean
  /** La persona ya pidió actualizar: mientras se aplica, no se puede volver a pedir. */
  applying: boolean
  /** Aplica la actualización: le avisa al service worker en espera y recarga la app. */
  applyUpdate: () => void
  /** Oculta el aviso sin aplicar la actualización, hasta la próxima que se detecte. */
  postpone: () => void
}

const PwaUpdateContext = createContext<PwaUpdateContextValue | null>(null)

export function PwaUpdateProvider({ children }: { children: ReactNode }) {
  const [applying, setApplying] = useState(false)
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(
    undefined,
  )

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swScriptUrl, registration) {
      registrationRef.current = registration
      if (!registration) return

      const checkForUpdate = () => {
        // Sin conexión no tiene sentido pedir el archivo del service
        // worker: solo generaría un error de red de fondo.
        if (navigator.onLine) void registration.update()
      }

      window.setInterval(checkForUpdate, CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
    },
  })

  /**
   * `updateServiceWorker()` (de la librería) solo le manda `SKIP_WAITING`
   * al service worker en espera -- no espera a que quede activo ni recarga
   * la página. Hace falta lo segundo (ver el comentario de
   * `PwaUpdateBanner.tsx` para lo que ve la persona mientras tanto): como
   * `vite.config.ts` usa `registerType: 'prompt'` sin `clients.claim()`
   * (ver `docs/design-system.md`, sección "PWA"), el service worker nuevo
   * no toma control de esta pestaña ya abierta por su cuenta -- recién lo
   * hace la próxima navegación, que acá es la recarga de abajo. Por eso se
   * espera a que el worker que estaba en espera llegue a `state:
   * 'activated'` antes de recargar: recargar antes de tiempo podría
   * encontrar que el worker nuevo todavía está activándose y la página
   * seguiría sirviéndose con el viejo.
   */
  function applyUpdate() {
    const waitingWorker = registrationRef.current?.waiting
    setApplying(true)

    void updateServiceWorker().then(() => {
      if (!waitingWorker || waitingWorker.state === 'activated') {
        window.location.reload()
        return
      }
      waitingWorker.addEventListener('statechange', function onStateChange() {
        if (waitingWorker.state === 'activated') {
          waitingWorker.removeEventListener('statechange', onStateChange)
          window.location.reload()
        }
      })
    })
  }

  return (
    <PwaUpdateContext.Provider
      value={{
        needRefresh,
        applying,
        applyUpdate,
        // Usa el setter que ya expone el hook: no hace falta un estado
        // "pospuesto" aparte. El listener interno de la librería sigue
        // enganchado igual, así que si aparece una versión más nueva
        // todavía mientras esta está pospuesta, `needRefresh` vuelve a
        // `true` solo -- el aviso no queda apagado para siempre.
        postpone: () => setNeedRefresh(false),
      }}
    >
      {children}
    </PwaUpdateContext.Provider>
  )
}

export function usePwaUpdate(): PwaUpdateContextValue {
  const ctx = useContext(PwaUpdateContext)
  if (!ctx) {
    throw new Error('usePwaUpdate debe usarse dentro de <PwaUpdateProvider>.')
  }
  return ctx
}
