/* eslint-disable @next/next/no-img-element */

/** Official SUPER GONGIK mark, shared with the installed app icon. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="brand-mark"
      decoding="async"
      draggable={false}
      height={size}
      src="/icon-192.png"
      width={size}
    />
  );
}
