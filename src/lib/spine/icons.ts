// Per-resource and per-group iconography so each nav section reads distinctly.
import {
  Truck, Users, FileText, Receipt, UserRound, CalendarDays, Boxes, Wrench,
  Flag, Handshake, Target, FileSignature, ShieldAlert, CalendarCheck,
  LifeBuoy, Lightbulb, Gauge, Leaf, Building2, BookOpen, ClipboardCheck,
  ScrollText, Home, type LucideIcon,
} from "lucide-react";

const BY_SLUG: Record<string, LucideIcon> = {
  vendors: Truck,
  customers: Users,
  quotations: FileText,
  "ar-invoices": Receipt,
  employees: UserRound,
  leave: CalendarDays,
  assets: Boxes,
  "work-orders": Wrench,
  milestones: Flag,
  engagements: Handshake,
  opportunities: Target,
  contracts: FileSignature,
  risks: ShieldAlert,
  compliance: CalendarCheck,
  tickets: LifeBuoy,
  concepts: Lightbulb,
  kpis: Gauge,
  impact: Leaf,
};

const BY_GROUP: Record<string, LucideIcon> = {
  Overview: Home,
  "Procure-to-Pay": Truck,
  Revenue: Receipt,
  People: Users,
  Assets: Boxes,
  Projects: Flag,
  CRM: Handshake,
  Intelligence: Gauge,
  Governance: ScrollText,
  "Field & Portals": LifeBuoy,
  "Business Development": Lightbulb,
  Spine: Building2,
  Settings: BookOpen,
};

export function resourceIcon(slug?: string, group?: string): LucideIcon {
  return (slug && BY_SLUG[slug]) || (group && BY_GROUP[group]) || ClipboardCheck;
}
