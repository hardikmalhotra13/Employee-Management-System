import "./DashboardPage.css";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, UserCheck, Building2, Clock, UserPlus, CalendarClock, Plane,
  History, Cake, Award, CheckCircle2, Hourglass, XCircle, ClipboardList,
  ArrowRight, PlusCircle, Pencil, Archive, RotateCcw, Upload, Trash2,
} from "lucide-react";
import routePaths from "../../../routes/routePaths.js";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import {
  getDashboardSummary,
  getDashboardCharts,
  getDashboardUpcomingEvents,
  getDashboardLeaveSummary,
} from "../../../services/api/dashboardApi.js";
import { listActivityLog } from "../../../services/api/auditApi.js";

const ACTION_ICONS = {
  create: PlusCircle,
  update: Pencil,
  archive: Archive,
  restore: RotateCcw,
  upload: Upload,
  delete: Trash2,
};

const ACTION_LABELS = {
  create: "created",
  update: "updated",
  archive: "archived",
  restore: "restored",
  upload: "uploaded",
  delete: "deleted",
};

const STATUS_BADGE_VARIANT = {
  Active: "success",
  "On Probation": "info",
  "On Notice": "warning",
  Inactive: "danger",
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const UPCOMING_WINDOW_LABEL = "Next 30 days";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getTodayLabel() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDetails(row) {
  if (!row.record_name) return `#${row.record_id}`;
  if (row.entity === "employee" && row.record_code) {
    return `${row.record_name} (${row.record_code})`;
  }
  return row.record_name;
}

// created_at arrives as a plain "YYYY-MM-DD HH:MM:SS" string with no
// timezone marker (see backend get_activity_log). Formatted manually here,
// without constructing a JS Date object, to match the same convention
// already used in the Settings > Activity Log screen.
function formatTimestamp(value) {
  if (!value) return value;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return value;
  const [, , month, day, hour, minute] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  const hourNum = Number(hour);
  const period = hourNum >= 12 ? "PM" : "AM";
  const displayHour = hourNum % 12 === 0 ? 12 : hourNum % 12;
  return `${Number(day)} ${monthName}, ${String(displayHour).padStart(2, "0")}:${minute} ${period}`;
}

function formatDaysUntil(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

function DashboardPage() {
  const navigate = useNavigate();
  const { admin } = useAuth();
  const firstName = admin?.name ? admin.name.split(" ")[0] : "there";

  const canViewActivity = hasPermission(admin, "activity_log.view");
  const canViewLeave = hasPermission(admin, "leave.view");

  const [summary, setSummary] = useState(null);
  const [charts, setCharts] = useState(null);
  const [upcomingEvents, setUpcomingEvents] = useState(null);
  const [activity, setActivity] = useState(null);
  const [leaveSummary, setLeaveSummary] = useState(null);

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch(() => setSummary({
        total_employees: 0,
        active_employees: 0,
        total_departments: 0,
        total_shifts: 0,
      }));

    getDashboardCharts()
      .then(setCharts)
      .catch(() => setCharts({
        employees_by_department: [],
        active_vs_inactive: { active_count: 0, inactive_count: 0 },
        recent_employees: [],
      }));

    getDashboardUpcomingEvents()
      .then(setUpcomingEvents)
      .catch(() => setUpcomingEvents({ upcoming_birthdays: [], upcoming_anniversaries: [] }));

    if (canViewActivity) {
      listActivityLog({ page: 1, pageSize: 5 })
        .then((result) => setActivity(result.records))
        .catch(() => setActivity([]));
    }
    if (canViewLeave) {
      getDashboardLeaveSummary()
        .then(setLeaveSummary)
        .catch(() => setLeaveSummary({ total_requests: 0, approved: 0, pending: 0, rejected: 0 }));
    }
    // Permission flags come from the JWT and don't change during a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxDepartmentCount = Math.max(
    ...(charts?.employees_by_department || []).map((d) => d.employee_count),
    1
  );

  const totalStatusCount = charts
    ? charts.active_vs_inactive.active_count + charts.active_vs_inactive.inactive_count
    : 0;
  const activePercent = totalStatusCount === 0
    ? 0
    : Math.round((charts.active_vs_inactive.active_count / totalStatusCount) * 100);
  const inactivePercent = totalStatusCount === 0 ? 0 : 100 - activePercent;

  const employeeColumns = [
    {
      key: "name",
      label: "Employee",
      render: (row) => `${row.first_name} ${row.last_name}`,
    },
    { key: "department_name", label: "Department" },
    { key: "role_name", label: "Role" },
    {
      key: "status",
      label: "Status",
      render: (row) => (
        <span className={`dashboard-page__badge dashboard-page__badge--${STATUS_BADGE_VARIANT[row.status] || "info"}`}>
          {row.status}
        </span>
      ),
    },
  ];

  return (
    <div className="dashboard-page">
      <div className="dashboard-page__header">
        <div>
          <h1 className="dashboard-page__title">{getGreeting()}, {firstName}</h1>
          <p className="dashboard-page__subtitle">
            Here's what's happening across your organization today.
          </p>
        </div>
        <p className="dashboard-page__date">{getTodayLabel()}</p>
      </div>

      <div className="dashboard-page__kpi-grid">
        <div className="dashboard-page__kpi-card">
          <div className="dashboard-page__kpi-icon dashboard-page__kpi-icon--accent">
            <Users size={18} />
          </div>
          <p className="dashboard-page__kpi-label">Total employees</p>
          <p className="dashboard-page__kpi-value">{summary?.total_employees ?? "—"}</p>
        </div>

        <div className="dashboard-page__kpi-card">
          <div className="dashboard-page__kpi-icon dashboard-page__kpi-icon--success">
            <UserCheck size={18} />
          </div>
          <p className="dashboard-page__kpi-label">Active employees</p>
          <p className="dashboard-page__kpi-value">{summary?.active_employees ?? "—"}</p>
        </div>

        <div className="dashboard-page__kpi-card">
          <div className="dashboard-page__kpi-icon dashboard-page__kpi-icon--purple">
            <Building2 size={18} />
          </div>
          <p className="dashboard-page__kpi-label">Departments</p>
          <p className="dashboard-page__kpi-value">{summary?.total_departments ?? "—"}</p>
        </div>

        <div className="dashboard-page__kpi-card">
          <div className="dashboard-page__kpi-icon dashboard-page__kpi-icon--warning">
            <Clock size={18} />
          </div>
          <p className="dashboard-page__kpi-label">Shifts</p>
          <p className="dashboard-page__kpi-value">{summary?.total_shifts ?? "—"}</p>
        </div>
      </div>

      <div className="dashboard-page__row dashboard-page__row--charts">
        <div className="dashboard-page__card">
          <p className="dashboard-page__card-title">Employees by department</p>
          <p className="dashboard-page__card-subtitle">Current headcount distribution</p>

          <div className="dashboard-page__bar-chart">
            {(charts?.employees_by_department || []).map((dept) => (
              <div className="dashboard-page__bar-item" key={dept.department_name}>
                <span className="dashboard-page__bar-value">{dept.employee_count}</span>
                <div
                  className="dashboard-page__bar"
                  style={{ height: `${(dept.employee_count / maxDepartmentCount) * 100}%` }}
                />
                <span className="dashboard-page__bar-label">{dept.department_name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-page__card">
          <p className="dashboard-page__card-title">Active vs inactive</p>
          <p className="dashboard-page__card-subtitle">Employee status split</p>

          <div className="dashboard-page__donut-row">
            <div className="dashboard-page__donut-wrap">
              <div
                className="dashboard-page__donut"
                style={{
                  background: `conic-gradient(var(--color-primary) 0% ${activePercent}%, var(--color-border) ${activePercent}% 100%)`,
                }}
              />
              <div className="dashboard-page__donut-center">
                <span className="dashboard-page__donut-total">{totalStatusCount}</span>
                <span className="dashboard-page__donut-total-label">Total</span>
              </div>
            </div>
            <div className="dashboard-page__donut-legend">
              <div className="dashboard-page__legend-item">
                <span className="dashboard-page__legend-dot dashboard-page__legend-dot--accent" />
                Active &middot; {activePercent}%
              </div>
              <div className="dashboard-page__legend-item">
                <span className="dashboard-page__legend-dot dashboard-page__legend-dot--muted" />
                Inactive &middot; {inactivePercent}%
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-page__card">
          <p className="dashboard-page__card-title">Quick actions</p>
          <p className="dashboard-page__card-subtitle">Jump straight into a task</p>

          <div className="dashboard-page__quick-actions">
            <button
              type="button"
              className="dashboard-page__quick-action dashboard-page__quick-action--accent"
              onClick={() => navigate(routePaths.EMPLOYEE_NEW)}
            >
              <UserPlus size={18} />
              Add Employee
            </button>
            <button
              type="button"
              className="dashboard-page__quick-action dashboard-page__quick-action--purple"
              onClick={() => navigate(routePaths.DEPARTMENTS)}
            >
              <Building2 size={18} />
              Add Department
            </button>
            <button
              type="button"
              className="dashboard-page__quick-action dashboard-page__quick-action--success"
              onClick={() => navigate(routePaths.SHIFTS)}
            >
              <CalendarClock size={18} />
              Add Shift
            </button>
            <button
              type="button"
              className="dashboard-page__quick-action dashboard-page__quick-action--warning"
              onClick={() => navigate(routePaths.LEAVE)}
            >
              <Plane size={18} />
              Manage Leave
            </button>
          </div>
        </div>
      </div>

      <div className="dashboard-page__row dashboard-page__row--lists">
        {canViewActivity && (
          <div className="dashboard-page__card">
            <div className="dashboard-page__card-header">
              <div>
                <p className="dashboard-page__card-title">Recent Activity</p>
                <p className="dashboard-page__card-subtitle">Latest actions in the system</p>
              </div>
              <button type="button" className="dashboard-page__view-all" onClick={() => navigate(routePaths.SETTINGS)}>
                View All <ArrowRight size={13} />
              </button>
            </div>

            <ul className="dashboard-page__activity-list">
              {activity === null && <li className="dashboard-page__empty">Loading...</li>}
              {activity?.length === 0 && <li className="dashboard-page__empty">No activity recorded yet</li>}
              {activity?.map((log) => {
                const Icon = ACTION_ICONS[log.action] || History;
                return (
                  <li key={log.log_id} className="dashboard-page__activity-item">
                    <span className="dashboard-page__activity-icon">
                      <Icon size={14} />
                    </span>
                    <span className="dashboard-page__activity-text">
                      <strong>{log.admin_name || "Deleted user"}</strong> {ACTION_LABELS[log.action] || log.action} {log.entity} &middot; {formatDetails(log)}
                    </span>
                    <span className="dashboard-page__activity-time">{formatTimestamp(log.created_at)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="dashboard-page__card">
          <p className="dashboard-page__card-title">Upcoming Birthdays</p>
          <p className="dashboard-page__card-subtitle">{UPCOMING_WINDOW_LABEL}</p>

          <ul className="dashboard-page__people-list">
            {upcomingEvents === null && <li className="dashboard-page__empty">Loading...</li>}
            {upcomingEvents?.upcoming_birthdays.length === 0 && (
              <li className="dashboard-page__empty">No birthdays in the next 30 days</li>
            )}
            {upcomingEvents?.upcoming_birthdays.map((person) => (
              <li key={person.employee_id} className="dashboard-page__person-item">
                <span className="dashboard-page__person-avatar">
                  {person.first_name[0]}{person.last_name[0]}
                </span>
                <span className="dashboard-page__person-info">
                  <span className="dashboard-page__person-name">{person.first_name} {person.last_name}</span>
                  <span className="dashboard-page__person-meta">{person.department_name}</span>
                </span>
                <span className="dashboard-page__person-tag">
                  <Cake size={13} /> {formatDaysUntil(person.days_until)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="dashboard-page__card">
          <p className="dashboard-page__card-title">Upcoming Work Anniversaries</p>
          <p className="dashboard-page__card-subtitle">{UPCOMING_WINDOW_LABEL}</p>

          <ul className="dashboard-page__people-list">
            {upcomingEvents === null && <li className="dashboard-page__empty">Loading...</li>}
            {upcomingEvents?.upcoming_anniversaries.length === 0 && (
              <li className="dashboard-page__empty">No anniversaries in the next 30 days</li>
            )}
            {upcomingEvents?.upcoming_anniversaries.map((person) => (
              <li key={person.employee_id} className="dashboard-page__person-item">
                <span className="dashboard-page__person-avatar">
                  {person.first_name[0]}{person.last_name[0]}
                </span>
                <span className="dashboard-page__person-info">
                  <span className="dashboard-page__person-name">{person.first_name} {person.last_name}</span>
                  <span className="dashboard-page__person-meta">{person.department_name}</span>
                </span>
                <span className="dashboard-page__person-tag">
                  <Award size={13} /> {person.years_of_service} yr{person.years_of_service === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="dashboard-page__row dashboard-page__row--bottom">
        {canViewLeave && (
          <div className="dashboard-page__card dashboard-page__card--leave">
            <div className="dashboard-page__card-header">
              <div>
                <p className="dashboard-page__card-title">Leave Summary</p>
                <p className="dashboard-page__card-subtitle">Current month overview</p>
              </div>
              <button type="button" className="dashboard-page__view-all" onClick={() => navigate(routePaths.LEAVE)}>
                View All <ArrowRight size={13} />
              </button>
            </div>

            <div className="dashboard-page__leave-chips">
              <div className="dashboard-page__leave-chip">
                <span className="dashboard-page__leave-chip-icon dashboard-page__leave-chip-icon--accent">
                  <ClipboardList size={16} />
                </span>
                <span className="dashboard-page__leave-chip-value">{leaveSummary?.total_requests ?? "—"}</span>
                <span className="dashboard-page__leave-chip-label">Total Requests</span>
              </div>
              <div className="dashboard-page__leave-chip">
                <span className="dashboard-page__leave-chip-icon dashboard-page__leave-chip-icon--success">
                  <CheckCircle2 size={16} />
                </span>
                <span className="dashboard-page__leave-chip-value">{leaveSummary?.approved ?? "—"}</span>
                <span className="dashboard-page__leave-chip-label">Approved</span>
              </div>
              <div className="dashboard-page__leave-chip">
                <span className="dashboard-page__leave-chip-icon dashboard-page__leave-chip-icon--warning">
                  <Hourglass size={16} />
                </span>
                <span className="dashboard-page__leave-chip-value">{leaveSummary?.pending ?? "—"}</span>
                <span className="dashboard-page__leave-chip-label">Pending</span>
              </div>
              <div className="dashboard-page__leave-chip">
                <span className="dashboard-page__leave-chip-icon dashboard-page__leave-chip-icon--danger">
                  <XCircle size={16} />
                </span>
                <span className="dashboard-page__leave-chip-value">{leaveSummary?.rejected ?? "—"}</span>
                <span className="dashboard-page__leave-chip-label">Rejected</span>
              </div>
            </div>
          </div>
        )}

        <div className="dashboard-page__card dashboard-page__card--table" style={canViewLeave ? undefined : { gridColumn: "1 / -1" }}>
          <div className="dashboard-page__card-header">
            <div>
              <p className="dashboard-page__card-title">Recently Added Employees</p>
              <p className="dashboard-page__card-subtitle">Latest 3 additions</p>
            </div>
            <button type="button" className="dashboard-page__view-all" onClick={() => navigate(routePaths.EMPLOYEES)}>
              View All <ArrowRight size={13} />
            </button>
          </div>

          <DataTable
            columns={employeeColumns}
            rows={charts?.recent_employees || []}
            isLoading={charts === null}
            emptyMessage="No employees added yet"
          />
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;