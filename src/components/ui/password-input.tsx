import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from 'cn'

/**
 * PasswordInput (P08.6, pedido de Mike del 24 sep 2026): campo de
 * contraseña con un botón "ojito" (`Eye`/`EyeOff` de lucide-react) que
 * alterna el `type` del input entre `password` y `text`.
 *
 * No envuelve a `Input` (`ui/input.tsx`): ese componente solo deja lugar
 * para un ícono a la izquierda, así que acá se repite la misma estructura y
 * las mismas clases (mismos tokens, mismo tamaño en las dos variantes,
 * `mobile`/escritorio) agregando el botón a la derecha. Si `Input` cambia,
 * hay que revisar este archivo también.
 *
 * - El botón es `type="button"`: nunca envía el formulario que lo contiene.
 * - Anuncia el estado con `aria-pressed` y `aria-label` ("Mostrar
 *   contraseña" / "Ocultar contraseña"), y con `aria-controls` apunta al
 *   `id` del input (`07` sección 5, todo por teclado, con foco visible en
 *   `--ring`).
 * - Arranca siempre oculto (`type="password"`). No hace falta resetearlo a
 *   mano: el estado vive en este componente, así que un formulario que se
 *   reinicia desmontando y remontando el campo (o un diálogo que se cierra)
 *   ya vuelve a arrancar oculto solo.
 * - `::-ms-reveal`/`::-ms-clear` van ocultos para que Edge no dibuje su
 *   propio ojito nativo al lado del nuestro.
 * - Reenvía `ref` (React 19 ya no necesita `forwardRef`, igual que
 *   `Input`) y el resto de las props nativas del input, incluidas las que
 *   pone `register(...)` de react-hook-form y `autoComplete`, para no
 *   romper gestores de contraseñas ni validaciones.
 * - A diferencia de `Input`, `className` va al contenedor y no al `<input>`:
 *   el botón se ubica respecto del contenedor, así que un ancho puesto solo
 *   en el input (por ejemplo `w-72`) dejaba el ojito afuera del campo.
 */
function PasswordInput({
  className,
  icon: Icon,
  error,
  mobile = false,
  id,
  'aria-describedby': ariaDescribedBy,
  disabled,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & {
  icon?: React.ComponentType<{ className?: string }>
  /** Mensaje de error: pinta el borde de `--danger` y lo muestra debajo. */
  error?: string
  /** Variante móvil: mismo relleno y tamaño de fuente que la de `Input`. */
  mobile?: boolean
}) {
  const [visible, setVisible] = React.useState(false)
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const errorId = error ? `${inputId}-error` : undefined

  return (
    <div className={cn('w-full', className)}>
      <div className="relative flex items-center">
        {Icon && (
          <Icon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 size-[15px] text-text-3"
          />
        )}
        <input
          id={inputId}
          type={visible ? 'text' : 'password'}
          data-slot="input"
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={cn(ariaDescribedBy, errorId) || undefined}
          className={cn(
            'h-auto w-full min-w-0 rounded-md border border-border-strong bg-surface text-text outline-none transition-colors placeholder:text-text-3 focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
            // Ojito nativo de Edge: se esconde para que no quede uno al
            // lado del otro con el nuestro.
            '[&::-ms-reveal]:hidden [&::-ms-clear]:hidden',
            mobile
              ? 'py-3 pl-[13px] pr-11 text-[14px]'
              : 'px-3 py-[9px] pr-9 text-[13px]',
            Icon && (mobile ? 'pl-9' : 'pl-8'),
          )}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-pressed={visible}
          aria-controls={inputId}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className={cn(
            'absolute inset-y-0 right-0 flex items-center justify-center text-text-3 outline-none transition-colors hover:text-text focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            // 44 px de alto como mínimo en móvil (`07` sección 5): la
            // variante `mobile` ya da esa altura al input completo, así
            // que el botón toma toda la altura disponible (`inset-y-0`) y
            // ensancha el relleno horizontal para el objetivo táctil.
            mobile ? 'px-3' : 'px-2.5',
          )}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-[15px]" />
          ) : (
            <Eye aria-hidden="true" className="size-[15px]" />
          )}
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-[5px] text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export { PasswordInput }
