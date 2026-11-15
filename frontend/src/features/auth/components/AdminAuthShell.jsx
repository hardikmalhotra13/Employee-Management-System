import "./AdminAuthShell.css";
import {
  Users, ShieldCheck, CalendarClock, TrendingUp,
  User, CalendarCheck, FileText, GraduationCap,
} from "lucide-react";

// Left-panel copy for each audience. Every employee feature listed here
// is something the Employee Portal actually supports today.
const PANEL_CONTENT = {
  admin: {
    heading: "Manage your workforce with confidence.",
    subheading:
      "A single, secure workspace for employee records, attendance, leave, performance, training and more.",
    features: [
      { icon: Users, label: "Centralized employee records" },
      { icon: ShieldCheck, label: "Role-based access control" },
      { icon: CalendarClock, label: "Attendance, leave & roster management" },
      { icon: TrendingUp, label: "Performance & training oversight" },
    ],
  },
  employee: {
    heading: (
      <>
        Your work,
        <br />
        all in one place.
      </>
    ),
    subheading:
      "Access your profile, attendance, leave, training, documents and more — anytime, anywhere.",
    features: [
      { icon: User, label: "View and update your profile" },
      { icon: CalendarCheck, label: "Mark attendance and view rosters" },
      { icon: FileText, label: "Apply for leave and track status" },
      { icon: GraduationCap, label: "Access training and certifications" },
    ],
  },
};

// Shared split-layout shell for the authentication screens. Used by the
// Admin screens (Login, Forgot Password, Set Password, Google callback)
// with the default "admin" variant, and by the Employee Login with
// variant="employee" - same layout and form styles, blue theme and
// employee-specific copy. (The class prefix stays "admin-auth" so the
// existing admin pages don't need touching.)
function AdminAuthShell({ children, cardClassName = "", variant = "admin" }) {
  const panel = PANEL_CONTENT[variant] || PANEL_CONTENT.admin;
  const rootClassName = variant === "employee" ? "admin-auth admin-auth--employee" : "admin-auth";

  return (
    <div className={rootClassName}>
      <aside className="admin-auth__panel">
        <div className="admin-auth__panel-glow admin-auth__panel-glow--one" />
        <div className="admin-auth__panel-glow admin-auth__panel-glow--two" />

        <div className="admin-auth__panel-content">
          <div className="admin-auth__brand">
            <span className="admin-auth__brand-mark">E</span>
            <div>
              <p className="admin-auth__brand-name">EMS</p>
              <p className="admin-auth__brand-tagline">Employee Management System</p>
            </div>
          </div>

          <div className="admin-auth__panel-copy">
            <h2 className="admin-auth__panel-heading">{panel.heading}</h2>
            <p className="admin-auth__panel-subheading">{panel.subheading}</p>

            <ul className="admin-auth__features">
              {panel.features.map(({ icon: Icon, label }) => (
                <li key={label} className="admin-auth__feature">
                  <span className="admin-auth__feature-icon"><Icon size={15} /></span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="admin-auth__panel-footer">Built for people-first organizations.</p>
        </div>
      </aside>

      <div className="admin-auth__content">
        <div className={`admin-auth__card ${cardClassName}`.trim()}>
          {children}
        </div>
      </div>
    </div>
  );
}

export default AdminAuthShell;