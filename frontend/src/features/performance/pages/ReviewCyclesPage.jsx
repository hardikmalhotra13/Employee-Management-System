import "./ReviewCyclesPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, CalendarRange } from "lucide-react";
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
  listReviewCycles,
  createReviewCycle,
  updateReviewCycle,
  archiveReviewCycle,
  restoreReviewCycle,
  permanentlyDeleteReviewCycle,
} from "../../../services/api/performanceApi.js";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before, just presented as a dropdown instead of
// inline icon buttons.
function ReviewCycleActionsMenu({
  cycle,
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

  const hasAnyAction = cycle.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="review-cycles-page__menu" ref={menuRef}>
      <button
        type="button"
        className="review-cycles-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="review-cycles-page__menu-panel" role="menu">
          {cycle.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="review-cycles-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(cycle);
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
                  className="review-cycles-page__menu-item review-cycles-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(cycle);
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
                  className="review-cycles-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(cycle);
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
                  className="review-cycles-page__menu-item review-cycles-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(cycle);
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

function ReviewCyclesPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "performance.manage");
  const canUpdate = hasPermission(admin, "performance.manage");
  const canArchive = hasPermission(admin, "performance.manage");
  const canRestore = hasPermission(admin, "performance.manage");
  const canPermanentlyDelete = hasPermission(admin, "performance.manage");

  const [cycles, setCycles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingCycle, setEditingCycle] = useState(null);
  const [formData, setFormData] = useState({
    cycle_name: "",
    start_date: "",
    end_date: "",
    status: "Active",
  });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const fetchCycles = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listReviewCycles({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setCycles(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load review cycles. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCycles();
  }, [page, showArchived]);

  const openCreateModal = () => {
    setFormData({ cycle_name: "", start_date: "", end_date: "", status: "Active" });
    setFormError("");
    setEditingCycle(null);
    setModalMode("create");
  };

  const openEditModal = (cycle) => {
    setFormData({
      cycle_name: cycle.cycle_name,
      start_date: cycle.start_date,
      end_date: cycle.end_date,
      status: cycle.status,
    });
    setFormError("");
    setEditingCycle(cycle);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingCycle(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.cycle_name.trim()) {
      setFormError("Cycle name is required");
      return;
    }

    // Matches backend validation exactly: only end_date < start_date is
    // rejected - start_date === end_date (a single-day cycle) is allowed.
    if (formData.start_date && formData.end_date && formData.end_date < formData.start_date) {
      setFormError("End date cannot be before start date");
      return;
    }

    const payload = {
      cycle_name: formData.cycle_name,
      start_date: formData.start_date,
      end_date: formData.end_date,
      status: formData.status,
    };

    try {
      if (modalMode === "create") {
        await createReviewCycle(payload);
      } else {
        await updateReviewCycle(editingCycle.cycle_id, payload);
      }

      closeModal();
      fetchCycles();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveReviewCycle(archiveTarget.cycle_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchCycles();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive review cycle. Please try again.");
    }
  };

  const handleRestore = async (cycle) => {
    try {
      await restoreReviewCycle(cycle.cycle_id);
      setArchiveError("");
      fetchCycles();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore review cycle. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteReviewCycle(permanentDeleteTarget.cycle_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchCycles();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete review cycle. Please try again.");
    }
  };

  const columns = [
    {
      key: "cycle_code",
      label: "Cycle Code",
      render: (row) => <span className="review-cycles-page__code-cell">{row.cycle_code}</span>,
    },
    {
      key: "cycle_name",
      label: "Cycle Name",
      render: (row) => <span className="review-cycles-page__name-cell">{row.cycle_name}</span>,
    },
    { key: "start_date", label: "Start Date" },
    { key: "end_date", label: "End Date" },
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
          <span className="review-cycles-page__archived-badge">Archived</span>
        ) : (
          <span className="review-cycles-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <ReviewCycleActionsMenu
          cycle={row}
          isOpen={openMenuId === row.cycle_id}
          onToggle={() => setOpenMenuId(openMenuId === row.cycle_id ? null : row.cycle_id)}
          onClose={() => setOpenMenuId((current) => (current === row.cycle_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          onEdit={openEditModal}
          onArchive={(cycle) => setArchiveTarget(cycle)}
          onRestore={handleRestore}
          onPermanentDelete={(cycle) => setPermanentDeleteTarget(cycle)}
        />
      ),
    },
  ];

  return (
    <div className="review-cycles-page">
      <PageHeader
        title="Review Cycles"
        subtitle="Manage the review periods used to create performance reviews"
        actions={
          canCreate && (
            <button type="button" className="review-cycles-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add review cycle
            </button>
          )
        }
      />

      <div className="review-cycles-page__controls">
        <label className="review-cycles-page__archived-toggle">
          <span
            className={`review-cycles-page__switch ${showArchived ? "review-cycles-page__switch--on" : ""}`}
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
            <span className="review-cycles-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="review-cycles-page__delete-error">{loadError}</p>}
      {archiveError && <p className="review-cycles-page__delete-error">{archiveError}</p>}

      <div className="review-cycles-page__table-card">
        <div className="review-cycles-page__table-card-header">
          <span className="review-cycles-page__table-card-icon">
            <CalendarRange size={17} />
          </span>
          <div>
            <p className="review-cycles-page__table-card-title">Review cycles</p>
            <p className="review-cycles-page__table-card-subtitle">
              {total === 0 ? "No review cycles yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={cycles}
          isLoading={isLoading}
          emptyMessage="No review cycles found"
        />

        <div className="review-cycles-page__table-card-footer">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Review Cycle" : "Edit Review Cycle"}
      >
        <form onSubmit={handleFormSubmit}>
          <div className="review-cycles-page__form-section-header">
            <span className="review-cycles-page__form-section-icon">
              <CalendarRange size={16} />
            </span>
            <div>
              <p className="review-cycles-page__form-section-title">Review cycle</p>
              <p className="review-cycles-page__form-section-subtitle">
                {modalMode === "create"
                  ? "Create a new review period for performance reviews"
                  : "Update this review cycle's details"}
              </p>
            </div>
          </div>

          {modalMode === "edit" && (
            <div className="review-cycles-page__code-field">
              <span className="review-cycles-page__code-label">Cycle Code</span>
              <span className="review-cycles-page__code-value">{editingCycle.cycle_code}</span>
            </div>
          )}

          <FormInput
            label="Cycle Name"
            name="cycle_name"
            value={formData.cycle_name}
            onChange={(value) => setFormData({ ...formData, cycle_name: value })}
            error={formError}
            required
          />

          <div className="review-cycles-page__form-grid">
            <FormInput
              label="Start Date"
              name="start_date"
              type="date"
              value={formData.start_date}
              onChange={(value) => setFormData({ ...formData, start_date: value })}
              required
            />

            <FormInput
              label="End Date"
              name="end_date"
              type="date"
              value={formData.end_date}
              onChange={(value) => setFormData({ ...formData, end_date: value })}
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

          <div className="review-cycles-page__form-actions">
            <button type="button" className="review-cycles-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="review-cycles-page__submit">
              {modalMode === "create" ? "Create Cycle" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Review Cycle"
        message={`Are you sure you want to archive "${archiveTarget?.cycle_name}"? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Review Cycle"
        message={`Are you sure you want to permanently delete "${permanentDeleteTarget?.cycle_name}"? This action cannot be undone. Cycles already used by a performance review cannot be deleted.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default ReviewCyclesPage;