// Compact select for dense toolbars (the shared <Select> is full-width / 28px tall).
import clsx from "clsx";
import type { SelectHTMLAttributes } from "react";

export default function MiniSelect({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={clsx(
        "h-6 rounded-md border border-line bg-app px-1.5 text-xs text-fg focus:border-accent focus:outline-none disabled:opacity-50",
        className,
      )}
    >
      {children}
    </select>
  );
}
