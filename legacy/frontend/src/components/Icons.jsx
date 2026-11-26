const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Svg({ size = 20, className, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...STROKE}
    >
      {children}
    </svg>
  );
}

export const Shield = (props) => (
  <Svg {...props}>
    <path d="M12 3l7 3v6c0 4.5-2.9 7.9-7 9.5C7.9 19.9 5 16.5 5 12V6l7-3z" />
    <path d="M8.5 12.3h2l1.4-2.9 2 5.2 1-2.3h2" />
  </Svg>
);

export const Gauge = (props) => (
  <Svg {...props}>
    <path d="M4.5 17a8.5 8.5 0 1115 0" />
    <path d="M12 12.5l3.4-3.4" />
    <circle cx="12" cy="17" r="1.6" />
  </Svg>
);

export const Activity = (props) => (
  <Svg {...props}>
    <path d="M3 12h3.5L9 5.5l4 13 2.5-6.5H21" />
  </Svg>
);

export const Bell = (props) => (
  <Svg {...props}>
    <path d="M6 16.5V11a6 6 0 1112 0v5.5l1.5 2h-15L6 16.5z" />
    <path d="M10 20.5a2.2 2.2 0 004 0" />
  </Svg>
);

export const Sparkles = (props) => (
  <Svg {...props}>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z" />
    <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
  </Svg>
);

export const Play = (props) => (
  <Svg {...props}>
    <path d="M8 5.5l10 6.5-10 6.5v-13z" />
  </Svg>
);

export const Refresh = (props) => (
  <Svg {...props}>
    <path d="M20 11a8 8 0 10-2.3 6" />
    <path d="M20 5v6h-6" />
  </Svg>
);

export const Check = (props) => (
  <Svg {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const AlertTriangle = (props) => (
  <Svg {...props}>
    <path d="M12 4.5L21 20H3L12 4.5z" />
    <path d="M12 10v4.5" />
    <circle cx="12" cy="17.4" r="0.6" fill="currentColor" />
  </Svg>
);

export const ChevronDown = ({ size = 18, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    className={className}
    aria-hidden="true"
    {...STROKE}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const ArrowUpRight = (props) => (
  <Svg {...props}>
    <path d="M7 17L17 7" />
    <path d="M8 7h9v9" />
  </Svg>
);

export const Layers = (props) => (
  <Svg {...props}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Svg>
);

export const Users = (props) => (
  <Svg {...props}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0111 0" />
    <path d="M16 5.4a3.2 3.2 0 010 6.2" />
    <path d="M17.5 14.5A5.5 5.5 0 0121 20" />
  </Svg>
);

export const Database = (props) => (
  <Svg {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="2.7" />
    <path d="M5 6v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6" />
    <path d="M5 12v6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7v-6" />
  </Svg>
);

export const Clock = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

export const Info = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r="0.6" fill="currentColor" />
  </Svg>
);

export const Sliders = (props) => (
  <Svg {...props}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
);
