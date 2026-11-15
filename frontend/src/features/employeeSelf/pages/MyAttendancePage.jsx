import "./MyAttendancePage.css";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Calendar, Clock, Sun, CheckCircle2, XCircle, MinusCircle, Plane, CalendarCheck,
} from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import AttendanceStatusBadge from "../../../components/common/AttendanceStatusBadge/AttendanceStatusBadge.jsx";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";
import {
  checkIn,
  checkOut,
  getMyTodayAttendance,
  getMyAttendanceSummary,
  getMyAttendance,
} from "../../../services/api/employeeSelfApi.js";

const PAGE_SIZE = 5;

const FILTERS = [
  { key: "thisMonth", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "last30Days", label: "Last 30 Days" },
  { key: "custom", label: "Custom Range" },
];

function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRangeForFilter(filterKey, customStart, customEnd) {
  const today = new Date();

  if (filterKey === "thisMonth") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start_date: toDateStr(start), end_date: toDateStr(today) };
  }

  if (filterKey === "lastMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start_date: toDateStr(start), end_date: toDateStr(end) };
  }

  if (filterKey === "last30Days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start_date: toDateStr(start), end_date: toDateStr(today) };
  }

  if (filterKey === "custom") {
    return { start_date: customStart, end_date: customEnd };
  }

  // No filter selected yet (initial state) - today only, never a
  // historical range, until the employee explicitly picks one.
  return { start_date: toDateStr(today), end_date: toDateStr(today) };
}

function earliestAllowedDate() {
  // Mirrors earliest_allowed_history_date() in attendance_routes.py: the
  // 1st of the month before last month's start (e.g. September -> 1 Aug).
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  return toDateStr(new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1));
}

function formatTodayLong() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatTodayShort() {
  return new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function formatClockTime(value) {
  return value ? value.slice(11, 16) : "";
}

function formatShiftTime(value) {
  if (!value) return "";
  const [hourStr, minuteStr] = value.split(":");
  const hour = parseInt(hourStr, 10);
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minuteStr} ${period}`;
}

function formatDateShort(value) {
  if (!value) return value;
  const date = new Date(`${value}T00:00:00`);
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function MyAttendancePage() {
  const [today, setToday] = useState(null);
  const [isTodayLoading, setIsTodayLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [summary, setSummary] = useState(null);

  const [activeFilter, setActiveFilter] = useState(null);
  const [customStart, setCustomStart] = useState(toDateStr(new Date()));
  const [customEnd, setCustomEnd] = useState(toDateStr(new Date()));

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  // The page number belongs to the filters it was chosen under: changing any filter is
  // back to page 1 in the same render, so no request is ever sent for the old page number
  // combined with the new filters.
  const filterKey = [activeFilter, customStart, customEnd].join("|");
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  // Stored page belongs to a different filter combination: drop it now (React re-renders at once,
  // before anything is committed or fetched) so coming back to an earlier combination starts at page 1.
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (nextPage) => setPageState({ key: filterKey, page: nextPage });

  // Each loader ignores any response that is no longer the latest request it made.
  const latestTodayRequest = useRef(0);
  const latestSummaryRequest = useRef(0);
  const latestHistoryRequest = useRef(0);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const range = getRangeForFilter(activeFilter, customStart, customEnd);
  // Summary counts default to the current month when no filter has been
  // chosen yet (spec: "selected/current month"); only the history TABLE
  // is held to today-only on initial load.
  const summaryRange = activeFilter === null ? getRangeForFilter("thisMonth") : range;

  const loadToday = useCallback(async () => {
    const requestId = ++latestTodayRequest.current;
    setIsTodayLoading(true);
    try {
      const data = await getMyTodayAttendance();
      if (requestId === latestTodayRequest.current) setToday(data);
    } catch (err) {
      if (requestId === latestTodayRequest.current) setToday(null);
    } finally {
      if (requestId === latestTodayRequest.current) setIsTodayLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    const requestId = ++latestSummaryRequest.current;
    try {
      const data = await getMyAttendanceSummary({
        start_date: summaryRange.start_date,
        end_date: summaryRange.end_date,
      });
      if (requestId === latestSummaryRequest.current) setSummary(data);
    } catch (err) {
      if (requestId === latestSummaryRequest.current) setSummary(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryRange.start_date, summaryRange.end_date]);

  const loadHistory = useCallback(async () => {
    const requestId = ++latestHistoryRequest.current;
    setIsHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await getMyAttendance({
        start_date: range.start_date,
        end_date: range.end_date,
        page,
        pageSize: PAGE_SIZE,
      });
      if (requestId !== latestHistoryRequest.current) return;

      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      if (requestId !== latestHistoryRequest.current) return;
      setHistoryError("Failed to load your attendance history. Please try again.");
    } finally {
      if (requestId === latestHistoryRequest.current) setIsHistoryLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.start_date, range.end_date, page]);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleCheckIn = async () => {
    setActionError("");
    setIsSubmitting(true);
    try {
      await checkIn();
      await loadToday();
      await loadSummary();
      await loadHistory();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to check in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    setActionError("");
    setIsSubmitting(true);
    try {
      await checkOut();
      await loadToday();
      await loadSummary();
      await loadHistory();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to check out. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const schedule = today?.schedule;
  const attendance = today?.attendance;
  const isCheckedIn = !!attendance?.check_in_time;
  const isCheckedOut = !!attendance?.check_out_time;
  const isOnLeaveToday = attendance?.display_status === "On Leave";
  const todayDay = today?.today_day;
  // A holiday/weekend the employee is not specifically rostered for (a roster entry means they are expected in).
  const isDayOff = Boolean(todayDay && !todayDay.is_working_day && !schedule?.is_override);

  const columns = [
    {
      key: "attendance_date",
      label: "Date",
      render: (row) => (
        <>
          {formatDateShort(row.attendance_date)} <DayKindBadge kind={row.day_kind} title={row.day_title} />
        </>
      ),
    },
    {
      key: "shift",
      label: "Shift",
      render: (row) =>
        row.shift_name ? (
          <span className="my-attendance-page__shift-cell">
            <span>{row.shift_name}</span>
            <span className="my-attendance-page__shift-timing">
              {formatShiftTime(row.start_time)} - {formatShiftTime(row.end_time)}
            </span>
          </span>
        ) : (
          "-"
        ),
    },
    {
      key: "check_in_time",
      label: "Check In",
      render: (row) => (
        <span>
          {row.check_in_time ? formatClockTime(row.check_in_time) : "-"}
          {row.is_late && <span className="my-attendance-page__flag my-attendance-page__flag--late">Late</span>}
        </span>
      ),
    },
    {
      key: "check_out_time",
      label: "Check Out",
      render: (row) => (
        <span>
          {row.check_out_time ? formatClockTime(row.check_out_time) : "-"}
          {row.is_early_departure && (
            <span className="my-attendance-page__flag my-attendance-page__flag--early">Early</span>
          )}
        </span>
      ),
    },
    {
      key: "working_hours",
      label: "Working Hours",
      render: (row) => (row.working_hours != null ? `${row.working_hours}h` : "-"),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <AttendanceStatusBadge status={row.display_status} />,
    },
    {
      key: "remarks",
      label: "Remarks",
      render: (row) => row.remarks || "-",
    },
  ];

  return (
    <div className="my-attendance-page">
      <PageHeader
        title="My Attendance"
        subtitle="Check in and check out, and view your attendance history"
        actions={
          <span className="my-attendance-page__today-pill">
            <Calendar size={14} />
            Today, {formatTodayShort()}
          </span>
        }
      />

      <div className="my-attendance-page__today-card">
        <div className="my-attendance-page__today-left">
          <span className="my-attendance-page__today-tag">TODAY</span>
          {!isTodayLoading && todayDay?.kind && <DayKindBadge kind={todayDay.kind} title={todayDay.title} />}
          <p className="my-attendance-page__today-date">{formatTodayLong()}</p>

          {!isTodayLoading && isDayOff && (
            <div className="my-attendance-page__today-shift">
              <span className="my-attendance-page__today-shift-icon">
                <Sun size={16} />
              </span>
              <div>
                <p className="my-attendance-page__today-shift-name">{todayDay.title}</p>
                <p className="my-attendance-page__today-shift-time">Office closed - no shift scheduled</p>
              </div>
            </div>
          )}

          {!isTodayLoading && !isDayOff && schedule && (
            <div className="my-attendance-page__today-shift">
              <span className="my-attendance-page__today-shift-icon">
                <Sun size={16} />
              </span>
              <div>
                <p className="my-attendance-page__today-shift-name">{schedule.shift_name}</p>
                <p className="my-attendance-page__today-shift-time">
                  {formatShiftTime(schedule.start_time)} - {formatShiftTime(schedule.end_time)}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="my-attendance-page__today-middle">
          <span className="my-attendance-page__today-clock-icon">
            <Clock size={18} />
          </span>
          <div>
            {isOnLeaveToday ? (
              <p className="my-attendance-page__today-message">You are on approved leave today</p>
            ) : isCheckedOut ? (
              <>
                <p className="my-attendance-page__today-message">Your work day is complete</p>
                <p className="my-attendance-page__today-submessage">
                  Checked in at {formatClockTime(attendance.check_in_time)} · Checked out at{" "}
                  {formatClockTime(attendance.check_out_time)}
                  {attendance.working_hours != null && ` · Worked ${attendance.working_hours}h`}
                </p>
              </>
            ) : isCheckedIn ? (
              <>
                <p className="my-attendance-page__today-message">You're checked in</p>
                <p className="my-attendance-page__today-submessage">
                  Since {formatClockTime(attendance.check_in_time)}. Click below when you're done for the day.
                </p>
              </>
            ) : isDayOff ? (
              <>
                <p className="my-attendance-page__today-message">
                  {todayDay.kind === "Holiday" ? `Today is a holiday: ${todayDay.title}` : "Today is a weekend"}
                </p>
                <p className="my-attendance-page__today-submessage">
                  No check-in is needed. If you are working today, you can still check in below.
                </p>
              </>
            ) : (
              <>
                <p className="my-attendance-page__today-message">You haven't checked in yet</p>
                <p className="my-attendance-page__today-submessage">
                  Click the button below to check in and start your work day.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="my-attendance-page__today-right">
          {!isOnLeaveToday && (
            <button
              type="button"
              className="my-attendance-page__action-button"
              onClick={isCheckedIn && !isCheckedOut ? handleCheckOut : handleCheckIn}
              disabled={isSubmitting || isTodayLoading || isCheckedOut}
            >
              {isCheckedIn && !isCheckedOut ? "Check Out" : "Check In"}
            </button>
          )}
        </div>
      </div>

      {actionError && <p className="my-attendance-page__error">{actionError}</p>}

      <div className="my-attendance-page__summary-grid">
        <div className="my-attendance-page__summary-card">
          <span className="my-attendance-page__summary-icon my-attendance-page__summary-icon--neutral">
            <CalendarCheck size={16} />
          </span>
          <div>
            <p className="my-attendance-page__summary-number">{summary?.working_days ?? "-"}</p>
            <p className="my-attendance-page__summary-label">Working Days</p>
          </div>
        </div>
        <div className="my-attendance-page__summary-card">
          <span className="my-attendance-page__summary-icon my-attendance-page__summary-icon--present">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <p className="my-attendance-page__summary-number">{summary?.present ?? "-"}</p>
            <p className="my-attendance-page__summary-label">Present</p>
          </div>
        </div>
        <div className="my-attendance-page__summary-card">
          <span className="my-attendance-page__summary-icon my-attendance-page__summary-icon--absent">
            <XCircle size={16} />
          </span>
          <div>
            <p className="my-attendance-page__summary-number">{summary?.absent ?? "-"}</p>
            <p className="my-attendance-page__summary-label">Absent</p>
          </div>
        </div>
        <div className="my-attendance-page__summary-card">
          <span className="my-attendance-page__summary-icon my-attendance-page__summary-icon--half-day">
            <MinusCircle size={16} />
          </span>
          <div>
            <p className="my-attendance-page__summary-number">{summary?.half_day ?? "-"}</p>
            <p className="my-attendance-page__summary-label">Half Day</p>
          </div>
        </div>
        <div className="my-attendance-page__summary-card">
          <span className="my-attendance-page__summary-icon my-attendance-page__summary-icon--leave">
            <Plane size={16} />
          </span>
          <div>
            <p className="my-attendance-page__summary-number">{summary?.on_leave ?? "-"}</p>
            <p className="my-attendance-page__summary-label">On Leave</p>
          </div>
        </div>
      </div>

      <div className="my-attendance-page__filter-bar">
        <span className="my-attendance-page__filter-label">View Attendance</span>
        <div className="my-attendance-page__filter-buttons">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`my-attendance-page__filter-button${
                activeFilter === f.key ? " my-attendance-page__filter-button--active" : ""
              }`}
              onClick={() => setActiveFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {activeFilter === "custom" ? (
          <div className="my-attendance-page__custom-range">
            <input
              type="date"
              className="my-attendance-page__date-input"
              value={customStart}
              min={earliestAllowedDate()}
              max={customEnd}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span className="my-attendance-page__custom-range-sep">to</span>
            <input
              type="date"
              className="my-attendance-page__date-input"
              value={customEnd}
              min={customStart}
              max={toDateStr(new Date())}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </div>
        ) : (
          <span className="my-attendance-page__range-display">
            {activeFilter === null
              ? `Today, ${formatTodayShort()}`
              : `${formatDateShort(range.start_date)} - ${formatDateShort(range.end_date)}`}
          </span>
        )}
      </div>

      <div className="my-attendance-page__history-card">
        <div className="my-attendance-page__history-header">
          <h2 className="my-attendance-page__history-title">Attendance History</h2>
          <p className="my-attendance-page__history-subtitle">Your attendance records for the selected period.</p>
        </div>

        {historyError && <p className="my-attendance-page__error">{historyError}</p>}

        <DataTable
          columns={columns}
          rows={records}
          isLoading={isHistoryLoading}
          emptyMessage="No attendance records for this period"
        />

        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>
    </div>
  );
}

export default MyAttendancePage;