import "./GradeListPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, Star } from "lucide-react";
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
  listGrades,
  createGrade,
  updateGrade,
  archiveGrade,
  restoreGrade,
  permanentlyDeleteGrade,
} from "../../../services/api/gradeApi.js";

const PAGE_SIZE = 10;

const GRADE_OPTIONS = [
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "C", label: "C" },
  { value: "D", label: "D" },
];

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before, just presented as a dropdown instead of
// inline icon buttons.
function GradeActionsMenu({
  grade,
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

  const hasAnyAction = grade.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="grade-list-page__menu" ref={menuRef}>
      <button
        type="button"
        className="grade-list-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="grade-list-page__menu-panel" role="menu">
          {grade.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="grade-list-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(grade);
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
                  className="grade-list-page__menu-item grade-list-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(grade);
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
                  className="grade-list-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(grade);
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
                  className="grade-list-page__menu-item grade-list-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(grade);
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

function GradeListPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "grades.create");
  const canUpdate = hasPermission(admin, "grades.update");
  const canArchive = hasPermission(admin, "grades.archive");
  const canRestore = hasPermission(admin, "grades.restore");
  const canPermanentlyDelete = hasPermission(admin, "grades.delete");

  const [grades, setGrades] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingGrade, setEditingGrade] = useState(null);
  const [formData, setFormData] = useState({ grade_name: "", status: "Active" });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const fetchGrades = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listGrades({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setGrades(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load grades. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGrades();
  }, [page, showArchived]);

  const openCreateModal = () => {
    setFormData({ grade_name: "", status: "Active" });
    setFormError("");
    setEditingGrade(null);
    setModalMode("create");
  };

  const openEditModal = (grade) => {
    setFormData({ grade_name: grade.grade_name, status: grade.status });
    setFormError("");
    setEditingGrade(grade);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingGrade(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.grade_name) {
      setFormError("Grade is required");
      return;
    }

    try {
      if (modalMode === "create") {
        await createGrade(formData);
      } else {
        await updateGrade(editingGrade.grade_id, formData);
      }

      closeModal();
      fetchGrades();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveGrade(archiveTarget.grade_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchGrades();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive grade. Please try again.");
    }
  };

  const handleRestore = async (grade) => {
    try {
      await restoreGrade(grade.grade_id);
      setArchiveError("");
      fetchGrades();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore grade. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteGrade(permanentDeleteTarget.grade_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchGrades();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete grade. Please try again.");
    }
  };

  const columns = [
    {
      key: "grade_code",
      label: "Grade Code",
      render: (row) => <span className="grade-list-page__code-cell">{row.grade_code}</span>,
    },
    {
      key: "grade_name",
      label: "Grade",
      render: (row) => <span className="grade-list-page__name-cell">{row.grade_name}</span>,
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
          <span className="grade-list-page__archived-badge">Archived</span>
        ) : (
          <span className="grade-list-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <GradeActionsMenu
          grade={row}
          isOpen={openMenuId === row.grade_id}
          onToggle={() => setOpenMenuId(openMenuId === row.grade_id ? null : row.grade_id)}
          onClose={() => setOpenMenuId((current) => (current === row.grade_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          onEdit={openEditModal}
          onArchive={(grade) => setArchiveTarget(grade)}
          onRestore={handleRestore}
          onPermanentDelete={(grade) => setPermanentDeleteTarget(grade)}
        />
      ),
    },
  ];

  return (
    <div className="grade-list-page">
      <PageHeader
        title="Grades"
        subtitle="Manage employee grades"
        actions={
          canCreate && (
            <button type="button" className="grade-list-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add grade
            </button>
          )
        }
      />

      <div className="grade-list-page__controls">
        <label className="grade-list-page__archived-toggle">
          <span
            className={`grade-list-page__switch ${showArchived ? "grade-list-page__switch--on" : ""}`}
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
            <span className="grade-list-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="grade-list-page__delete-error">{loadError}</p>}
      {archiveError && <p className="grade-list-page__delete-error">{archiveError}</p>}

      <div className="grade-list-page__table-card">
        <div className="grade-list-page__table-card-header">
          <span className="grade-list-page__table-card-icon">
            <Star size={17} />
          </span>
          <div>
            <p className="grade-list-page__table-card-title">Grades directory</p>
            <p className="grade-list-page__table-card-subtitle">
              {total === 0 ? "No grades yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={grades}
          isLoading={isLoading}
          emptyMessage="No grades found"
        />

        <div className="grade-list-page__table-card-footer">
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
        title={modalMode === "create" ? "Add Grade" : "Edit Grade"}
      >
        <form onSubmit={handleFormSubmit}>
          {modalMode === "edit" && (
            <p className="grade-list-page__code">
              Grade Code: {editingGrade.grade_code}
            </p>
          )}

          <FormInput
            label="Grade"
            name="grade_name"
            type="select"
            value={formData.grade_name}
            onChange={(value) => setFormData({ ...formData, grade_name: value })}
            options={GRADE_OPTIONS}
            error={formError}
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

          <div className="grade-list-page__form-actions">
            <button type="button" className="grade-list-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="grade-list-page__submit">
              {modalMode === "create" ? "Create Grade" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Grade"
        message={`Are you sure you want to archive Grade ${archiveTarget?.grade_name}? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Grade"
        message={`Are you sure you want to permanently delete Grade ${permanentDeleteTarget?.grade_name}? This action cannot be undone and the record cannot be restored afterward.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default GradeListPage;