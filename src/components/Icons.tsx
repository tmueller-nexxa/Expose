// Schlanke Inline-SVG-Icons (kein externes Icon-Paket noetig).

type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconHome = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9 21v-6h6v6" />
  </svg>
);

export const IconBuilding = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="3" width="14" height="18" rx="1" />
    <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1" />
    <path d="M10 21v-3h4v3" />
  </svg>
);

export const IconShop = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 9h16l-1-4H5L4 9Z" />
    <path d="M5 9v11h14V9" />
    <path d="M9 20v-6h6v6" />
  </svg>
);

export const IconData = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </svg>
);

export const IconSparkle = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="M12 8.5 13.2 11 12 12l-1.2-1zM7.5 7.5l.7 1.4M16.5 16.5l-.7-1.4" />
    <path d="M12 9l1.5 1.5L12 12l-1.5-1.5L12 9Z" />
  </svg>
);

export const IconUpload = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M5 20h14" />
  </svg>
);

export const IconTrash = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7v13h12V7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const IconKey = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.5 12.5 9-9M17 6l2 2M14 9l2 2" />
  </svg>
);

export const IconImage = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5L5 20" />
  </svg>
);

export const IconText = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 6h14M5 6v-.5M12 6v13M9 19h6" />
  </svg>
);

export const IconCheck = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12.5 10 17l9-10" />
  </svg>
);

export const IconLogout = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
    <path d="M10 12H3M6 8l-4 4 4 4" />
  </svg>
);

export const IconDownload = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 20h14" />
  </svg>
);

export const IconArrowLeft = ({ size = 24, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);
