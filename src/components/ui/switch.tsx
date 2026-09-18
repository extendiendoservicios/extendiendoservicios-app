'use client'

import * as React from 'react'
import { cn } from 'cn'
import { Switch as SwitchPrimitive } from 'radix-ui'

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border-none bg-border-strong transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:bg-danger/60 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[17px] translate-x-[2.5px] rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18.5px]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
