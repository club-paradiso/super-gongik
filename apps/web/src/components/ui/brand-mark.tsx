/* eslint-disable @next/next/no-img-element */

/** Official SUPER GONGIK mark: the app-icon artwork with a transparent matte. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="brand-mark"
      decoding="async"
      draggable={false}
      height={size}
      src="/brand-mark.png"
      width={size}
    />
  );
}
