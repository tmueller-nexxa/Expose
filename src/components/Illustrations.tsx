// Massgeschneiderte SVG-Illustrationen mit Immobilienbezug.
// Voll inline, keine externen Bilder -> keine Netz-/Lizenzabhaengigkeit.

type P = { className?: string; style?: React.CSSProperties };

// Gemeinsamer Rahmen: Himmelverlauf + Boden, Motiv als children.
function Scene({
  id,
  sky,
  ground,
  children,
  className,
  style,
}: {
  id: string;
  sky: [string, string];
  ground: string;
  children: React.ReactNode;
} & P) {
  return (
    <svg
      viewBox="0 0 400 230"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={{ display: "block", width: "100%", height: "100%", ...style }}
      role="img"
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky[0]} />
          <stop offset="1" stopColor={sky[1]} />
        </linearGradient>
      </defs>
      <rect width="400" height="230" fill={`url(#${id}-sky)`} />
      <circle cx="330" cy="52" r="26" fill="#ffffff" opacity="0.55" />
      <rect y="176" width="400" height="54" fill={ground} />
      {children}
    </svg>
  );
}

// Einfamilienhaus: freistehendes Haus mit Giebeldach, Baum, Weg.
export const HouseScene = ({ className, style }: P) => (
  <Scene
    id="house"
    sky={["#dCEBF7", "#eef5fb"]}
    ground="#e6ddca"
    className={className}
    style={style}
  >
    {/* Baum */}
    <rect x="70" y="120" width="8" height="60" fill="#7c5a3a" />
    <circle cx="74" cy="112" r="26" fill="#7fa96b" />
    <circle cx="58" cy="122" r="18" fill="#8fb87a" />
    <circle cx="90" cy="122" r="18" fill="#8fb87a" />
    {/* Weg */}
    <path d="M210 230 L235 150 L265 150 L300 230 Z" fill="#d8ccb0" />
    {/* Haus */}
    <rect x="160" y="120" width="150" height="80" fill="#f6f1e7" />
    <polygon points="150,122 235,70 320,122" fill="#c8a04b" />
    <polygon points="150,122 235,78 320,122" fill="#d8b568" opacity="0.6" />
    {/* Schornstein */}
    <rect x="285" y="86" width="14" height="26" fill="#b98f3f" />
    {/* Fenster */}
    <rect x="175" y="138" width="26" height="26" fill="#8ec5e6" stroke="#fff" strokeWidth="3" />
    <rect x="270" y="138" width="26" height="26" fill="#8ec5e6" stroke="#fff" strokeWidth="3" />
    {/* Tuer */}
    <rect x="223" y="150" width="26" height="50" fill="#7c5a3a" />
    <circle cx="244" cy="176" r="2.4" fill="#f6d98a" />
  </Scene>
);

// Wohnung: gemuetliches Interieur mit Sofa, Fenster, Pflanze.
export const InteriorScene = ({ className, style }: P) => (
  <Scene
    id="int"
    sky={["#eaf3ee", "#f3f8f5"]}
    ground="#d9cbb8"
    className={className}
    style={style}
  >
    {/* Rueckwand */}
    <rect x="0" y="0" width="400" height="176" fill="#eef4f0" />
    {/* Fenster mit Ausblick */}
    <rect x="40" y="40" width="120" height="86" fill="#bfe0d2" stroke="#fff" strokeWidth="6" />
    <line x1="100" y1="40" x2="100" y2="126" stroke="#fff" strokeWidth="4" />
    <line x1="40" y1="83" x2="160" y2="83" stroke="#fff" strokeWidth="4" />
    {/* Bild an der Wand */}
    <rect x="250" y="46" width="60" height="44" fill="#fff" stroke="#1f8f6f" strokeWidth="3" />
    <path d="M256 84 l14 -18 10 12 8 -8 10 14 Z" fill="#9dc9b5" />
    {/* Boden */}
    <rect x="0" y="150" width="400" height="80" fill="#c9a97f" />
    {/* Sofa */}
    <rect x="210" y="128" width="140" height="40" rx="8" fill="#1f8f6f" />
    <rect x="210" y="112" width="140" height="26" rx="8" fill="#27a683" />
    <rect x="204" y="120" width="18" height="48" rx="6" fill="#178068" />
    <rect x="338" y="120" width="18" height="48" rx="6" fill="#178068" />
    {/* Pflanze */}
    <rect x="60" y="150" width="20" height="20" fill="#b98f5f" />
    <path d="M70 150 C 54 120 60 108 70 100 C 80 108 86 120 70 150 Z" fill="#6fae8c" />
    {/* Lampe */}
    <line x1="180" y1="0" x2="180" y2="34" stroke="#9aa7a1" strokeWidth="3" />
    <path d="M166 34 h28 l-6 16 h-16 Z" fill="#f2c94c" />
  </Scene>
);

// Mehrfamilienhaus: mehrstoeckiges Gebaeude mit Fensterraster.
export const ApartmentScene = ({ className, style }: P) => {
  const floors = [0, 1, 2, 3];
  const cols = [0, 1, 2];
  return (
    <Scene
      id="apt"
      sky={["#dbe8f1", "#eef4f8"]}
      ground="#d7d2c4"
      className={className}
      style={style}
    >
      {/* Nachbargebaeude */}
      <rect x="40" y="96" width="70" height="104" fill="#c3d2dd" />
      <rect x="300" y="112" width="66" height="88" fill="#c3d2dd" />
      {/* Hauptgebaeude */}
      <rect x="128" y="52" width="150" height="148" fill="#eef3f6" />
      <rect x="128" y="52" width="150" height="16" fill="#2f6f8f" />
      {floors.map((f) =>
        cols.map((c) => (
          <rect
            key={`${f}-${c}`}
            x={144 + c * 44}
            y={80 + f * 28}
            width="30"
            height="18"
            fill="#8fb9d0"
            stroke="#fff"
            strokeWidth="2.5"
          />
        )),
      )}
      {/* Eingang */}
      <rect x="188" y="170" width="30" height="30" fill="#2f6f8f" />
      <rect x="193" y="176" width="20" height="24" fill="#8fb9d0" />
    </Scene>
  );
};

// Gewerbe: moderner Glas-Buerobau.
export const CommercialScene = ({ className, style }: P) => {
  const rows = [0, 1, 2, 3, 4];
  const cols = [0, 1, 2, 3];
  return (
    <Scene
      id="com"
      sky={["#e7e0ef", "#f2eef7"]}
      ground="#d3cdc2"
      className={className}
      style={style}
    >
      <rect x="60" y="120" width="70" height="80" fill="#cfc4de" />
      {/* Turm */}
      <rect x="150" y="40" width="150" height="160" fill="#7a4b8f" />
      <rect x="150" y="40" width="150" height="160" fill="url(#com-glass)" opacity="0.25" />
      <defs>
        <linearGradient id="com-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#7a4b8f" />
        </linearGradient>
      </defs>
      {rows.map((r) =>
        cols.map((c) => (
          <rect
            key={`${r}-${c}`}
            x={162 + c * 34}
            y={54 + r * 28}
            width="24"
            height="18"
            fill="#c9b3d8"
            opacity={(r + c) % 2 ? 0.9 : 0.6}
          />
        )),
      )}
      {/* Eingang / Vordach */}
      <rect x="150" y="188" width="150" height="12" fill="#5f3a70" />
      <rect x="205" y="170" width="40" height="30" fill="#e7dcef" />
    </Scene>
  );
};

// Skyline-Streifen fuer den Login-Hero.
export const SkylineBanner = ({ className, style }: P) => (
  <svg
    viewBox="0 0 1200 260"
    preserveAspectRatio="xMidYMax slice"
    className={className}
    style={{ display: "block", width: "100%", height: "100%", ...style }}
    role="img"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="sky-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0.16" />
      </linearGradient>
    </defs>
    {[
      [40, 120, 90],
      [140, 70, 70],
      [220, 150, 60],
      [290, 40, 110],
      [410, 100, 80],
      [500, 60, 70],
      [580, 160, 90],
      [680, 90, 60],
      [750, 130, 100],
      [860, 50, 80],
      [950, 140, 70],
      [1030, 80, 90],
      [1130, 120, 70],
    ].map(([x, h, w], i) => (
      <g key={i}>
        <rect x={x} y={260 - h} width={w} height={h} fill="url(#sky-b)" />
        <rect
          x={x}
          y={260 - h}
          width={w}
          height={h}
          fill="#ffffff"
          opacity="0.08"
          stroke="#ffffff"
          strokeOpacity="0.14"
        />
      </g>
    ))}
  </svg>
);
