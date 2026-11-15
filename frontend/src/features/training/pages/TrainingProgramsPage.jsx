import "./TrainingProgramsPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, Users, MoreHorizontal, GraduationCap } from "lucide-react";
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
  listTrainingPrograms,
  createTrainingProgram,
  updateTrainingProgram,
  archiveTrainingProgram,
  restoreTrainingProgram,
  permanentlyDeleteTrainingProgram,
  assignTrainingToAll,
} from "../../../services/api/trainingApi.js";

const PAGE_SIZE = 10;

// Formats today's date as YYYY-MM-DD from local calendar fields.
// toISOString() converts to UTC first, which silently rolls the date back
// by one day in timezones ahead of UTC (e.g. IST) - see Roster's fix for
// the same issue.
function todayLocalDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

const TYPE_OPTIONS = [
  { value: "Training", label: "Training" },
  { value: "Certification", label: "Certification" },
];

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before (including the existing Assign to All
// capability), just presented as a dropdown instead of inline icon buttons.
function ProgramActionsMenu({
  program,
  isOpen,
  onToggle,
  onClose,
  canUpdate,
  canArchive,
  canRestore,
  canPermanentlyDelete,
  canAssign,
  onEdit,
  onAssignAll,
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

  const canAssignAll = canAssign && program.status === "Active" && !program.is_archived;
  const hasAnyAction = program.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive || canAssignAll;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="training-programs-page__menu" ref={menuRef}>
      <button
        type="button"
        className="training-programs-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="training-programs-page__menu-panel" role="menu">
          {program.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="training-programs-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(program);
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
                  className="training-programs-page__menu-item training-programs-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(program);
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
                  className="training-programs-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(program);
                    onClose();
                  }}
                >
                  <Pencil size={15} />
                  Edit
                </button>
              )}
              {canAssignAll && (
                <button
                  type="button"
                  className="training-programs-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onAssignAll(program);
                    onClose();
                  }}
                >
                  <Users size={15} />
                  Assign to All
                </button>
              )}
              {canArchive && (
                <button
                  type="button"
                  className="training-programs-page__menu-item training-programs-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(program);
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

function TrainingProgramsPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "training.manage");
  const canUpdate = hasPermission(admin, "training.manage");
  const canArchive = hasPermission(admin, "training.manage");
  const canRestore = hasPermission(admin, "training.manage");
  const canPermanentlyDelete = hasPermission(admin, "training.manage");
  const canAssign = hasPermission(admin, "training.manage");

  const [programs, setPrograms] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingProgram, setEditingProgram] = useState(null);
  const [formData, setFormData] = useState({
    program_name: "",
    program_type: "Training",
    validity_months: "",
    status: "Active",
  });
  const [formErrors, setFormErrors] = useState({});

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const [assignAllTarget, setAssignAllTarget] = useState(null);
  const [assignAllDueDate, setAssignAllDueDate] = useState("");
  const [assignAllResult, setAssignAllResult] = useState("");
  const [assignAllError, setAssignAllError] = useState("");
  const [isAssigningAll, setIsAssigningAll] = useState(false);

  const fetchPrograms = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listTrainingPrograms({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setPrograms(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load training programs. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPrograms();
  }, [page, showArchived]);

  const openCreateModal = () => {
    setFormData({ program_name: "", program_type: "Training", validity_months: "", status: "Active" });
    setFormErrors({});
    setEditingProgram(null);
    setModalMode("create");
  };

  const openEditModal = (program) => {
    setFormData({
      program_name: program.program_name,
      program_type: program.program_type,
      validity_months: program.validity_months ? String(program.validity_months) : "",
      status: program.status,
    });
    setFormErrors({});
    setEditingProgram(program);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingProgram(null);
    setFormErrors({});
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    const errors = {};
    if (!formData.program_name.trim()) {
      errors.program_name = "Program name is required";
    }
    if (formData.program_type === "Certification" && formData.validity_months) {
      const months = Number(formData.validity_months);
      if (!Number.isInteger(months) || months <= 0) {
        errors.validity_months = "Validity (months) must be a positive whole number";
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    const payload = {
      program_name: formData.program_name,
      program_type: formData.program_type,
      validity_months:
        formData.program_type === "Certification" && formData.validity_months
          ? Number(formData.validity_months)
          : null,
      status: formData.status,
    };

    try {
      if (modalMode === "create") {
        await createTrainingProgram(payload);
      } else {
        await updateTrainingProgram(editingProgram.program_id, payload);
      }

      closeModal();
      fetchPrograms();
    } catch (err) {
      const backendErrors = err.response?.data?.errors;
      if (backendErrors) {
        setFormErrors(backendErrors);
      } else {
        setFormErrors({ _general: err.response?.data?.message || "Something went wrong. Please try again." });
      }
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveTrainingProgram(archiveTarget.program_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchPrograms();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive training program. Please try again.");
    }
  };

  const handleRestore = async (program) => {
    try {
      await restoreTrainingProgram(program.program_id);
      setArchiveError("");
      fetchPrograms();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore training program. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteTrainingProgram(permanentDeleteTarget.program_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchPrograms();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete training program. Please try again.");
    }
  };

  const openAssignAllModal = (program) => {
    setAssignAllTarget(program);
    setAssignAllDueDate("");
    setAssignAllResult("");
    setAssignAllError("");
  };

  const handleConfirmAssignAll = async () => {
    if (assignAllDueDate) {
      const today = todayLocalDateString();
      if (assignAllDueDate < today) {
        setAssignAllError("Due date cannot be before the assignment date");
        return;
      }
    }

    setIsAssigningAll(true);
    setAssignAllError("");

    try {
      const result = await assignTrainingToAll(assignAllTarget.program_id, assignAllDueDate || null);
      setAssignAllResult(result.message);
    } catch (err) {
      setAssignAllError(err.response?.data?.message || "Failed to assign training. Please try again.");
    } finally {
      setIsAssigningAll(false);
    }
  };

  const columns = [
    { key: "program_code", label: "Code" },
    { key: "program_name", label: "Program Name" },
    { key: "program_type", label: "Type" },
    {
      key: "validity_months",
      label: "Validity",
      render: (row) =>
        row.validity_months ? `${row.validity_months} months` : row.program_type === "Certification" ? "No expiry" : "-",
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
          <span className="training-programs-page__archived-badge">Archived</span>
        ) : (
          <span className="training-programs-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <ProgramActionsMenu
          program={row}
          isOpen={openMenuId === row.program_id}
          onToggle={() => setOpenMenuId(openMenuId === row.program_id ? null : row.program_id)}
          onClose={() => setOpenMenuId((current) => (current === row.program_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          canAssign={canAssign}
          onEdit={openEditModal}
          onAssignAll={openAssignAllModal}
          onArchive={(program) => setArchiveTarget(program)}
          onRestore={handleRestore}
          onPermanentDelete={(program) => setPermanentDeleteTarget(program)}
        />
      ),
    },
  ];

  return (
    <div className="training-programs-page">
      <PageHeader
        title="Training & Certification Programs"
        subtitle="Manage the catalog used to assign training and certifications to employees"
        actions={
          canCreate && (
            <button type="button" className="training-programs-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add Program
            </button>
          )
        }
      />

      <div className="training-programs-page__controls">
        <label className="training-programs-page__archived-toggle">
          <span
            className={`training-programs-page__switch ${showArchived ? "training-programs-page__switch--on" : ""}`}
            onClick={() => {
              setShowArchived(!showArchived);
              setPage(1);
            }}
            role="checkbox"
            aria-checked={showArchived}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowArchived(!showArchived);
                setPage(1);
              }
            }}
          >
            <span className="training-programs-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="training-programs-page__delete-error">{loadError}</p>}
      {archiveError && <p className="training-programs-page__delete-error">{archiveError}</p>}

      <div className="training-programs-page__table-card">
        <div className="training-programs-page__table-card-header">
          <span className="training-programs-page__table-card-icon">
            <GraduationCap size={17} />
          </span>
          <div>
            <p className="training-programs-page__table-card-title">Programs</p>
            <p className="training-programs-page__table-card-subtitle">
              {total === 0 ? "No training programs yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={programs}
          isLoading={isLoading}
          emptyMessage="No training programs found"
        />

        <div className="training-programs-page__table-card-footer">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Program" : "Edit Program"}
      >
        <form onSubmit={handleFormSubmit}>
          <div className="training-programs-page__form-section-header">
            <span className="training-programs-page__form-section-icon">
              <GraduationCap size={16} />
            </span>
            <div>
              <p className="training-programs-page__form-section-title">Program details</p>
              <p className="training-programs-page__form-section-subtitle">
                {modalMode === "create"
                  ? "Create a new training or certification program"
                  : "Update this program's details"}
              </p>
            </div>
          </div>

          {modalMode === "edit" && (
            <div className="training-programs-page__code-field">
              <span className="training-programs-page__code-label">Program Code</span>
              <span className="training-programs-page__code-value">{editingProgram.program_code}</span>
            </div>
          )}

          {formErrors._general && <p className="training-programs-page__delete-error">{formErrors._general}</p>}

          <FormInput
            label="Program Name"
            name="program_name"
            value={formData.program_name}
            onChange={(value) => setFormData({ ...formData, program_name: value })}
            error={formErrors.program_name}
            required
          />

          <div className="training-programs-page__form-grid">
            <FormInput
              label="Program Type"
              name="program_type"
              type="select"
              value={formData.program_type}
              onChange={(value) => setFormData({ ...formData, program_type: value, validity_months: "" })}
              options={TYPE_OPTIONS}
              error={formErrors.program_type}
              disabled={Boolean(editingProgram?.has_records)}
              required
            />

            <FormInput
              label="Status"
              name="status"
              type="select"
              value={formData.status}
              onChange={(value) => setFormData({ ...formData, status: value })}
              options={STATUS_OPTIONS}
              required
            />
          </div>

          {editingProgram?.has_records && (
            <p className="training-programs-page__type-locked-note">
              Program type cannot be changed because employee records already exist for this program.
            </p>
          )}

          {formData.program_type === "Certification" && (
            <FormInput
              label="Validity (months, leave blank for no expiry)"
              name="validity_months"
              type="number"
              value={formData.validity_months}
              onChange={(value) => setFormData({ ...formData, validity_months: value })}
              error={formErrors.validity_months}
            />
          )}

          <div className="training-programs-page__form-actions">
            <button type="button" className="training-programs-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="training-programs-page__submit">
              {modalMode === "create" ? "Create Program" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Training Program"
        message={`Are you sure you want to archive "${archiveTarget?.program_name}"? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Training Program"
        message={`Are you sure you want to permanently delete "${permanentDeleteTarget?.program_name}"? This action cannot be undone. Programs already used by an employee record cannot be deleted.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />

      <Modal
        isOpen={assignAllTarget !== null}
        onClose={() => setAssignAllTarget(null)}
        title="Assign to All Eligible Employees"
      >
        {!assignAllResult ? (
          <>
            <p className="training-programs-page__assign-all-copy">
              This will assign "{assignAllTarget?.program_name}" to every active employee who does not already
              have an open assignment for this program. Archived and inactive employees are skipped.
            </p>

            <FormInput
              label="Due Date (optional)"
              name="assign_all_due_date"
              type="date"
              value={assignAllDueDate}
              onChange={setAssignAllDueDate}
            />

            {assignAllError && <p className="training-programs-page__delete-error">{assignAllError}</p>}

            <div className="training-programs-page__form-actions">
              <button type="button" className="training-programs-page__cancel" onClick={() => setAssignAllTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="training-programs-page__submit"
                disabled={isAssigningAll}
                onClick={handleConfirmAssignAll}
              >
                {isAssigningAll ? "Assigning..." : "Assign to All"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="training-programs-page__assign-all-copy">{assignAllResult}</p>
            <div className="training-programs-page__form-actions">
              <button
                type="button"
                className="training-programs-page__submit"
                onClick={() => setAssignAllTarget(null)}
              >
                Done
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default TrainingProgramsPage;