import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

// Visual styles live in globals.css (`.btn*`) so every surface shares one
// button system instead of per-screen overrides.
const buttonVariants = cva("btn", {
  variants: {
    variant: {
      primary: "btn--primary",
      outline: "btn--outline",
      ghost: "btn--ghost",
      danger: "btn--danger",
    },
    size: {
      default: "btn--md",
      compact: "btn--sm",
      large: "btn--lg",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
  },
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
