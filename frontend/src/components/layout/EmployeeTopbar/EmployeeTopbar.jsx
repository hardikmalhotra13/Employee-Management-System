import "./EmployeeTopbar.css";
import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Menu, LogOut, User, ChevronDown } from "lucide-react";
import useEmployeeAuth from "../../../hooks/useEmployeeAuth.js";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { getMyProfile } from "../../../services/api/employeeSelfApi.js";
import NotificationsBell from "../../common/NotificationsBell/NotificationsBell.jsx";
import {
  getMyNotifications,
  getMyUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../../services/api/employeeNotificationApi.js";

const pageTitles = [
  { path: employeeRoutePaths.DASHBOARD, title: "Dashboard" },
  { path: employeeRoutePaths.PROFILE, title: "My Profile" },
  { path: employeeRoutePaths.ATTENDANCE, title: "My Attendance" },
  { path: employeeRoutePaths.TEAM_ATTENDANCE, title: "Team Attendance" },
  { path: employeeRoutePaths.LEAVE, title: "My Leave" },
  { path: employeeRoutePaths.HOLIDAYS, title: "Holidays" },
  { path: employeeRoutePaths.TEAM_LEAVE, title: "Team Leave" },
  { path: employeeRoutePaths.PERFORMANCE, title: "My Performance" },
  { path: employeeRoutePaths.TEAM_PERFORMANCE, title: "Team Performance" },
  { path: employeeRoutePaths.TRAINING, title: "My Training" },
  { path: employeeRoutePaths.TEAM_TRAINING, title: "Team Training" },
  { path: employeeRoutePaths.ASSETS, title: "My Assets" },
  { path: employeeRoutePaths.DOCUMENTS, title: "My Documents" },
  { path: employeeRoutePaths.NOTIFICATIONS, title: "Notifications" },
  { path: employeeRoutePaths.SETTINGS, title: "Settings" },
  { path: employeeRoutePaths.TEAM, title: "My Team" },
];

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

// NotificationsBell expects getNotifications() to resolve to { records }
// (the shape the paginated admin endpoint returns). The employee
// notification list endpoint isn't paginated - it just resolves to a flat
// array - so calling it directly made data.records undefined and the
// dropdown rendered blank. This adapts the response without touching the
// shared component or the employee notification backend.
async function fetchNotificationsForBell(params) {
  const records = await getMyNotifications(params);
  return { records };
}

function EmployeeTopbar({ onMenuClick }) {
  const { logout } = useEmployeeAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const menuRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    getMyProfile()
      .then(setProfile)
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentTitle =
    pageTitles.find((entry) => location.pathname.startsWith(entry.path))?.title || "Employee Portal";

  return (
    <header className="employee-topbar">
      <div className="employee-topbar__left">
        <button type="button" className="employee-topbar__menu-button" onClick={onMenuClick} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <p className="employee-topbar__title">{currentTitle}</p>
      </div>

      <div className="employee-topbar__actions">
        <NotificationsBell
          getNotifications={fetchNotificationsForBell}
          getUnreadCount={getMyUnreadNotificationCount}
          markRead={markNotificationRead}
          markAllRead={markAllNotificationsRead}
          viewAllPath={employeeRoutePaths.NOTIFICATIONS}
        />

        <div className="employee-topbar__identity" ref={menuRef}>
          <button
            type="button"
            className="employee-topbar__identity-trigger"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span className="employee-topbar__avatar">
              {getInitials(profile?.first_name, profile?.last_name) || <User size={16} />}
            </span>
            <span className="employee-topbar__identity-text">
              <span className="employee-topbar__name">
                {profile ? `${profile.first_name} ${profile.last_name}` : "Employee"}
              </span>
              <span className="employee-topbar__role">{profile?.role_name || ""}</span>
            </span>
            <ChevronDown size={15} className="employee-topbar__chevron" />
          </button>

          {isMenuOpen && (
            <div className="employee-topbar__menu-panel">
              <button
                type="button"
                className="employee-topbar__menu-item"
                onClick={() => {
                  setIsMenuOpen(false);
                  navigate(employeeRoutePaths.PROFILE);
                }}
              >
                <User size={15} />
                My Profile
              </button>
              <button
                type="button"
                className="employee-topbar__menu-item employee-topbar__menu-item--danger"
                onClick={logout}
              >
                <LogOut size={15} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default EmployeeTopbar;