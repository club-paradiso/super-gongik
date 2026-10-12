/**
 * World-language tag from the Warrior direction ("JOURNEY", "AGENDA",
 * "SUPPLY"). Decorative: hidden from assistive technology, never the only
 * label, and only displayed under `[data-theme="warrior"]` (see tokens.css).
 * Mirrors `SGWorldEyebrow` on iOS.
 */
export function WorldEyebrow({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="world-eyebrow">
      {children}
    </span>
  );
}
