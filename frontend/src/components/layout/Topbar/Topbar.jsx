import "./AdminTopbar.css";
import { LogOut } from "lucide-react";
import { useLocation } from "react-router-dom";
import useAuth from "../../../hooks/useAuth.js";
import routePaths from "../../../routes/routePaths.js";
import NotificationsBell from "../../common/NotificationsBell/NotificationsBell.jsx";
import {
  getMyAdminNotifications,
  getMyAdminUnreadNotificationCount,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
} from "../../../services/api/adminNotificationApi.js";

const pageTitles = [
  { path: routePaths.DASHBOARD, title: "Dashboard" },
  { path: routePaths.EMPLOYEES, title: "Employees" },
  { path: routePaths.EMPLOYEE_NEW, title: "Add Employee" },
  { path: routePaths.DEPARTMENTS, title: "Departments" },
  { path: routePaths.ROLES, title: "Roles & Permissions" },
  { path: routePaths.GRADES, title: "Grades" },
  { path: routePaths.SHIFTS, title: "Shifts" },
  { path: routePaths.ROSTER, title: "Roster" },
  { path: routePaths.ATTENDANCE, title: "Attendance" },
  { path: routePaths.HOLIDAYS, title: "Holidays" },
  { path: routePaths.LEAVE, title: "Leave" },
  { path: routePaths.ASSET_TYPES, title: "Asset Types" },
  { path: routePaths.ASSETS, title: "Assets" },
  { path: routePaths.ONBOARDING_ITEMS, title: "Onboarding" },
  { path: routePaths.OFFBOARDING_ITEMS, title: "Offboarding" },
  { path: routePaths.REVIEW_CYCLES, title: "Performance Review Cycles" },
  { path: routePaths.TRAINING_PROGRAMS, title: "Training & Certifications" },
  { path: routePaths.SETTINGS, title: "Settings" },
  { path: routePaths.NOTIFICATIONS, title: "Notifications" },
];

function getPageTitle(pathname) {
  const match = pageTitles.find((item) => item.path === pathname);
  if (match) return match.title;

  if (/^\/admin\/employees\/.+\/edit$/.test(pathname)) {
    return "Edit Employee";
  }
  if (/^\/admin\/employees\/.+$/.test(pathname)) {
    return "Employee Profile";
  }

  return "Dashboard";
}

function getInitials(name) {
  if (!name) return "A";
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`
    : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

function Topbar() {
  const { admin, logout } = useAuth();
  const location = useLocation();
  const pageTitle = getPageTitle(location.pathname);

  return (
    <header className="admin-topbar">
      <h1 className="admin-topbar__title">{pageTitle}</h1>
      <div className="admin-topbar__actions">
        <NotificationsBell
          getNotifications={getMyAdminNotifications}
          getUnreadCount={getMyAdminUnreadNotificationCount}
          markRead={markAdminNotificationRead}
          markAllRead={markAllAdminNotificationsRead}
          viewAllPath={routePaths.NOTIFICATIONS}
        />
        <div className="admin-topbar__identity">
          <span className="admin-topbar__avatar">{getInitials(admin?.name)}</span>
          <span className="admin-topbar__identity-text">
            <span className="admin-topbar__admin-name">{admin?.name || "Admin"}</span>
            <span className="admin-topbar__admin-role">{admin?.role || ""}</span>
          </span>
        </div>
        <button type="button" className="admin-topbar__logout" onClick={logout}>
          <LogOut size={15} />
          Logout
        </button>
      </div>
    </header>
  );
}

export default Topbar;