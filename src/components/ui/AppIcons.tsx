// Custom icons in the lucide style (24px grid, 2px stroke, round caps), for things lucide has no glyph for.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** AI Workspace: a terminal window with a prompt and an AI sparkle inside. */
export function AiTerminalIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="3.5" width="20" height="17" rx="2.5" />
      <path d="m5.5 9 3 3-3 3" />
      <path d="M15.5 6.8c.45 2.75 1.45 3.75 4.2 4.2-2.75.45-3.75 1.45-4.2 4.2-.45-2.75-1.45-3.75-4.2-4.2 2.75-.45 3.75-1.45 4.2-4.2Z" fill="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
