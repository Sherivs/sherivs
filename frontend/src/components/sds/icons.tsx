import {
  Activity, AlertTriangle, Award, Baby, Banknote, BarChart3, Bed, BedDouble, Bell, BookOpen, Briefcase, Bus, Calendar, CalendarClock,
  CheckSquare, Clipboard, ClipboardCheck, FileCheck, FileText, Gavel, HeartPulse, Home, IdCard, Inbox, Key, Landmark, Library, Megaphone,
  MessageSquare, Monitor, Navigation, Plane, Receipt, Scale, Settings, Shield, ShieldAlert, Siren, Sparkles, Star, TrendingUp, UserPlus,
  UserX, Users, Wallet, type LucideIcon,
} from "lucide-react";
const MAP: Record<string, LucideIcon> = {
  activity: Activity, "alert-triangle": AlertTriangle, award: Award, baby: Baby, banknote: Banknote, "bar-chart": BarChart3, bed: Bed,
  "bed-double": BedDouble, bell: Bell, "book-open": BookOpen, briefcase: Briefcase, bus: Bus, calendar: Calendar, "calendar-clock": CalendarClock,
  "check-square": CheckSquare, clipboard: Clipboard, "clipboard-check": ClipboardCheck, "file-check": FileCheck, "file-text": FileText, gavel: Gavel,
  "heart-pulse": HeartPulse, home: Home, "id-card": IdCard, inbox: Inbox, key: Key, landmark: Landmark, library: Library, megaphone: Megaphone,
  message: MessageSquare, monitor: Monitor, navigation: Navigation, plane: Plane, receipt: Receipt, scale: Scale, settings: Settings, shield: Shield,
  "shield-alert": ShieldAlert, siren: Siren, sparkles: Sparkles, star: Star, "trending-up": TrendingUp, "user-plus": UserPlus, "user-x": UserX,
  users: Users, wallet: Wallet,
};
export function SdsIcon({ name, size = 20 }: { name: string; size?: number }) {
  const I = MAP[name] ?? Activity;
  return <I size={size} aria-hidden="true" focusable="false" />;
}
