import "./EmployeeSidebar.css";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, User, CalendarCheck, Plane, Sun, Star, GraduationCap, Package, FileText,
  Users, ClipboardCheck, Settings,
} from "lucide-react";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";

const mainNavItems = [
  { label: "Dashboard", to: employeeRoutePaths.DASHBOARD, icon: LayoutDashboard },
  { label: "My Profile", to: employeeRoutePaths.PROFILE, icon: User },
  { label: "My Attendance", to: employeeRoutePaths.ATTENDANCE, icon: CalendarCheck },
  { label: "My Leave", to: employeeRoutePaths.LEAVE, icon: Plane },
  { label: "Holidays", to: employeeRoutePaths.HOLIDAYS, icon: Sun },
  { label: "My Performance", to: employeeRoutePaths.PERFORMANCE, icon: Star },
  { label: "My Training", to: employeeRoutePaths.TRAINING, icon: GraduationCap },
  { label: "My Assets", to: employeeRoutePaths.ASSETS, icon: Package },
  { label: "My Documents", to: employeeRoutePaths.DOCUMENTS, icon: FileText },
  { label: "Settings", to: employeeRoutePaths.SETTINGS, icon: Settings },
];

const teamNavItems = [
  { label: "My Team", to: employeeRoutePaths.TEAM, icon: Users },
  { label: "Team Attendance", to: employeeRoutePaths.TEAM_ATTENDANCE, icon: CalendarCheck },
  { label: "Team Leave", to: employeeRoutePaths.TEAM_LEAVE, icon: Plane },
  { label: "Team Performance", to: employeeRoutePaths.TEAM_PERFORMANCE, icon: ClipboardCheck },
  { label: "Team Training", to: employeeRoutePaths.TEAM_TRAINING, icon: GraduationCap },
];

function NavItem({ item }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        isActive ? "employee-sidebar__link employee-sidebar__link--active" : "employee-sidebar__link"
      }
    >
      <Icon size={18} className="employee-sidebar__link-icon" />
      {item.label}
    </NavLink>
  );
}

/**
 * hasTeam is passed down from EmployeeLayout, which fetches GET
 * /manager/team once - the MY TEAM section only renders when that call
 * returned at least one direct report. Nothing here is derived from job
 * title or role.
 */
function EmployeeSidebar({ hasTeam, isOpen, onNavigate }) {
  return (
    <aside className={`employee-sidebar${isOpen ? " employee-sidebar--open" : ""}`}>
      <div className="employee-sidebar__brand">
        <span className="employee-sidebar__brand-mark">E</span>
        <span className="employee-sidebar__brand-name">Employee Portal</span>
      </div>

      <nav className="employee-sidebar__nav" onClick={onNavigate}>
        {mainNavItems.map((item) => (
          <NavItem key={item.to} item={item} />
        ))}

        {hasTeam && (
          <>
            <p className="employee-sidebar__section-label">My Team</p>
            {teamNavItems.map((item) => (
              <NavItem key={item.to} item={item} />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}

export default EmployeeSidebar;