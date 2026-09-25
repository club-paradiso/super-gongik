/** Small app mark: a flag on a rounded tile, drawn inline so it never loads. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="brand-mark"
      height={size}
      viewBox="0 0 28 28"
      width={size}
    >
      <rect fill="var(--teal)" height="28" rx="8" width="28" />
      <path
        d="M10 21V7.5m0 .5h8.5l-2.2 3.2 2.2 3.3H10"
        fill="none"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}
