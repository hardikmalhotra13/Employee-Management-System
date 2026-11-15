import "./TeamAttendancePage.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Calendar, Search, RotateCcw, Users, CheckCircle2, MinusCircle, Plane, UserX,
  AlertTriangle, Eye, XCircle,
} from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import AttendanceStatusBadge from "../../../components/common/AttendanceStatusBadge/AttendanceStatusBadge.jsx";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import {
  getTeamAttendance,
  getTeamAttendanceSummary,
  getTeamAttendanceExceptions,
  getTeamShiftOptions,
} from "../../../services/api/managerApi.js";

const PAGE_SIZE = 8;

const STATUS_OPTIONS = ["Present", "Late", "Absent", "Half Day", "On Leave", "Not Checked In"];

function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function earliestAllowedDate() {
  // Mirrors earliest_allowed_history_date() in attendance_routes.py: the
  // 1st of the month before last month's start (e.g. September -> 1 Aug).
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthEnd = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  return toDateStr(new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1));
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

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function TeamAttendancePage() {
  const navigate = useNavigate();
  const today = toDateStr(new Date());

  const [shiftOptions, setShiftOptions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [exceptions, setExceptions] = useState(null);

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [shiftId, setShiftId] = useState("");
  // The page number belongs to the filters it was chosen under: changing any filter is
  // back to page 1 in the same render, so no request is ever sent for the old page number
  // combined with the new filters.
  const filterKey = [startDate, endDate, search, status, shiftId].join("|");
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  // Stored page belongs to a different filter combination: drop it now (React re-renders at once,
  // before anything is committed or fetched) so coming back to an earlier combination starts at page 1.
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (nextPage) => setPageState({ key: filterKey, page: nextPage });

  // Each loader ignores any response that is no longer the latest request it made.
  const latestSummaryRequest = useRef(0);
  const latestRecordsRequest = useRef(0);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");



  useEffect(() => {
    getTeamShiftOptions()
      .then(setShiftOptions)
      .catch(() => setShiftOptions([]));
    getTeamAttendanceExceptions()
      .then(setExceptions)
      .catch(() => setExceptions(null));
  }, []);

  const loadSummary = useCallback(() => {
    const requestId = ++latestSummaryRequest.current;
    getTeamAttendanceSummary({ start_date: startDate, end_date: endDate })
      .then((result) => {
        if (requestId === latestSummaryRequest.current) setSummary(result);
      })
      .catch(() => {
        if (requestId === latestSummaryRequest.current) setSummary(null);
      });
  }, [startDate, endDate]);

  const loadRecords = useCallback(async () => {
    const requestId = ++latestRecordsRequest.current;
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getTeamAttendance({
        start_date: startDate,
        end_date: endDate,
        search: search || undefined,
        status: status || undefined,
        shift_id: shiftId || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (requestId !== latestRecordsRequest.current) return;

      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      if (requestId !== latestRecordsRequest.current) return;
      setLoadError("Failed to load team attendance. Please try again.");
    } finally {
      if (requestId === latestRecordsRequest.current) setIsLoading(false);
    }
  }, [startDate, endDate, search, status, shiftId, page]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleReset = () => {
    setStartDate(today);
    setEndDate(today);
    setSearch("");
    setStatus("");
    setShiftId("");
  };

  const columns = [
    {
      key: "employee",
      label: "Employee",
      render: (row) => (
        <span className="team-attendance-page__employee-cell">
          <span className="team-attendance-page__avatar">{getInitials(row.first_name, row.last_name)}</span>
          {row.first_name} {row.last_name}
        </span>
      ),
    },
    { key: "employee_code", label: "Employee Code" },
    {
      key: "shift",
      label: "Shift",
      render: (row) =>
        row.shift_name ? (
          <span className="team-attendance-page__shift-cell">
            <span>{row.shift_name}</span>
            <span className="team-attendance-page__shift-timing">
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
          {row.is_late && <span className="team-attendance-page__flag team-attendance-page__flag--late">Late</span>}
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
            <span className="team-attendance-page__flag team-attendance-page__flag--early">Early</span>
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
      render: (row) => (
        <>
          <AttendanceStatusBadge status={row.display_status} />{" "}
          <DayKindBadge kind={row.day_kind} title={row.day_title} />
        </>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <button
          type="button"
          className="team-attendance-page__view-button"
          onClick={() => navigate(employeeRoutePaths.TEAM_MEMBER_VIEW(row.employee_id))}
          aria-label="View employee"
        >
          <Eye size={15} />
        </button>
      ),
    },
  ];

  return (
    <div className="team-attendance-page">
      <div className="team-attendance-page__header">
        <div>
          <h1 className="team-attendance-page__title">Team Attendance</h1>
          <p className="team-attendance-page__subtitle">Attendance for employees who report to you</p>
        </div>
        <span className="team-attendance-page__today-pill">
          <Calendar size={14} />
          Today, {formatTodayShort()}
        </span>
      </div>

      <div className="team-attendance-page__summary-grid">
        <div className="team-attendance-page__summary-card">
          <span className="team-attendance-page__summary-icon team-attendance-page__summary-icon--neutral">
            <Users size={16} />
          </span>
          <div>
            <p className="team-attendance-page__summary-number">{summary?.team_members ?? "-"}</p>
            <p className="team-attendance-page__summary-label">Team Members</p>
          </div>
        </div>
        <div className="team-attendance-page__summary-card">
          <span className="team-attendance-page__summary-icon team-attendance-page__summary-icon--present">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <p className="team-attendance-page__summary-number">{summary?.present ?? "-"}</p>
            <p className="team-attendance-page__summary-label">Present</p>
          </div>
        </div>
        <div className="team-attendance-page__summary-card">
          <span className="team-attendance-page__summary-icon team-attendance-page__summary-icon--absent">
            <XCircle size={16} />
          </span>
          <div>
            <p className="team-attendance-page__summary-number">{summary?.absent ?? "-"}</p>
            <p className="team-attendance-page__summary-label">Absent</p>
          </div>
        </div>
        <div className="team-attendance-page__summary-card">
          <span className="team-attendance-page__summary-icon team-attendance-page__summary-icon--half-day">
            <MinusCircle size={16} />
          </span>
          <div>
            <p className="team-attendance-page__summary-number">{summary?.half_day ?? "-"}</p>
            <p className="team-attendance-page__summary-label">Half Day</p>
          </div>
        </div>
        <div className="team-attendance-page__summary-card">
          <span className="team-attendance-page__summary-icon team-attendance-page__summary-icon--leave">
            <Plane size={16} />
          </span>
          <div>
            <p className="team-attendance-page__summary-number">{summary?.on_leave ?? "-"}</p>
            <p className="team-attendance-page__summary-label">On Leave</p>
          </div>
        </div>
        <div className="team-attendance-page__summary-card">
          <span className="team-attendance-page__summary-icon team-attendance-page__summary-icon--not-checked-in">
            <UserX size={16} />
          </span>
          <div>
            <p className="team-attendance-page__summary-number">{summary?.not_checked_in ?? "-"}</p>
            <p className="team-attendance-page__summary-label">Not Checked In</p>
          </div>
        </div>
      </div>

      <div className="team-attendance-page__filter-bar">
        <div className="team-attendance-page__search">
          <Search size={15} className="team-attendance-page__search-icon" />
          <input
            type="text"
            placeholder="Search by name or employee code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="team-attendance-page__search-input"
          />
        </div>

        <select className="team-attendance-page__select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select className="team-attendance-page__select" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">All Shifts</option>
          {shiftOptions.map((s) => (
            <option key={s.shift_id} value={s.shift_id}>
              {s.shift_name}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="team-attendance-page__date-input"
          value={startDate}
          min={earliestAllowedDate()}
          max={endDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <span className="team-attendance-page__date-sep">to</span>
        <input
          type="date"
          className="team-attendance-page__date-input"
          value={endDate}
          min={startDate}
          max={today}
          onChange={(e) => setEndDate(e.target.value)}
        />

        <button type="button" className="team-attendance-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="team-attendance-page__table-card">
        <div className="team-attendance-page__table-header">
          <h2 className="team-attendance-page__table-title">Team Attendance</h2>
          <p className="team-attendance-page__table-subtitle">
            Attendance records for your team members for the selected date
          </p>
        </div>

        {loadError && <p className="team-attendance-page__error">{loadError}</p>}

        <DataTable
          columns={columns}
          rows={records}
          isLoading={isLoading}
          emptyMessage="No attendance records for the selected filters"
        />

        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>

      {exceptions &&
        (exceptions.late_arrivals > 0 || exceptions.early_departures > 0 || exceptions.missing_checkouts > 0) && (
          <div className="team-attendance-page__exceptions">
            <p className="team-attendance-page__exceptions-title">
              <AlertTriangle size={15} />
              Attendance Exceptions (Today)
            </p>
            <p className="team-attendance-page__exceptions-subtitle">
              Quick view of important items that may need your attention
            </p>
            <div className="team-attendance-page__exceptions-grid">
              <div className="team-attendance-page__exception-chip">
                <span className="team-attendance-page__exception-number">{exceptions.late_arrivals}</span>
                Late Arrivals
              </div>
              <div className="team-attendance-page__exception-chip">
                <span className="team-attendance-page__exception-number">{exceptions.early_departures}</span>
                Early Departures
              </div>
              <div className="team-attendance-page__exception-chip">
                <span className="team-attendance-page__exception-number">{exceptions.missing_checkouts}</span>
                Missing Check-outs
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

export default TeamAttendancePage;