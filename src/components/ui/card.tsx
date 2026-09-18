import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/**
 * Card (DS-006): `07` sección 2.3, `.card`/`.card-hd`/`.card-bd`/`.card-bd.flush`
 * de `Mockup/assets/ds.css` y `.m-card.hero` (D01/M02).
 *
 * - `flush`: `CardContent` pierde su padding (para embeber una tabla a ancho
 *   completo); se propaga con el atributo `data-variant` del `Card` raíz.
 * - `hero`: variante móvil con borde y sombra teal (`--primary-200`,
 *   `--sh-hero`).
 */
const cardVariants = cva(
  'flex flex-col overflow-hidden rounded-xl border bg-surface shadow-card',
  {
    variants: {
      variant: {
        default: 'border-border',
        flush: 'border-border',
        hero: 'border-primary-200 shadow-hero',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Card({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex items-center gap-[10px] border-b border-border px-4 py-[13px]',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('mr-auto text-sm font-semibold text-text', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-[11px] text-text-3', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-4 py-[14px] in-data-[variant=flush]:p-0', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center gap-[10px] border-t border-border px-4 py-[13px]',
        className,
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
}
