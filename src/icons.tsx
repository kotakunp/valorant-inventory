import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const IconShowcase = (p: P) => (
  <svg {...base} {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M10.25 2.75v10.5M1.75 9.25h8.5" />
  </svg>
);

export const IconStore = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.5 5.25h11l-.9 8h-9.2z" />
    <path d="M5.5 5.25V4.5a2.5 2.5 0 0 1 5 0v.75" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 2.25v8M4.75 7 8 10.25 11.25 7M2.75 13.25h10.5" />
  </svg>
);

export const IconSwitch = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.75 5.5h10l-2.5-2.5M13.25 10.5h-10l2.5 2.5" />
  </svg>
);

export const IconFit = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.25 5.5V2.25H5.5M10.5 2.25h3.25V5.5M13.75 10.5v3.25H10.5M5.5 13.75H2.25V10.5" />
  </svg>
);

export const IconExpand = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.5 2.25h4.25V6.5M13.5 2.5 9 7M6.5 13.75H2.25V9.5M2.5 13.5 7 9" />
  </svg>
);

export const IconLink = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6.75 9.25a2.75 2.75 0 0 0 3.9 0l2-2a2.76 2.76 0 0 0-3.9-3.9l-.6.6" />
    <path d="M9.25 6.75a2.75 2.75 0 0 0-3.9 0l-2 2a2.76 2.76 0 0 0 3.9 3.9l.6-.6" />
  </svg>
);

export const IconCopy = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" />
    <path d="M10.75 5.25V3.75a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 8.5 6.25 11.75 13 4.75" />
  </svg>
);

export const IconArrowRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2.75 8h10.5M9 3.75 13.25 8 9 12.25" />
  </svg>
);
