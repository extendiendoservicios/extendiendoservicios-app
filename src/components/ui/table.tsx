'use client'

import * as React from 'react'
import { cn } from 'cn'

/**
 * Table (base de `DataTable`, DS-008): `07` sección 2.3 — encabezado
 * `#FAFBFC` mayúsculas 10 px, celdas 12 px (`.tbl`/`.tbl thead
 * th`/`.tbl tbody td`, `Mockup/assets/ds.css`). `05` sección 7: con scroll
 * horizontal entre 1024 y 1279 px (sidebar colapsada) cuando la tabla no
 * entra — por eso el contenedor sigue siendo `overflow-x-auto` (por debajo
 * de 1024 px, `DataTable` ni siquiera renderiza esta tabla: usa `RowCard`).
 */
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          'w-full border-collapse text-xs text-text-2 tabular-nums',
          className,
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-[var(--table-header-bg)]', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child_td]:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn(className)} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'border-b border-border px-[14px] py-[9px] text-left text-[10px] font-semibold tracking-wide whitespace-nowrap text-text-3 uppercase',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'border-b border-border px-[14px] py-[10px] align-middle',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('sr-only', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
