import type { ReactNode } from "react";

// CSS phone bezel used by the "See it in action" section for screenshots and
// demo videos alike. Neutral dark bezel, so it reads in light and dark mode.
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[2.5rem] border-[10px] border-foreground/90 bg-foreground/90 shadow-2xl">
      <div className="overflow-hidden rounded-[1.9rem]">{children}</div>
    </div>
  );
}
