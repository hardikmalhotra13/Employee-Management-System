import "./ShiftListPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, Clock } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listShifts,
  createShift,
  updateShift,
  archiveShift,
  restoreShift,
  permanentlyDeleteShift,
} from "../../../services/api/shiftApi.js";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

function formatTime12Hour(timeValue) {
  if (!timeValue) return timeValue;

  const [hoursStr, minutesStr] = timeValue.split(":");
  const hours = Number(hoursStr);
  if (Number.isNaN(hours)) return timeValue;

  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;

  return `${String(displayHours).padStart(2, "0")}:${minutesStr} ${period}`;
}

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before, just presented as a dropdown instead of
// inline icon buttons.
function ShiftActionsMenu({
  shift,
  isOpen,
  onToggle,
  onClose,
  canUpdate,
  canArchive,
  canRestore,
  canPermanentlyDelete,
  onEdit,
  onArchive,
  onRestore,
  onPermanentDelete,
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

  const hasAnyAction = shift.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="shift-list-page__menu" ref={menuRef}>
      <button
        type="button"
        className="shift-list-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="shift-list-page__menu-panel" role="menu">
          {shift.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="shift-list-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(shift);
                    onClose();
                  }}
                >
                  <ArchiveRestore size={15} />
                  Restore
                </button>
              )}
              {canPermanentlyDelete && (
                <button
                  type="button"
                  className="shift-list-page__menu-item shift-list-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(shift);
                    onClose();
                  }}
                >
                  <Trash2 size={15} />
                  Permanently Delete
                </button>
              )}
            </>
          ) : (
            <>
              {canUpdate && (
                <button
                  type="button"
                  className="shift-list-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(shift);
                    onClose();
                  }}
                >
                  <Pencil size={15} />
                  Edit
                </button>
              )}
              {canArchive && (
                <button
                  type="button"
                  className="shift-list-page__menu-item shift-list-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(shift);
                    onClose();
                  }}
                >
                  <Archive size={15} />
                  Archive
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ShiftListPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "shifts.create");
  const canUpdate = hasPermission(admin, "shifts.update");
  const canArchive = hasPermission(admin, "shifts.archive");
  const canRestore = hasPermission(admin, "shifts.restore");
  const canPermanentlyDelete = hasPermission(admin, "shifts.delete");

  const [shifts, setShifts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingShift, setEditingShift] = useState(null);
  const [formData, setFormData] = useState({
    shift_name: "",
    start_time: "",
    end_time: "",
    status: "Active",
  });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const fetchShifts = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listShifts({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setShifts(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load shifts. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShifts();
  }, [page, showArchived]);

  const openCreateModal = () => {
    setFormData({ shift_name: "", start_time: "", end_time: "", status: "Active" });
    setFormError("");
    setEditingShift(null);
    setModalMode("create");
  };

  const openEditModal = (shift) => {
    setFormData({
      shift_name: shift.shift_name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      status: shift.status,
    });
    setFormError("");
    setEditingShift(shift);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingShift(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.shift_name.trim() || !formData.start_time || !formData.end_time) {
      setFormError("Shift name, start time, and end time are required");
      return;
    }

    try {
      if (modalMode === "create") {
        await createShift(formData);
      } else {
        await updateShift(editingShift.shift_id, formData);
      }

      closeModal();
      fetchShifts();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveShift(archiveTarget.shift_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchShifts();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive shift. Please try again.");
    }
  };

  const handleRestore = async (shift) => {
    try {
      await restoreShift(shift.shift_id);
      setArchiveError("");
      fetchShifts();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore shift. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteShift(permanentDeleteTarget.shift_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchShifts();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete shift. Please try again.");
    }
  };

  const columns = [
    {
      key: "shift_code",
      label: "Shift Code",
      render: (row) => <span className="shift-list-page__code-cell">{row.shift_code}</span>,
    },
    {
      key: "shift_name",
      label: "Shift Name",
      render: (row) => <span className="shift-list-page__name-cell">{row.shift_name}</span>,
    },
    {
      key: "start_time",
      label: "Start Time",
      render: (row) => (
        <span className="shift-list-page__time-cell">{formatTime12Hour(row.start_time)}</span>
      ),
    },
    {
      key: "end_time",
      label: "End Time",
      render: (row) => (
        <span className="shift-list-page__time-cell">{formatTime12Hour(row.end_time)}</span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "is_archived",
      label: "Archived",
      render: (row) =>
        row.is_archived ? (
          <span className="shift-list-page__archived-badge">Archived</span>
        ) : (
          <span className="shift-list-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <ShiftActionsMenu
          shift={row}
          isOpen={openMenuId === row.shift_id}
          onToggle={() => setOpenMenuId(openMenuId === row.shift_id ? null : row.shift_id)}
          onClose={() => setOpenMenuId((current) => (current === row.shift_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          onEdit={openEditModal}
          onArchive={(shift) => setArchiveTarget(shift)}
          onRestore={handleRestore}
          onPermanentDelete={(shift) => setPermanentDeleteTarget(shift)}
        />
      ),
    },
  ];

  return (
    <div className="shift-list-page">
      <PageHeader
        title="Shifts"
        subtitle="Manage work shifts"
        actions={
          canCreate && (
            <button type="button" className="shift-list-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add shift
            </button>
          )
        }
      />

      <div className="shift-list-page__controls">
        <label className="shift-list-page__archived-toggle">
          <span
            className={`shift-list-page__switch ${showArchived ? "shift-list-page__switch--on" : ""}`}
            onClick={() => setShowArchived(!showArchived)}
            role="checkbox"
            aria-checked={showArchived}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowArchived(!showArchived);
              }
            }}
          >
            <span className="shift-list-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="shift-list-page__delete-error">{loadError}</p>}
      {archiveError && <p className="shift-list-page__delete-error">{archiveError}</p>}

      <div className="shift-list-page__table-card">
        <div className="shift-list-page__table-card-header">
          <span className="shift-list-page__table-card-icon">
            <Clock size={17} />
          </span>
          <div>
            <p className="shift-list-page__table-card-title">Shifts directory</p>
            <p className="shift-list-page__table-card-subtitle">
              {total === 0
                ? "No shifts yet"
                : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={shifts}
          isLoading={isLoading}
          emptyMessage="No shifts found"
        />

        <div className="shift-list-page__table-card-footer">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Shift" : "Edit Shift"}
      >
        <form onSubmit={handleFormSubmit} className="shift-list-page__form">
          <div className="shift-list-page__form-section-header">
            <span className="shift-list-page__form-section-icon">
              <Clock size={16} />
            </span>
            <div>
              <p className="shift-list-page__form-section-title">Shift information</p>
              <p className="shift-list-page__form-section-subtitle">
                {modalMode === "create"
                  ? "Create a new work shift for your organization"
                  : "Update the shift name, timings and status"}
              </p>
            </div>
          </div>

          {modalMode === "edit" && (
            <div className="shift-list-page__code-field">
              <span className="shift-list-page__code-label">Shift Code</span>
              <span className="shift-list-page__code-value">{editingShift.shift_code}</span>
            </div>
          )}

          <FormInput
            label="Shift Name"
            name="shift_name"
            value={formData.shift_name}
            onChange={(value) => setFormData({ ...formData, shift_name: value })}
            error={formError}
            required
          />

          <div className="shift-list-page__form-grid">
            <FormInput
              label="Start Time"
              name="start_time"
              type="time"
              value={formData.start_time}
              onChange={(value) => setFormData({ ...formData, start_time: value })}
              required
            />

            <FormInput
              label="End Time"
              name="end_time"
              type="time"
              value={formData.end_time}
              onChange={(value) => setFormData({ ...formData, end_time: value })}
              required
            />
          </div>

          <FormInput
            label="Status"
            name="status"
            type="select"
            value={formData.status}
            onChange={(value) => setFormData({ ...formData, status: value })}
            options={STATUS_OPTIONS}
            required
          />

          <div className="shift-list-page__form-actions">
            <button type="button" className="shift-list-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="shift-list-page__submit">
              {modalMode === "create" ? "Create Shift" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Shift"
        message={`Are you sure you want to archive ${archiveTarget?.shift_name}? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Shift"
        message={`Are you sure you want to permanently delete ${permanentDeleteTarget?.shift_name}? This action cannot be undone and the record cannot be restored afterward.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default ShiftListPage;