import type { ReactNode } from 'react'

/**
 * Envoltorio compartido de COM-01, COM-02, COM-03 y COM-05 (`05` sección 3,
 * fila COM-01: "En móvil ocupa toda la pantalla; en escritorio, tarjeta
 * centrada sobre fondo claro" — la misma regla de layout vale para las
 * otras tres, aunque el texto solo la escribe una vez).
 *
 * Sin JS: el quiebre es puro CSS (`sm:`, 480 px, `tailwind.config.ts`) — no
 * hace falta `useMediaQuery` para decidir "tarjeta sí/no", a diferencia del
 * redirect de AUTH-004 (`LoginPage`), que si necesita el ancho en JS porque
 * cambia una decisión de navegación, no solo de estilo.
 *
 * Por debajo de 480 px: ocupa toda la pantalla (`bg-bg`, sin borde ni
 * sombra, contenido centrado verticalmente). Desde 480 px: tarjeta
 * centrada (`--r-lg`, borde, sombra `--sh-card` — mismos tokens que `Card`,
 * `card.tsx`; no se reusa el componente `Card` en sí porque en móvil
 * necesita perder el borde/sombra/fondo por completo, no solo el padding
 * como su variante `flush`).
 */
export function AuthScreenLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-10 sm:flex-none sm:py-16">
        <div className="flex flex-col gap-6 sm:rounded-xl sm:border sm:border-border sm:bg-surface sm:p-7 sm:shadow-card">
          {children}
        </div>
      </div>
    </div>
  )
}
