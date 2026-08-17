// Inline SVG icon set — ported 1:1 from the prototype markup.
import React from "react";

type P = { width?: number; height?: number; style?: React.CSSProperties; className?: string };
const S = (props: P, sw: number, children: React.ReactNode, fill = "none") => (
  <svg viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} {...props}>
    {children}
  </svg>
);

// Jikoni Tool mark — a cooking pot over a flame, in the app's warm palette.
// The Ignis flame, cropped from the brand logo (public/ignis-mark.png). Rendered
// inside the white rounded .mark box next to the product name.
export const BrandMark = () => (
  <img className="brandmark" src="/ignis-mark.png" alt="Ignis" />
);

export const HomeI = (p: P) => S(p, 1.8, <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>);
export const FinanceI = (p: P) => S(p, 1.8, <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />);
export const ProcureI = (p: P) => S(p, 1.8, <><path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" /><path d="M16 12h6" /><circle cx="18" cy="12" r="1" /></>);
export const HrI = (p: P) => S(p, 1.8, <><circle cx="9" cy="7" r="3" /><path d="M3 21c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4a3 3 0 0 1 0 6M22 21c0-2.5-1.5-4.6-4-5.5" /></>);
export const PortalI = (p: P) => S(p, 1.8, <><path d="M4 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M18 8h4M20 6v4" /></>);
export const FlameI = (p: P) => S(p, 1.8, <path d="M12 2c1 3-1 4-1 6 0 1.5 1 2.2 1 2.2S14 9 14 7c2 1.5 4 4 4 7a6 6 0 1 1-12 0c0-2 1-3.5 2-4.5" />);
export const ReadyI = (p: P) => S(p, 1.8, <><path d="M9 11l3 3 8-8" /><path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" /></>);
export const ProjectsI = (p: P) => S(p, 1.8, <><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>);
export const RaiseI = (p: P) => S(p, 1.8, <><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></>);
export const CrmI = (p: P) => S(p, 1.8, <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><path d="M16 6h5M19 4v4" /></>);
export const ComplianceI = (p: P) => S(p, 1.8, <path d="M12 3 4 6v6c0 4.5 3.2 7.5 8 9 4.8-1.5 8-4.5 8-9V6l-8-3Z" />);
export const UsersI = (p: P) => S(p, 1.8, <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.2" /><path d="M16 14c2.5 0 4 1.5 4 4" /></>);
export const SettingsI = (p: P) => S(p, 1.8, <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></>);
export const Chev = (p: P) => S({ className: "chev", ...p }, 2.5, <path d="m9 6 6 6-6 6" />);
export const ChevDown = (p: P) => S(p, 2.5, <path d="m7 9 5 5 5-5" />);
export const SearchI = (p: P) => S({ width: 15, height: 15, ...p }, 2, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></>);
export const PlusI = (p: P) => S(p, 2, <path d="M12 5v14M5 12h14" />);
export const BellI = (p: P) => S(p, 1.8, <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>);
export const ExportI = (p: P) => S(p, 1.8, <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>);
export const DocI = (p: P) => S(p, 1.8, <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>);
export const BoxI = (p: P) => S(p, 1.8, <><path d="M21 8l-9-5-9 5v8l9 5 9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></>);
export const CheckSqI = (p: P) => S(p, 2, <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>);
export const CheckSqThinI = (p: P) => S(p, 1.8, <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></>);
export const FlameGlyphI = (p: P) => S(p, 2, <path d="M12 2c1 3-1 4-1 6 0 1.5 1 2.2 1 2.2S14 9 14 7c2 1.5 4 4 4 7a6 6 0 1 1-12 0c0-2 1-3.5 2-4.5" />);
export const LockI = (p: P) => S({ width: 16, height: 16, ...p }, 1.8, <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const LockSmI = (p: P) => S({ style: { width: 14, height: 14 }, ...p }, 1.8, <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>);
export const XI = (p: P) => S({ width: 16, height: 16, ...p }, 2, <path d="M18 6 6 18M6 6l12 12" />);
export const LogoutI = (p: P) => S({ width: 16, height: 16, ...p }, 2, <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />);
export const CheckI = (p: P) => S({ width: 14, height: 14, ...p }, 2.5, <path d="M20 6 9 17l-5-5" />);
export const CheckBoldI = (p: P) => S({ width: 12, height: 12, ...p }, 3, <path d="M20 6 9 17l-5-5" />);
export const EyeI = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--flame)" strokeWidth="2" {...p}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const EyeOffI = (p: P) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--flame)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M2 12s4-7 10-7c1.7 0 3.2.35 4.5.95M22 12s-4 7-10 7c-1.7 0-3.2-.35-4.5-.95" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="M3 3l18 18" />
  </svg>
);
export const OrgI = (p: P) => S(p, 1.8, <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3" />);
export const LinkI = (p: P) => S(p, 1.8, <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>);
export const CrumbChev = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6 6 6-6 6" /></svg>
);

// The filled burner-ring flame from the Status Board.
export const BurnerFlame = ({ ring }: { ring: string }) => (
  <svg className="flame-i" viewBox="0 0 24 24" fill={ring === "on" ? "#12A3BE" : ring === "warm" ? "#E2632A" : "#9c9082"}>
    <path d="M12 2c1 3-1 4-1 6 0 1.5 1 2.2 1 2.2S14 9 14 7c2 1.5 4 4 4 7a6 6 0 1 1-12 0c0-2 1-3.5 2-4.5.2 1.2 1 2 1 2 .3-3 2-4.5 3-9.5Z" />
  </svg>
);
