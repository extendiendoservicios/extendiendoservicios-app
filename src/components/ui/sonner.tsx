'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'

/**
 * Toaster (DS-010): la Base es solo modo claro (P-118) — a diferencia de la
 * plantilla de shadcn/ui, acá no hay que leer el tema del sistema
 * operativo/navegador. Se saca `next-themes` (quedó sin otro uso en el
 * repo, ver CHANGELOG) y se fija `theme="light"` siempre.
 *
 * `pointer-events-auto` (DEF-P28-01): Radix pone `pointer-events: none` en el
 * `body` mientras hay una hoja o un diálogo modal abierto, y el Toaster (hijo
 * del `body`) lo heredaba: los toques caían en la hoja y botones del aviso
 * como «Ver turno» no respondían.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group pointer-events-auto"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
