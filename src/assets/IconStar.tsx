import { SVGProps } from 'react';

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/** Caption-weight star: sharp points, fill only — no extra stroke. */
const STAR_PATH =
  'M12 3 14.02 9.22 20.56 9.22 15.27 13.06 17.29 19.28 12 15.44 6.71 19.28 8.73 13.06 3.44 9.22 9.98 9.22Z';

export default function IconStar({ size = 16, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}
