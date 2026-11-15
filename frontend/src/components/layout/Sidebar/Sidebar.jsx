import "./Sidebar.css";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Users, Building2, ShieldCheck, Star, Clock, CalendarDays, CalendarCheck, Plane, Sun,
  Boxes, Package, UserPlus, UserMinus, ClipboardList, GraduationCap, Settings,
} from "lucide-react";
import routePaths from "../../../routes/routePaths.js";

const navItems = [
  { label: "Dashboard", to: routePaths.DASHBOARD, icon: LayoutDashboard },
  { label: "Employees", to: routePaths.EMPLOYEES, icon: Users },
  { label: "Departments", to: routePaths.DEPARTMENTS, icon: Building2 },
  { label: "Roles", to: routePaths.ROLES, icon: ShieldCheck },
  { label: "Grades", to: routePaths.GRADES, icon: Star },
  { label: "Shifts", to: routePaths.SHIFTS, icon: Clock },
  { label: "Roster", to: routePaths.ROSTER, icon: CalendarDays },
  { label: "Attendance", to: routePaths.ATTENDANCE, icon: CalendarCheck },
  { label: "Holidays", to: routePaths.HOLIDAYS, icon: Sun },
  { label: "Leave", to: routePaths.LEAVE, icon: Plane },
  { label: "Asset Types", to: routePaths.ASSET_TYPES, icon: Boxes },
  { label: "Assets", to: routePaths.ASSETS, icon: Package },
  { label: "Onboarding", to: routePaths.ONBOARDING_ITEMS, icon: UserPlus },
  { label: "Offboarding", to: routePaths.OFFBOARDING_ITEMS, icon: UserMinus },
  { label: "Review Cycles", to: routePaths.REVIEW_CYCLES, icon: ClipboardList },
  { label: "Training Programs", to: routePaths.TRAINING_PROGRAMS, icon: GraduationCap },
  { label: "Settings", to: routePaths.SETTINGS, icon: Settings },
];

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">E</span>
        <span className="sidebar__brand-name">Employee Management System</span>
      </div>
      <nav className="sidebar__nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "sidebar__link sidebar__link--active" : "sidebar__link"
              }
            >
              <Icon size={18} className="sidebar__link-icon" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;