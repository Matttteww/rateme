import React from "react";

const base = { className: "platIcon", width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75 };

export function IconFeed(props) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconSearch(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
    </svg>
  );
}

export function IconCompass(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

export function IconMessage(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h16v10H8l-4 4V6z" />
    </svg>
  );
}

export function IconBell(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4a4 4 0 00-4 4v3l-2 2h12l-2-2V8a4 4 0 00-4-4z" />
      <path d="M10 18a2 2 0 004 0" />
    </svg>
  );
}

export function IconUser(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 20c0-4 3-6 7-6s7 2 7 6" />
    </svg>
  );
}

export function IconMusic(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="16" r="2" />
    </svg>
  );
}

export function IconStar(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3l2.4 5.8L21 10l-4.5 4.2L18 21l-6-3.5L6 21l1.5-6.8L3 10l6.6-1.2L12 3z" />
    </svg>
  );
}

export function IconCrown(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 18h16M6 14l3-8 3 5 3-5 3 8" />
    </svg>
  );
}

export function IconSettings(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function IconLogout(props) {
  return (
    <svg {...base} {...props}>
      <path d="M10 6H6v12h4M14 12H4M18 8l4 4-4 4" />
    </svg>
  );
}

export function IconEye(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeOff(props) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function IconAttach(props) {
  return (
    <svg {...base} {...props}>
      <path d="M8 12l8-8a4 4 0 016 6l-9 9a6 6 0 01-8-8l9-9" />
    </svg>
  );
}
