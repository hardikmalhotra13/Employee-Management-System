import "./RosterPage.css";
import { useState, useEffect, useRef, useMemo } from "react";
import { Plus, Users2, Pencil, Trash2, MoreHorizontal, CalendarRange } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listRoster,
  createRosterEntry,
  updateRosterEntry,
  deleteRosterEntry,
  bulkAssignRoster,
} from "../../../services/api/rosterApi.js";
import { listDepartments } from "../../../services/api/departmentApi.js";
import { listEmployees } from "../../../services/api/employeeApi.js";
import { listShifts } from "../../../services/api/shiftApi.js";
import { getCalendarDays } from "../../../services/api/holidayApi.js";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";

// Formats a Date as YYYY-MM-DD using its local calendar fields. Using
// toISOString() here would convert to UTC first, which silently rolls the
// date back by one day in timezones ahead of UTC (e.g. IST) - this keeps
// the value as the calendar date it was constructed with.
function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayPlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

// Builds the list of ISO date strings shown as grid columns, starting at the
// selected Start Date. Capped at MAX_VISIBLE_DAYS regardless of how long the
// selected Start Date/End Date range is - the range itself still controls
// the API query in fetchRoster, this only limits what the grid displays.
const MAX_VISIBLE_DAYS = 7;

function getDateRange(start, end) {
  if (!start || !end) return [];

  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
    return [];
  }

  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate && dates.length < MAX_VISIBLE_DAYS) {
    dates.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

// Subtle pastel palette for shift chips, keyed by shift_id (not shift name)
// so any shift - however named - gets a stable, visually distinct color.
// Kept as page-local CSS classes on top of the existing design tokens rather
// than reusing semantic tokens like --color-danger-soft, since those carry a
// status meaning that doesn't apply here.
const SHIFT_COLOR_PALETTE = ["blue", "violet", "green", "amber", "rose", "teal"];

function formatColumnHeader(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: "short" }),
    dayMonth: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  };
}

// Per-cell "..." menu for an assigned shift in the grid. Same Edit/Delete
// actions and permission checks as the original row actions column - just
// triggered from the grid cell instead of a table row.
function RosterCellMenu({
  entry,
  isOpen,
  onToggle,
  onClose,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
  colorClass,
  align,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  const canAct = canUpdate || canDelete;

  const chip = (
    <div className={`roster-page__grid-chip roster-page__grid-chip--${colorClass}`}>
      <span className="roster-page__grid-chip-name">{entry.shift_name}</span>
      <span className="roster-page__grid-chip-time">
        {entry.start_time} - {entry.end_time}
      </span>
      {canAct && <MoreHorizontal size={12} className="roster-page__grid-chip-indicator" />}
    </div>
  );

  if (!canAct) {
    return chip;
  }

  return (
    <div className="roster-page__grid-menu" ref={menuRef}>
      <button type="button" className="roster-page__grid-chip-trigger" onClick={onToggle}>
        {chip}
      </button>

      {isOpen && (
        <div
          className={`roster-page__grid-menu-panel ${
            align === "right" ? "roster-page__grid-menu-panel--right" : "roster-page__grid-menu-panel--left"
          }`}
          role="menu"
        >
          {canUpdate && (
            <button
              type="button"
              className="roster-page__grid-menu-item"
              role="menuitem"
              onClick={() => {
                onEdit(entry);
                onClose();
              }}
            >
              <Pencil size={14} />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="roster-page__grid-menu-item roster-page__grid-menu-item--danger"
              role="menuitem"
              onClick={() => {
                onDelete(entry);
                onClose();
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RosterPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "roster.create");
  const canUpdate = hasPermission(admin, "roster.update");
  const canDelete = hasPermission(admin, "roster.delete");

  const [startDate, setStartDate] = useState(todayPlusDays(0));
  const [endDate, setEndDate] = useState(todayPlusDays(6));
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");

  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [shifts, setShifts] = useState([]);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingEntry, setEditingEntry] = useState(null);
  const [formData, setFormData] = useState({ employee_id: "", shift_id: "", roster_date: "" });
  const [formError, setFormError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionError, setActionError] = useState("");

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkAssignTo, setBulkAssignTo] = useState("employee"); // "employee" | "department"
  const [bulkFormData, setBulkFormData] = useState({
    employee_id: "",
    department_id: "",
    shift_id: "",
    start_date: "",
    end_date: "",
  });
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState(null);
  const [calendarDays, setCalendarDays] = useState([]);

  const [openCellKey, setOpenCellKey] = useState(null);

  // Each call supersedes the ones before it, so a slow earlier response (or error) can never
  // overwrite the result for the filters currently selected.
  const latestRosterRequest = useRef(0);

  const fetchRoster = async () => {
    const requestId = ++latestRosterRequest.current;

    if (!startDate || !endDate) {
      setIsLoading(false);
      return;
    }

    if (startDate > endDate) {
      setEntries([]);
      setIsLoading(false);
      setLoadError("Start date must be on or before end date.");
      return;
    }

    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listRoster({
        start_date: startDate,
        end_date: endDate,
        department_id: departmentFilter || undefined,
        employee_id: employeeFilter || undefined,
      });
      if (requestId !== latestRosterRequest.current) return;

      setEntries(result);
      // Marking weekends/holidays on the column headers is a visual aid only - the grid
      // still works if this fails (e.g. a range wider than the calendar endpoint allows).
      getCalendarDays(startDate, endDate)
        .then((days) => {
          if (requestId === latestRosterRequest.current) setCalendarDays(days);
        })
        .catch(() => {
          if (requestId === latestRosterRequest.current) setCalendarDays([]);
        });
    } catch (err) {
      if (requestId !== latestRosterRequest.current) return;
      setLoadError("Failed to load the roster. Please try again.");
    } finally {
      if (requestId === latestRosterRequest.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoster();
  }, [startDate, endDate, departmentFilter, employeeFilter]);

  useEffect(() => {
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setDepartments(result.records));
    listEmployees({ page: 1, pageSize: 100 }).then((result) => setEmployees(result.records));
    listShifts({ page: 1, pageSize: 100 }).then((result) => setShifts(result.records));
  }, []);

  // Regroup the existing flat roster entries into employee rows x date
  // columns for the grid. The original entry objects (with their real
  // roster_id) are kept as-is so Edit/Delete keep targeting the correct
  // record - this is a display-only transformation.
  const dateRange = useMemo(() => getDateRange(startDate, endDate), [startDate, endDate]);

  const gridRows = useMemo(() => {
    const rowsByEmployee = new Map();

    entries.forEach((entry) => {
      if (!rowsByEmployee.has(entry.employee_id)) {
        rowsByEmployee.set(entry.employee_id, {
          employee_id: entry.employee_id,
          first_name: entry.first_name,
          last_name: entry.last_name,
          employee_code: entry.employee_code,
          department_name: entry.department_name,
          byDate: {},
        });
      }

      rowsByEmployee.get(entry.employee_id).byDate[entry.roster_date] = entry;
    });

    return Array.from(rowsByEmployee.values()).sort((a, b) => {
      const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
      const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [entries]);

  // Stable color per shift_id, derived from the existing shifts list already
  // loaded on this page (not from shift names), so any shift gets a
  // consistent pastel treatment in the grid.
  const shiftColorClassById = useMemo(() => {
    const map = new Map();
    shifts.forEach((shift, index) => {
      map.set(shift.shift_id, SHIFT_COLOR_PALETTE[index % SHIFT_COLOR_PALETTE.length]);
    });
    return map;
  }, [shifts]);

  const openCreateModal = () => {
    setFormData({ employee_id: "", shift_id: "", roster_date: startDate });
    setFormError("");
    setEditingEntry(null);
    setModalMode("create");
  };

  const openEditModal = (entry) => {
    setFormData({
      employee_id: String(entry.employee_id),
      shift_id: String(entry.shift_id),
      roster_date: entry.roster_date,
    });
    setFormError("");
    setEditingEntry(entry);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingEntry(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.employee_id || !formData.shift_id || !formData.roster_date) {
      setFormError("Employee, shift, and date are all required");
      return;
    }

    try {
      if (modalMode === "create") {
        await createRosterEntry(formData);
      } else {
        await updateRosterEntry(editingEntry.roster_id, {
          shift_id: formData.shift_id,
          roster_date: formData.roster_date,
        });
      }

      closeModal();
      fetchRoster();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteRosterEntry(deleteTarget.roster_id);
      setDeleteTarget(null);
      setActionError("");
      fetchRoster();
    } catch (err) {
      setDeleteTarget(null);
      setActionError(err.response?.data?.message || "Failed to remove this roster entry. Please try again.");
    }
  };

  const openBulkModal = () => {
    setBulkAssignTo("employee");
    setBulkFormData({
      employee_id: "",
      department_id: "",
      shift_id: "",
      start_date: startDate,
      end_date: endDate,
    });
    setBulkError("");
    setBulkResult(null);
    setIsBulkModalOpen(true);
  };

  const closeBulkModal = () => {
    setIsBulkModalOpen(false);
    setBulkResult(null);
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();

    const target = bulkAssignTo === "employee" ? bulkFormData.employee_id : bulkFormData.department_id;

    if (!target || !bulkFormData.shift_id || !bulkFormData.start_date || !bulkFormData.end_date) {
      setBulkError("Please fill in all fields");
      return;
    }

    try {
      const payload = {
        shift_id: bulkFormData.shift_id,
        start_date: bulkFormData.start_date,
        end_date: bulkFormData.end_date,
        employee_id: bulkAssignTo === "employee" ? bulkFormData.employee_id : undefined,
        department_id: bulkAssignTo === "department" ? bulkFormData.department_id : undefined,
      };

      const result = await bulkAssignRoster(payload);
      setBulkError("");
      setBulkResult(result.data);
      fetchRoster();
    } catch (err) {
      setBulkError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const gridColumns = [
    {
      key: "employee",
      label: `Employees (${gridRows.length})`,
      render: (row) => (
        <div className="roster-page__grid-employee">
          <span className="roster-page__grid-employee-name">
            {row.first_name} {row.last_name}
          </span>
          <span className="roster-page__grid-employee-meta">
            {row.employee_code} · {row.department_name}
          </span>
        </div>
      ),
    },
    ...dateRange.map((date, columnIndex) => {
      const { weekday, dayMonth } = formatColumnHeader(date);
      const dayInfo = calendarDays.find((day) => day.date === date);
      const align = columnIndex >= dateRange.length - 2 ? "right" : "left";

      return {
        key: date,
        label: (
          <div className="roster-page__grid-day-header">
            <span className="roster-page__grid-day-weekday">{weekday}</span>
            <span className="roster-page__grid-day-date">{dayMonth}</span>
            {dayInfo && <DayKindBadge kind={dayInfo.kind} title={dayInfo.title} />}
          </div>
        ),
        render: (row) => {
          const entry = row.byDate[date];

          if (!entry) {
            return <span className="roster-page__grid-empty">–</span>;
          }

          const cellKey = `${row.employee_id}-${date}`;

          return (
            <RosterCellMenu
              entry={entry}
              isOpen={openCellKey === cellKey}
              onToggle={() => setOpenCellKey(openCellKey === cellKey ? null : cellKey)}
              onClose={() => setOpenCellKey((current) => (current === cellKey ? null : current))}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onEdit={openEditModal}
              onDelete={(target) => setDeleteTarget(target)}
              colorClass={shiftColorClassById.get(entry.shift_id) || SHIFT_COLOR_PALETTE[0]}
              align={align}
            />
          );
        },
      };
    }),
  ];

  return (
    <div className="roster-page">
      <PageHeader
        title="Shift Roster"
        subtitle="View and manage day-by-day shift assignments"
        actions={
          <div className="roster-page__header-actions">
            {canCreate && (
              <button type="button" className="roster-page__bulk-button" onClick={openBulkModal}>
                <Users2 size={16} />
                Bulk assign
              </button>
            )}
            {canCreate && (
              <button type="button" className="roster-page__add-button" onClick={openCreateModal}>
                <Plus size={16} />
                Assign shift
              </button>
            )}
          </div>
        }
      />

      <div className="roster-page__filter-bar">
        <FormInput
          label="Start Date"
          name="start_date"
          type="date"
          value={startDate}
          onChange={setStartDate}
        />
        <FormInput
          label="End Date"
          name="end_date"
          type="date"
          value={endDate}
          onChange={setEndDate}
        />
        <div className="roster-page__filter-select">
          <label className="roster-page__filter-label">Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="roster-page__select"
          >
            <option value="">All departments</option>
            {departments.map((dept) => (
              <option key={dept.department_id} value={dept.department_id}>
                {dept.department_name}
              </option>
            ))}
          </select>
        </div>
        <div className="roster-page__filter-select">
          <label className="roster-page__filter-label">Employee</label>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="roster-page__select"
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

      {loadError && <p className="roster-page__error">{loadError}</p>}
      {actionError && <p className="roster-page__error">{actionError}</p>}

      <div className="roster-page__table-card">
        <div className="roster-page__table-card-header">
          <span className="roster-page__table-card-icon">
            <CalendarRange size={17} />
          </span>
          <div>
            <p className="roster-page__table-card-title">Roster grid</p>
            <p className="roster-page__table-card-subtitle">
              {entries.length === 0
                ? "No shifts assigned for this date range"
                : `${gridRows.length} employee(s) · ${entries.length} shift assignment(s) · ${startDate} to ${endDate}`}
            </p>
          </div>
        </div>

        <div className="roster-page__grid-scroll">
          <DataTable
            columns={gridColumns}
            rows={gridRows}
            isLoading={isLoading}
            emptyMessage="No shifts assigned for this date range"
          />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Assign Shift" : "Edit Shift Assignment"}
      >
        <form onSubmit={handleFormSubmit} className="roster-page__form">
          <div className="roster-page__form-section-header">
            <span className="roster-page__form-section-icon">
              <Users2 size={16} />
            </span>
            <div>
              <p className="roster-page__form-section-title">Shift assignment</p>
              <p className="roster-page__form-section-subtitle">
                {modalMode === "create"
                  ? "Assign a shift to an employee for a specific date"
                  : "Update the shift or date for this assignment"}
              </p>
            </div>
          </div>

          {modalMode === "edit" ? (
            <div className="roster-page__readonly-field">
              <span className="roster-page__readonly-label">Employee</span>
              <span className="roster-page__readonly-value">
                {editingEntry.first_name} {editingEntry.last_name} ({editingEntry.employee_code})
              </span>
            </div>
          ) : (
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
          )}

          <div className="roster-page__form-grid">
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
              required
            />

            <FormInput
              label="Date"
              name="roster_date"
              type="date"
              value={formData.roster_date}
              onChange={(value) => setFormData({ ...formData, roster_date: value })}
              required
            />
          </div>

          {formError && <p className="roster-page__form-error">{formError}</p>}

          <div className="roster-page__form-actions">
            <button type="button" className="roster-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="roster-page__submit">
              {modalMode === "create" ? "Assign Shift" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isBulkModalOpen} onClose={closeBulkModal} title="Bulk Assign Shift">
        {bulkResult ? (
          <div className="roster-page__bulk-result">
            <p className="roster-page__bulk-result-summary">
              {bulkResult.assigned} shift(s) assigned, {bulkResult.skipped} skipped (already scheduled).
            </p>

            {bulkResult.skipped_non_working_dates?.length > 0 && (
              <p className="roster-page__bulk-skipped-title">
                {bulkResult.skipped_non_working_dates.length} weekend/holiday date(s) skipped:{" "}
                {bulkResult.skipped_non_working_dates.join(", ")}. Assign a shift on those days individually if it is needed.
              </p>
            )}

            {bulkResult.skipped_details.length > 0 && (
              <div className="roster-page__bulk-skipped-list">
                <p className="roster-page__bulk-skipped-title">Skipped:</p>
                <ul>
                  {bulkResult.skipped_details.map((skip, index) => (
                    <li key={index}>
                      {skip.first_name} {skip.last_name} - {skip.roster_date}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="roster-page__form-actions">
              <button type="button" className="roster-page__submit" onClick={closeBulkModal}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleBulkSubmit} className="roster-page__form">
            <div className="roster-page__bulk-target-toggle">
              <button
                type="button"
                className={`roster-page__bulk-target-option ${
                  bulkAssignTo === "employee" ? "roster-page__bulk-target-option--active" : ""
                }`}
                onClick={() => setBulkAssignTo("employee")}
              >
                Single employee
              </button>
              <button
                type="button"
                className={`roster-page__bulk-target-option ${
                  bulkAssignTo === "department" ? "roster-page__bulk-target-option--active" : ""
                }`}
                onClick={() => setBulkAssignTo("department")}
              >
                Whole department
              </button>
            </div>

            {bulkAssignTo === "employee" ? (
              <FormInput
                label="Employee"
                name="bulk_employee_id"
                type="select"
                value={bulkFormData.employee_id}
                onChange={(value) => setBulkFormData({ ...bulkFormData, employee_id: value })}
                options={employees.map((emp) => ({
                  value: String(emp.employee_id),
                  label: `${emp.first_name} ${emp.last_name} (${emp.employee_code})`,
                }))}
                required
              />
            ) : (
              <FormInput
                label="Department"
                name="bulk_department_id"
                type="select"
                value={bulkFormData.department_id}
                onChange={(value) => setBulkFormData({ ...bulkFormData, department_id: value })}
                options={departments.map((dept) => ({
                  value: String(dept.department_id),
                  label: dept.department_name,
                }))}
                required
              />
            )}

            <FormInput
              label="Shift"
              name="bulk_shift_id"
              type="select"
              value={bulkFormData.shift_id}
              onChange={(value) => setBulkFormData({ ...bulkFormData, shift_id: value })}
              options={shifts.map((shift) => ({
                value: String(shift.shift_id),
                label: `${shift.shift_name} (${shift.start_time} - ${shift.end_time})`,
              }))}
              required
            />

            <div className="roster-page__form-grid">
              <FormInput
                label="Start Date"
                name="bulk_start_date"
                type="date"
                value={bulkFormData.start_date}
                onChange={(value) => setBulkFormData({ ...bulkFormData, start_date: value })}
                required
              />

              <FormInput
                label="End Date"
                name="bulk_end_date"
                type="date"
                value={bulkFormData.end_date}
                onChange={(value) => setBulkFormData({ ...bulkFormData, end_date: value })}
                required
              />
            </div>

            <p className="roster-page__bulk-note">
              Employees who already have a shift assigned on a given date will be skipped, not overwritten.
            </p>

            {bulkError && <p className="roster-page__form-error">{bulkError}</p>}

            <div className="roster-page__form-actions">
              <button type="button" className="roster-page__cancel" onClick={closeBulkModal}>
                Cancel
              </button>
              <button type="submit" className="roster-page__submit">
                Assign
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Remove Shift Assignment"
        message={
          deleteTarget
            ? `Remove ${deleteTarget.first_name} ${deleteTarget.last_name}'s shift assignment on ${deleteTarget.roster_date}? This cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default RosterPage;