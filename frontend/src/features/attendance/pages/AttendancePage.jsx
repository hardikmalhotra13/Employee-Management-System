import "./AttendancePage.css";
import { useState, useEffect, useMemo, useRef } from "react";
import { UserX, UserCheck, Clock3, CalendarClock, ClipboardList, Pencil } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import { listAttendance, createAttendance, updateAttendance } from "../../../services/api/attendanceApi.js";
import { listDepartments } from "../../../services/api/departmentApi.js";
import { listEmployees } from "../../../services/api/employeeApi.js";
import { listShifts } from "../../../services/api/shiftApi.js";

// Only statuses an admin can directly set. Present/Late are always
// server-derived from an actual check-in against the 15-minute grace
// period, never chosen manually.
const MARK_STATUS_OPTIONS = [
  { value: "Absent", label: "Absent" },
  { value: "Half Day", label: "Half Day" },
];

function todayPlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDatetimeLocal(value) {
  return value ? value.slice(0, 16).replace(" ", "T") : "";
}

function toMySQLDatetime(value) {
  return value ? `${value.replace("T", " ")}:00` : "";
}

function AttendanceStatusBadge({ status }) {
  const variant = {
    Present: "present",
    Late: "late",
    Absent: "absent",
    "Half Day": "half-day",
    "On Leave": "on-leave",
  }[status] || "present";

  return <span className={`attendance-status-badge attendance-status-badge--${variant}`}>{status}</span>;
}

function AttendancePage() {
  const { admin } = useAuth();
  // Mark Attendance (Absent/Half Day) reuses attendance.create; Correct
  // Attendance reuses attendance.update - same permissions as before.
  const canMark = hasPermission(admin, "attendance.create");
  const canCorrect = hasPermission(admin, "attendance.update");

  const [startDate, setStartDate] = useState(todayPlusDays(0));
  const [endDate, setEndDate] = useState(todayPlusDays(0));
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");

  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [modalMode, setModalMode] = useState(null); // "mark" | "correct" | null
  const [editingEntry, setEditingEntry] = useState(null);
  const [formData, setFormData] = useState({
    employee_id: "",
    attendance_date: "",
    status: "Absent",
    shift_id: "",
    check_in_time: "",
    check_out_time: "",
    reason: "",
  });
  const [formError, setFormError] = useState("");
  // Correct Attendance's one narrow exception: admin can explicitly ask for
  // Half Day (the only status that can't be derived from a check-in time).
  // Kept separate from formData.status, which belongs to the Mark modal.
  const [correctAsHalfDay, setCorrectAsHalfDay] = useState(false);

  // Each call supersedes the ones before it, so a slow earlier response (or error) can never
  // overwrite the result for the filters currently selected.
  const latestAttendanceRequest = useRef(0);

  const fetchAttendance = async () => {
    const requestId = ++latestAttendanceRequest.current;

    if (!startDate || !endDate) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listAttendance({
        start_date: startDate,
        end_date: endDate,
        department_id: departmentFilter || undefined,
        employee_id: employeeFilter || undefined,
      });
      if (requestId !== latestAttendanceRequest.current) return;
      setEntries(result);
    } catch (err) {
      if (requestId !== latestAttendanceRequest.current) return;
      setLoadError("Failed to load attendance. Please try again.");
    } finally {
      if (requestId === latestAttendanceRequest.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendance();
  }, [startDate, endDate, departmentFilter, employeeFilter]);

  useEffect(() => {
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setDepartments(result.records));
    listEmployees({ page: 1, pageSize: 100 }).then((result) => setEmployees(result.records));
    listShifts({ page: 1, pageSize: 100 }).then((result) => setShifts(result.records));
  }, []);

  // Purely derived from the entries already fetched for the selected
  // filters - no new API calls, no new stored data. Used for the KPI
  // summary strip (Present / Late / Half Day / Absent only).
  const summary = useMemo(() => {
    const total = entries.length;
    const countOf = (status) => entries.filter((entry) => entry.status === status).length;

    const present = countOf("Present");
    const late = countOf("Late");
    const halfDay = countOf("Half Day");
    const absent = countOf("Absent");

    const percentOf = (count) => (total === 0 ? "0%" : `${Math.round((count / total) * 100)}%`);

    return {
      present,
      late,
      halfDay,
      absent,
      presentPct: percentOf(present),
      latePct: percentOf(late),
      halfDayPct: percentOf(halfDay),
      absentPct: percentOf(absent),
    };
  }, [entries]);

  const openMarkModal = () => {
    setFormData({
      employee_id: "",
      attendance_date: startDate,
      status: "Absent",
      shift_id: "",
      check_in_time: "",
      check_out_time: "",
      reason: "",
    });
    setFormError("");
    setEditingEntry(null);
    setModalMode("mark");
  };

  const openCorrectModal = (entry) => {
    setFormData({
      employee_id: String(entry.employee_id),
      attendance_date: entry.attendance_date,
      status: entry.status,
      shift_id: entry.shift_id ? String(entry.shift_id) : "",
      check_in_time: toDatetimeLocal(entry.check_in_time),
      check_out_time: toDatetimeLocal(entry.check_out_time),
      reason: "",
    });
    setFormError("");
    setEditingEntry(entry);
    setCorrectAsHalfDay(entry.status === "Half Day");
    setModalMode("correct");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingEntry(null);
    setFormError("");
    setCorrectAsHalfDay(false);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    const reason = formData.reason.trim();

    if (!reason) {
      setFormError("A reason is required");
      return;
    }

    if (modalMode === "mark" && (!formData.employee_id || !formData.attendance_date || !formData.status)) {
      setFormError("Employee, date, and status are required");
      return;
    }

    try {
      if (modalMode === "mark") {
        await createAttendance({
          employee_id: formData.employee_id,
          attendance_date: formData.attendance_date,
          status: formData.status,
          reason,
        });
      } else {
        await updateAttendance(editingEntry.attendance_id, {
          shift_id: formData.shift_id,
          check_in_time: toMySQLDatetime(formData.check_in_time),
          check_out_time: toMySQLDatetime(formData.check_out_time),
          reason,
          ...(correctAsHalfDay ? { status: "Half Day" } : {}),
        });
      }

      closeModal();
      fetchAttendance();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const columns = [
    {
      key: "attendance_date",
      label: "Date",
      render: (row) => (
        <>
          {row.attendance_date} <DayKindBadge kind={row.day_kind} title={row.day_title} />
        </>
      ),
    },
    {
      key: "employee",
      label: "Employee",
      render: (row) => (
        <div className="attendance-page__employee-cell">
          <span className="attendance-page__employee-name">
            {row.first_name} {row.last_name}
          </span>
          <span className="attendance-page__employee-code">{row.employee_code}</span>
        </div>
      ),
    },
    { key: "department_name", label: "Department" },
    {
      key: "shift",
      label: "Shift",
      render: (row) => (row.shift_name ? `${row.shift_name} (${row.start_time} - ${row.end_time})` : "-"),
    },
    {
      key: "check_in_time",
      label: "Check In",
      render: (row) => (row.check_in_time ? row.check_in_time.slice(11, 16) : "-"),
    },
    {
      key: "check_out_time",
      label: "Check Out",
      render: (row) => (row.check_out_time ? row.check_out_time.slice(11, 16) : "-"),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <AttendanceStatusBadge status={row.status} />,
    },
    {
      key: "actions",
      label: "Action",
      render: (row) =>
        canCorrect && (
          <button
            type="button"
            className="attendance-page__action-button attendance-page__action-button--edit"
            onClick={() => openCorrectModal(row)}
            aria-label="Correct attendance record"
            title="Correct Attendance"
          >
            <Pencil size={15} />
          </button>
        ),
    },
  ];

  return (
    <div className="attendance-page">
      <PageHeader
        title="Attendance"
        subtitle="View attendance and correct records when genuinely required"
        actions={
          canMark && (
            <button type="button" className="attendance-page__add-button" onClick={openMarkModal}>
              <UserX size={16} />
              Mark Absent / Half Day
            </button>
          )
        }
      />

      <div className="attendance-page__filters">
        <FormInput label="Start Date" name="start_date" type="date" value={startDate} onChange={setStartDate} />
        <FormInput label="End Date" name="end_date" type="date" value={endDate} onChange={setEndDate} />
        <div className="attendance-page__filter-select">
          <label className="attendance-page__filter-label">Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="attendance-page__select"
          >
            <option value="">All departments</option>
            {departments.map((dept) => (
              <option key={dept.department_id} value={dept.department_id}>
                {dept.department_name}
              </option>
            ))}
          </select>
        </div>
        <div className="attendance-page__filter-select">
          <label className="attendance-page__filter-label">Employee</label>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="attendance-page__select"
          >
            <option value="">All employees</option>
            {employees.map((emp) => (
              <option key={emp.employee_id} value={emp.employee_id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="attendance-page__summary">
        <div className="attendance-page__summary-card">
          <span className="attendance-page__summary-icon attendance-page__summary-icon--present">
            <UserCheck size={16} />
          </span>
          <div>
            <p className="attendance-page__summary-value">{summary.present}</p>
            <p className="attendance-page__summary-label">Present</p>
            <p className="attendance-page__summary-meta">{summary.presentPct}</p>
          </div>
        </div>

        <div className="attendance-page__summary-card">
          <span className="attendance-page__summary-icon attendance-page__summary-icon--late">
            <Clock3 size={16} />
          </span>
          <div>
            <p className="attendance-page__summary-value">{summary.late}</p>
            <p className="attendance-page__summary-label">Late</p>
            <p className="attendance-page__summary-meta">{summary.latePct}</p>
          </div>
        </div>

        <div className="attendance-page__summary-card">
          <span className="attendance-page__summary-icon attendance-page__summary-icon--half-day">
            <CalendarClock size={16} />
          </span>
          <div>
            <p className="attendance-page__summary-value">{summary.halfDay}</p>
            <p className="attendance-page__summary-label">Half Day</p>
            <p className="attendance-page__summary-meta">{summary.halfDayPct}</p>
          </div>
        </div>

        <div className="attendance-page__summary-card">
          <span className="attendance-page__summary-icon attendance-page__summary-icon--absent">
            <UserX size={16} />
          </span>
          <div>
            <p className="attendance-page__summary-value">{summary.absent}</p>
            <p className="attendance-page__summary-label">Absent</p>
            <p className="attendance-page__summary-meta">{summary.absentPct}</p>
          </div>
        </div>
      </div>

      {loadError && <p className="attendance-page__error">{loadError}</p>}

      <div className="attendance-page__table-card">
        <div className="attendance-page__table-card-header">
          <span className="attendance-page__table-card-icon">
            <ClipboardList size={17} />
          </span>
          <div>
            <p className="attendance-page__table-card-title">Attendance records</p>
            <p className="attendance-page__table-card-subtitle">
              {entries.length === 0
                ? `No attendance records from ${startDate} to ${endDate}`
                : `Showing attendance from ${startDate} to ${endDate} · ${entries.length} record(s)`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={entries}
          isLoading={isLoading}
          emptyMessage="No attendance records for this date range"
        />
      </div>

      <Modal
        isOpen={modalMode === "mark"}
        onClose={closeModal}
        title="Mark Absent / Half Day"
      >
        <form onSubmit={handleFormSubmit} className="attendance-page__form">
          <div className="attendance-page__form-section-header">
            <span className="attendance-page__form-section-icon">
              <UserX size={16} />
            </span>
            <div>
              <p className="attendance-page__form-section-title">Mark Absent or Half Day</p>
              <p className="attendance-page__form-section-subtitle">
                Use this when an employee needs to be marked before the automatic process runs
              </p>
            </div>
          </div>

          <FormInput
            label="Employee"
            name="employee_id"
            type="select"
            value={formData.employee_id}
            onChange={(value) => setFormData({ ...formData, employee_id: value })}
            options={employees.map((emp) => ({
              value: String(emp.employee_id),
              label: `${emp.first_name} ${emp.last_name} (${emp.employee_code})`,
            }))}
            required
          />

          <div className="attendance-page__form-grid">
            <FormInput
              label="Date"
              name="attendance_date"
              type="date"
              value={formData.attendance_date}
              onChange={(value) => setFormData({ ...formData, attendance_date: value })}
              required
            />

            <FormInput
              label="Status"
              name="status"
              type="select"
              value={formData.status}
              onChange={(value) => setFormData({ ...formData, status: value })}
              options={MARK_STATUS_OPTIONS}
              required
            />
          </div>

          <div className="attendance-page__textarea-field">
            <label className="attendance-page__textarea-label" htmlFor="mark-reason">
              Reason<span className="attendance-page__required">*</span>
            </label>
            <textarea
              id="mark-reason"
              className="attendance-page__textarea"
              rows={3}
              placeholder="Why is this employee being marked absent / half day?"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
            />
          </div>

          {formError && <p className="attendance-page__form-error">{formError}</p>}

          <div className="attendance-page__form-actions">
            <button type="button" className="attendance-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="attendance-page__submit">
              Mark Attendance
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={modalMode === "correct"}
        onClose={closeModal}
        title="Correct Attendance"
      >
        <form onSubmit={handleFormSubmit} className="attendance-page__form">
          <div className="attendance-page__form-section-header">
            <span className="attendance-page__form-section-icon">
              <ClipboardList size={16} />
            </span>
            <div>
              <p className="attendance-page__form-section-title">Correct this record</p>
              <p className="attendance-page__form-section-subtitle">
                Status is recalculated from the corrected check-in and shift, unless marked Half Day below
              </p>
            </div>
          </div>

          {editingEntry && (
            <div className="attendance-page__readonly-field">
              <span className="attendance-page__readonly-label">Employee</span>
              <span className="attendance-page__readonly-value">
                {editingEntry.first_name} {editingEntry.last_name} ({editingEntry.employee_code}) -{" "}
                {editingEntry.attendance_date}
              </span>
              <span className="attendance-page__readonly-label attendance-page__readonly-label--spaced">
                Current status
              </span>
              <AttendanceStatusBadge status={editingEntry.status} />
            </div>
          )}

          <FormInput
            label="Shift"
            name="shift_id"
            type="select"
            value={formData.shift_id}
            onChange={(value) => setFormData({ ...formData, shift_id: value })}
            options={shifts.map((shift) => ({
              value: String(shift.shift_id),
              label: `${shift.shift_name} (${shift.start_time} - ${shift.end_time})`,
            }))}
          />

          <div className="attendance-page__form-grid">
            <FormInput
              label="Check In"
              name="check_in_time"
              type="datetime-local"
              value={formData.check_in_time}
              onChange={(value) => setFormData({ ...formData, check_in_time: value })}
              disabled={correctAsHalfDay}
            />

            <FormInput
              label="Check Out"
              name="check_out_time"
              type="datetime-local"
              value={formData.check_out_time}
              onChange={(value) => setFormData({ ...formData, check_out_time: value })}
              disabled={correctAsHalfDay}
            />
          </div>

          <label className="attendance-page__half-day-toggle">
            <input
              type="checkbox"
              checked={correctAsHalfDay}
              onChange={(e) => setCorrectAsHalfDay(e.target.checked)}
            />
            Correct this record to Half Day (use when Present/Late/Absent doesn't apply)
          </label>

          <div className="attendance-page__textarea-field">
            <label className="attendance-page__textarea-label" htmlFor="correct-reason">
              Correction reason<span className="attendance-page__required">*</span>
            </label>
            <textarea
              id="correct-reason"
              className="attendance-page__textarea"
              rows={3}
              placeholder="Why is this record being corrected?"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
            />
          </div>

          {formError && <p className="attendance-page__form-error">{formError}</p>}

          <div className="attendance-page__form-actions">
            <button type="button" className="attendance-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="attendance-page__submit">
              Save Correction
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default AttendancePage;