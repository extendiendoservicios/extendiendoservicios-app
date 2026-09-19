import { Link } from 'react-router'

/**
 * 404 (DS-015): cualquier ruta que no coincide con ninguna de
 * `05_Pantallas_y_Navegacion.md` sección 5. Simple, con la marca — no es
 * una pantalla del plan, así que no lleva `screenId`.
 */
export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        {/* favicon.png ya es el isotipo en color, recortado del logo original
            (Images/ExtendiendoServicios_logo.png) en INFRA-001 — logo.png es
            la versión blanca, pensada para fondos oscuros/teal (sidebar,
            portada), no para esta pantalla sobre `--bg` claro. */}
        <img
          src="/favicon.png"
          alt="Extendiendo Servicios"
          className="size-14"
        />
        <div>
          <h1 className="text-[17px] font-semibold text-text">
            No encontramos esta página
          </h1>
          <p className="mt-1 text-[13px] text-text-2">
            Revisá la dirección o volvé al inicio.
          </p>
        </div>
        <Link
          to="/"
          className="text-[12.5px] font-semibold text-primary-800 underline-offset-4 hover:underline"
        >
          Volver al inicio
        </Link>
      </div>
    </div>
  )
}
