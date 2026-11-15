import "./EmployeeDashboardPage.css";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";
import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Calendar, Plane, GraduationCap, Package, Clock, Bell, LayoutGrid, Users,
  User, FileText, CheckCircle2, ArrowRight, CheckCircle,
} from "lucide-react";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { checkIn, checkOut } from "../../../services/api/employeeSelfApi.js";
import { getMyDashboard, getCachedDashboard, invalidateDashboardCache } from "../../../services/api/employeeDashboardApi.js";
import { markNotificationRead } from "../../../services/api/employeeNotificationApi.js";
import { broadcastNotificationsChanged } from "../../../utils/notificationEvents.js";
import { NOTIFICATION_TYPE_ICONS } from "../../../components/common/NotificationsBell/NotificationsBell.jsx";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatClockTime(value) {
  // "YYYY-MM-DD HH:MM:SS" -> "HH:MM", same slicing MyAttendancePage.jsx uses
  return value ? value.slice(11, 16) : "";
}

function formatShiftTime(value) {
  // "HH:MM:SS" 24h -> "h:MM AM/PM"
  if (!value) return "";
  const [hourStr, minuteStr] = value.split(":");
  const hour = parseInt(hourStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minuteStr} ${period}`;
}

function formatNotificationTime(value) {
  // "YYYY-MM-DD HH:MM:SS" -> a short relative label
  const then = new Date(value.replace(" ", "T"));
  const diffMs = Date.now() - then.getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const quickActions = [
  { label: "My Attendance", to: employeeRoutePaths.ATTENDANCE, icon: Calendar },
  { label: "Apply Leave", to: employeeRoutePaths.LEAVE, icon: Plane },
  { label: "My Training", to: employeeRoutePaths.TRAINING, icon: GraduationCap },
  { label: "My Assets", to: employeeRoutePaths.ASSETS, icon: Package },
  { label: "My Documents", to: employeeRoutePaths.DOCUMENTS, icon: FileText },
  { label: "My Profile", to: employeeRoutePaths.PROFILE, icon: User },
];

// Purely presentational color per leave type (CL/EL are the only real types
// this project has - LEAVE_TYPES in leave_routes.py) and per notification
// type (same types already written by notification_helper.py call sites).
// No new data, categories, or types are introduced here.
const LEAVE_TYPE_COLOR = { CL: "blue", EL: "green" };

const NOTIFICATION_TYPE_COLOR = {
  leave_submitted: "amber",
  onboarding_started: "blue",
  onboarding_completed: "blue",
  offboarding_started: "rose",
  offboarding_completed: "rose",
  training_assigned: "violet",
  training_completed: "violet",
  asset_assigned: "indigo",
  asset_returned: "indigo",
  document_uploaded: "violet",
  performance_review_submitted: "green",
  holiday_declared: "violet",
  holiday_updated: "violet",
  holiday_cancelled: "violet",
};

function SummaryCard({ icon: Icon, title, badge, children, to, linkLabel }) {
  return (
    <div className="employee-dashboard__summary-card">
      <div className="employee-dashboard__summary-header">
        <span className="employee-dashboard__summary-icon">
          <Icon size={16} />
        </span>
        <p className="employee-dashboard__summary-title">{title}</p>
        {badge}
      </div>
      <div className="employee-dashboard__summary-body">{children}</div>
      {to && (
        <Link to={to} className="employee-dashboard__summary-link">
          {linkLabel} <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="employee-dashboard">
      <div className="employee-dashboard__welcome">
        <div>
          <div className="skeleton employee-dashboard__skeleton-title" />
          <div className="skeleton employee-dashboard__skeleton-subtitle" />
        </div>
      </div>

      <div className="employee-dashboard__summary-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="employee-dashboard__summary-card">
            <div className="skeleton employee-dashboard__skeleton-icon" />
            <div className="skeleton employee-dashboard__skeleton-number" />
            <div className="skeleton employee-dashboard__skeleton-caption" />
          </div>
        ))}
      </div>

      <div className="employee-dashboard__row">
        <div className="employee-dashboard__card">
          <div className="skeleton employee-dashboard__skeleton-line" />
          <div className="skeleton employee-dashboard__skeleton-line employee-dashboard__skeleton-line--short" />
        </div>
        <div className="employee-dashboard__card">
          <div className="skeleton employee-dashboard__skeleton-line" />
          <div className="skeleton employee-dashboard__skeleton-line employee-dashboard__skeleton-line--short" />
        </div>
      </div>

      <div className="employee-dashboard__row">
        <div className="employee-dashboard__card">
          <div className="skeleton employee-dashboard__skeleton-line" />
          <div className="skeleton employee-dashboard__skeleton-line" />
          <div className="skeleton employee-dashboard__skeleton-line employee-dashboard__skeleton-line--short" />
        </div>
        <div className="employee-dashboard__card">
          <div className="skeleton employee-dashboard__skeleton-line" />
          <div className="skeleton employee-dashboard__skeleton-line" />
        </div>
      </div>
    </div>
  );
}

function EmployeeDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(getCachedDashboard());
  const [isLoading, setIsLoading] = useState(!getCachedDashboard());
  const [loadError, setLoadError] = useState("");
  const [isAttendanceSubmitting, setIsAttendanceSubmitting] = useState(false);
  const [attendanceError, setAttendanceError] = useState("");

  // The mount-time refresh, the refresh after check-in/out and the notification click can all be
  // in flight together, in any order. Only the latest request may update the page, and a
  // notification already marked read here stays read even if an older response says otherwise.
  const latestDashboardRequest = useRef(0);
  const locallyReadNotificationIds = useRef(new Set());

  const showDashboard = (requestId, result) => {
    if (requestId !== latestDashboardRequest.current) return;

    setData({
      ...result,
      recent_notifications: (result.recent_notifications || []).map((n) =>
        locallyReadNotificationIds.current.has(n.notification_id) ? { ...n, is_read: true } : n
      ),
    });
  };

  useEffect(() => {
    const cached = getCachedDashboard();
    const requestId = ++latestDashboardRequest.current;

    if (cached) {
      // Instant paint from cache, then quietly refresh in the background
      // so the data doesn't go stale without another loading flash.
      getMyDashboard({ forceRefresh: true })
        .then((result) => showDashboard(requestId, result))
        .catch(() => {});
      return;
    }

    setIsLoading(true);
    setLoadError("");

    getMyDashboard()
      .then((result) => showDashboard(requestId, result))
      .catch(() => setLoadError("Failed to load your dashboard. Please try again."))
      .finally(() => setIsLoading(false));
  }, []);

  const refreshDashboard = () => {
    const requestId = ++latestDashboardRequest.current;
    getMyDashboard({ forceRefresh: true })
      .then((result) => showDashboard(requestId, result))
      .catch(() => {});
  };

  const handleCheckIn = async () => {
    setAttendanceError("");
    setIsAttendanceSubmitting(true);
    try {
      await checkIn();
      refreshDashboard();
    } catch (err) {
      setAttendanceError(err.response?.data?.message || "Failed to check in.");
    } finally {
      setIsAttendanceSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    setAttendanceError("");
    setIsAttendanceSubmitting(true);
    try {
      await checkOut();
      refreshDashboard();
    } catch (err) {
      setAttendanceError(err.response?.data?.message || "Failed to check out.");
    } finally {
      setIsAttendanceSubmitting(false);
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.notification_id);
        locallyReadNotificationIds.current.add(notification.notification_id);
        // The cached dashboard still lists it as unread, and a request already in flight
        // must not write that back into the cache.
        invalidateDashboardCache();
        setData((prev) => ({
          ...prev,
          recent_notifications: prev.recent_notifications.map((n) =>
            n.notification_id === notification.notification_id ? { ...n, is_read: true } : n
          ),
        }));
        broadcastNotificationsChanged();
      } catch (err) {
        // ignore - navigation still proceeds
      }
    }

    if (notification.link) {
      navigate(notification.link);
    }
  };

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (loadError && !data) {
    return (
      <div className="employee-dashboard">
        <p className="employee-dashboard__error">{loadError}</p>
      </div>
    );
  }

  const {
    profile,
    today_attendance: todayAttendance,
    leave_balance: leaveBalance = [],
    pending_leave_count: pendingLeaveCount = 0,
    is_on_leave_today: isOnLeaveToday = false,
    training_assigned_count: assignedTrainingCount = 0,
    training_completed_count: completedTrainingCount = 0,
    current_assets_count: currentAssetsCount = 0,
    latest_review: latestReview,
    today_schedule: todaySchedule,
    today_day: todayDay,
    recent_notifications: recentNotifications = [],
    team_count: teamCount = 0,
    team_preview: teamPreview = [],
  } = data || {};

  const remainingLeave = leaveBalance.reduce((sum, entry) => sum + entry.remaining, 0);

  return (
    <div className="employee-dashboard">
      <div className="employee-dashboard__welcome">
        <div>
          <h1 className="employee-dashboard__welcome-title">
            {greeting()}, {profile?.first_name || "there"}! 👋
          </h1>
          <p className="employee-dashboard__welcome-subtitle">Here's your work overview for today.</p>
        </div>
        <p className="employee-dashboard__welcome-date">{formatToday()}</p>
      </div>

      <div className="employee-dashboard__summary-grid">
        <SummaryCard
          icon={Calendar}
          title="Today's Attendance"
          to={employeeRoutePaths.ATTENDANCE}
          linkLabel="View attendance"
          badge={
            todayAttendance?.check_in_time && (
              <span className="employee-dashboard__pill employee-dashboard__pill--success">
                {todayAttendance.check_out_time ? "Checked Out" : "Checked In"}
              </span>
            )
          }
        >
          {isOnLeaveToday ? (
            <p className="employee-dashboard__attendance-status">On approved leave today</p>
          ) : todayAttendance?.check_in_time ? (
            <>
              <p className="employee-dashboard__attendance-time">
                {formatClockTime(todayAttendance.check_in_time)}
              </p>
              <p className="employee-dashboard__attendance-caption">
                {todayAttendance.check_out_time
                  ? `Checked out at ${formatClockTime(todayAttendance.check_out_time)}`
                  : "Checked in today"}
              </p>
              {!todayAttendance.check_out_time && (
                <button
                  type="button"
                  className="employee-dashboard__attendance-button"
                  onClick={handleCheckOut}
                  disabled={isAttendanceSubmitting}
                >
                  Check Out
                </button>
              )}
            </>
          ) : (
            <>
              <p className="employee-dashboard__attendance-status employee-dashboard__attendance-status--pending">
                Not checked in yet
              </p>
              <button
                type="button"
                className="employee-dashboard__attendance-button"
                onClick={handleCheckIn}
                disabled={isAttendanceSubmitting}
              >
                Check In
              </button>
            </>
          )}
          {attendanceError && <p className="employee-dashboard__attendance-error">{attendanceError}</p>}
        </SummaryCard>

        <SummaryCard icon={Plane} title="Leave" to={employeeRoutePaths.LEAVE} linkLabel="View leave">
          <p className="employee-dashboard__summary-number">{remainingLeave}</p>
          <p className="employee-dashboard__summary-caption">days available</p>
          <div className="employee-dashboard__leave-types">
            {leaveBalance.map((entry) => (
              <span
                key={entry.leave_type}
                className={`employee-dashboard__leave-type-chip employee-dashboard__leave-type-chip--${
                  LEAVE_TYPE_COLOR[entry.leave_type] || "gray"
                }`}
              >
                {entry.leave_type} {entry.remaining}
              </span>
            ))}
          </div>
          {pendingLeaveCount > 0 && (
            <span className="employee-dashboard__pending-pill">{pendingLeaveCount} pending request(s)</span>
          )}
        </SummaryCard>

        <SummaryCard icon={GraduationCap} title="Training" to={employeeRoutePaths.TRAINING} linkLabel="View training">
          <p className="employee-dashboard__summary-number">{assignedTrainingCount}</p>
          <p className="employee-dashboard__summary-caption">assigned</p>
          <p className="employee-dashboard__summary-note">{completedTrainingCount} completed</p>
        </SummaryCard>

        <SummaryCard icon={Package} title="Assets" to={employeeRoutePaths.ASSETS} linkLabel="View assets">
          <p className="employee-dashboard__summary-number">{currentAssetsCount}</p>
          <p className="employee-dashboard__summary-caption">currently assigned</p>
        </SummaryCard>
      </div>

      <div className="employee-dashboard__row">
        <div className="employee-dashboard__card">
          <div className="employee-dashboard__card-header">
            <h2 className="employee-dashboard__card-title">
              <Clock size={16} /> Today's Schedule
            </h2>
            {todayDay?.kind && <DayKindBadge kind={todayDay.kind} title={todayDay.title} />}
          </div>
          {todayDay && !todayDay.is_working_day && !todaySchedule?.is_override ? (
            // A holiday / weekend, and the employee is not specifically rostered for it: show the day
            // off instead of their default shift. A roster entry (is_override) falls through to the
            // real schedule below.
            <div className="employee-dashboard__schedule">
              <div className="employee-dashboard__schedule-row">
                <div>
                  <p className="employee-dashboard__schedule-shift">{todayDay.title}</p>
                  <p className="employee-dashboard__schedule-time">Office closed - no shift scheduled</p>
                </div>
                <span className="employee-dashboard__schedule-badge employee-dashboard__schedule-badge--off">
                  Day off
                </span>
              </div>
            </div>
          ) : todaySchedule ? (
            <div className="employee-dashboard__schedule">
              <div className="employee-dashboard__schedule-row">
                <div>
                  <p className="employee-dashboard__schedule-shift">{todaySchedule.shift_name}</p>
                  <p className="employee-dashboard__schedule-time">
                    {formatShiftTime(todaySchedule.start_time)} - {formatShiftTime(todaySchedule.end_time)}
                  </p>
                </div>
                <span className="employee-dashboard__schedule-badge">
                  <CheckCircle size={12} />
                  Scheduled for today
                </span>
              </div>
            </div>
          ) : (
            <p className="employee-dashboard__empty-note">No shift scheduled for today.</p>
          )}
        </div>

        <div className="employee-dashboard__card">
          <div className="employee-dashboard__card-header">
            <h2 className="employee-dashboard__card-title">
              <CheckCircle2 size={16} /> Performance
            </h2>
          </div>
          {latestReview ? (
            <div className="employee-dashboard__performance">
              <p className="employee-dashboard__performance-cycle">{latestReview.cycle_name}</p>
              <p className="employee-dashboard__performance-status">
                Status: {latestReview.status}
                {latestReview.rating != null && ` · Rating: ${latestReview.rating}`}
              </p>
            </div>
          ) : (
            <p className="employee-dashboard__empty-note">No performance reviews yet.</p>
          )}
          <Link to={employeeRoutePaths.PERFORMANCE} className="employee-dashboard__summary-link">
            View performance <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      <div className="employee-dashboard__row">
        <div className="employee-dashboard__card">
          <div className="employee-dashboard__card-header">
            <h2 className="employee-dashboard__card-title">
              <Bell size={16} /> Recent Notifications
            </h2>
            <Link to={employeeRoutePaths.NOTIFICATIONS} className="employee-dashboard__card-header-link">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          {recentNotifications.length === 0 ? (
            <p className="employee-dashboard__empty-note">No notifications yet.</p>
          ) : (
            <div className="employee-dashboard__notification-list">
              {recentNotifications.map((n) => {
                const Icon = NOTIFICATION_TYPE_ICONS[n.type] || Bell;
                const color = NOTIFICATION_TYPE_COLOR[n.type] || "gray";
                return (
                  <button
                    type="button"
                    key={n.notification_id}
                    className={`employee-dashboard__notification-row${
                      n.is_read ? "" : " employee-dashboard__notification-row--unread"
                    }`}
                    onClick={() => handleNotificationClick(n)}
                  >
                    <span
                      className={`employee-dashboard__notification-icon employee-dashboard__notification-icon--${color}`}
                    >
                      <Icon size={14} />
                    </span>
                    <span className="employee-dashboard__notification-body">
                      <span className="employee-dashboard__notification-title">{n.title}</span>
                      <span className="employee-dashboard__notification-message">{n.message}</span>
                    </span>
                    <span className="employee-dashboard__notification-meta">
                      {!n.is_read && <span className="employee-dashboard__notification-dot" />}
                      <span className="employee-dashboard__notification-time">
                        {formatNotificationTime(n.created_at)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="employee-dashboard__card">
          <div className="employee-dashboard__card-header">
            <h2 className="employee-dashboard__card-title">
              <LayoutGrid size={16} /> Quick Actions
            </h2>
          </div>
          <div className="employee-dashboard__quick-links">
            {quickActions.map((link) => {
              const Icon = link.icon;
              return (
                <Link key={link.to} to={link.to} className="employee-dashboard__quick-link">
                  <Icon size={16} />
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {teamCount > 0 && (
        <div className="employee-dashboard__card">
          <div className="employee-dashboard__card-header">
            <h2 className="employee-dashboard__card-title">
              <Users size={16} /> Team Overview
            </h2>
            <Link to={employeeRoutePaths.TEAM} className="employee-dashboard__card-header-link">
              View team <ArrowRight size={12} />
            </Link>
          </div>
          <p className="employee-dashboard__team-count">
            You have {teamCount} direct report{teamCount === 1 ? "" : "s"}.
          </p>
          <div className="employee-dashboard__team-list">
            {teamPreview.map((member) => (
              <div key={member.employee_id} className="employee-dashboard__team-member">
                <span className="employee-dashboard__team-avatar">
                  {`${member.first_name?.[0] || ""}${member.last_name?.[0] || ""}`.toUpperCase()}
                </span>
                <span className="employee-dashboard__team-member-info">
                  <span className="employee-dashboard__team-member-name">
                    {member.first_name} {member.last_name}
                  </span>
                  <span className="employee-dashboard__team-member-role">{member.role_name}</span>
                </span>
                <span
                  className={`employee-dashboard__team-status${
                    member.status === "Active" ? " employee-dashboard__team-status--active" : ""
                  }`}
                >
                  {member.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default EmployeeDashboardPage;