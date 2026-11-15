import "./TeamPerformancePage.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, MoreHorizontal, Eye, Pencil, Send, Trash2, RotateCcw, Info } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import SearchBar from "../../../components/common/SearchBar.jsx";
import {
  getMyTeam,
  getManagerReviewCycles,
  getTeamPerformanceReviews,
  createTeamPerformanceReview,
  updateTeamPerformanceReview,
  submitTeamPerformanceReview,
  deleteTeamPerformanceReview,
} from "../../../services/api/managerApi.js";

const PAGE_SIZE = 5;
const STATUS_OPTIONS = ["Draft", "Submitted"];
const RATING_OPTIONS = [
  { value: "1", label: "1 - Poor" },
  { value: "2", label: "2 - Needs Improvement" },
  { value: "3", label: "3 - Meets Expectations" },
  { value: "4", label: "4 - Exceeds Expectations" },
  { value: "5", label: "5 - Outstanding" },
];

function formatDateShort(value) {
  if (!value) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function cyclePeriodLabel(cycle) {
  if (!cycle) return "";
  return `${formatDateShort(cycle.start_date)} - ${formatDateShort(cycle.end_date)}`;
}

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function StatusBadge({ status }) {
  return (
    <span className={`team-performance-page__status-badge team-performance-page__status-badge--${status.toLowerCase()}`}>
      {status}
    </span>
  );
}

function RowActionsMenu({ items }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="team-performance-page__menu" ref={ref}>
      <button
        type="button"
        className="team-performance-page__menu-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="More actions"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="team-performance-page__menu-dropdown">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`team-performance-page__menu-item ${item.variant === "danger" ? "team-performance-page__menu-item--danger" : ""}`}
              onClick={() => {
                setIsOpen(false);
                item.onClick();
              }}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPerformancePage() {
  const [team, setTeam] = useState([]);
  const [cycles, setCycles] = useState([]);

  const [search, setSearch] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [status, setStatus] = useState("");
  const [rating, setRating] = useState("");
  const [page, setPage] = useState(1);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingReview, setEditingReview] = useState(null);
  const [formData, setFormData] = useState({ employee_id: "", cycle_id: "", rating: "3", comments: "" });
  const [formError, setFormError] = useState("");
  const [isSavingForm, setIsSavingForm] = useState(false);

  const [detailsRow, setDetailsRow] = useState(null);

  const [submitTarget, setSubmitTarget] = useState(null);
  const [submitError, setSubmitError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const [isMutating, setIsMutating] = useState(false);

  const fetchReviews = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getTeamPerformanceReviews({
        search: search || undefined,
        cycle_id: cycleId || undefined,
        status: status || undefined,
        rating: rating || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load your team's performance reviews. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [search, cycleId, status, rating, page]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    setPage(1);
  }, [search, cycleId, status, rating]);

  useEffect(() => {
    getMyTeam().then(setTeam).catch(() => setTeam([]));
    getManagerReviewCycles().then(setCycles).catch(() => setCycles([]));
  }, []);

  const handleReset = () => {
    setSearch("");
    setCycleId("");
    setStatus("");
    setRating("");
  };

  const openCreateModal = () => {
    setFormData({ employee_id: "", cycle_id: "", rating: "3", comments: "" });
    setFormError("");
    setEditingReview(null);
    setModalMode("create");
  };

  const openEditModal = (review) => {
    setFormData({
      employee_id: String(review.employee_id),
      cycle_id: String(review.cycle_id),
      rating: String(review.rating),
      comments: review.comments || "",
    });
    setFormError("");
    setEditingReview(review);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingReview(null);
    setFormError("");
  };

  const selectedCycle = cycles.find((c) => String(c.cycle_id) === formData.cycle_id);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (isSavingForm) return;

    if (modalMode === "create" && (!formData.employee_id || !formData.cycle_id)) {
      setFormError("Please select a team member and a review cycle");
      return;
    }

    setIsSavingForm(true);
    try {
      if (modalMode === "create") {
        await createTeamPerformanceReview(Number(formData.employee_id), {
          cycle_id: Number(formData.cycle_id),
          rating: Number(formData.rating),
          comments: formData.comments,
        });
      } else {
        await updateTeamPerformanceReview(editingReview.review_id, {
          rating: Number(formData.rating),
          comments: formData.comments,
        });
      }

      closeModal();
      fetchReviews();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSavingForm(false);
    }
  };

  const openSubmitDialog = (row) => {
    setSubmitError("");
    setSubmitTarget(row);
  };

  // "Submit Review" inside the Edit Draft modal: save the current field
  // values and submit in one step, with no second confirmation - clicking
  // a clearly-labeled button inside a form the manager is actively
  // editing is already the deliberate action; the separate "..." Submit
  // Review action in the table (no form open) still confirms via
  // ConfirmDialog, same as before.
  const handleSaveAndSubmit = async () => {
    if (isSavingForm) return;
    setFormError("");
    setIsSavingForm(true);
    try {
      await updateTeamPerformanceReview(editingReview.review_id, {
        rating: Number(formData.rating),
        comments: formData.comments,
      });
      await submitTeamPerformanceReview(editingReview.review_id);
      closeModal();
      fetchReviews();
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to submit review. Please try again.");
    } finally {
      setIsSavingForm(false);
    }
  };

  const handleConfirmSubmitReview = async () => {
    if (isMutating) return;
    setSubmitError("");
    setIsMutating(true);
    try {
      await submitTeamPerformanceReview(submitTarget.review_id);
      setSubmitTarget(null);
      fetchReviews();
    } catch (err) {
      setSubmitError(err.response?.data?.message || "Failed to submit review. Please try again.");
    } finally {
      setIsMutating(false);
    }
  };

  const openDeleteDialog = (row) => {
    setDeleteError("");
    setDeleteTarget(row);
  };

  const handleConfirmDelete = async () => {
    if (isMutating) return;
    setDeleteError("");
    setIsMutating(true);
    try {
      await deleteTeamPerformanceReview(deleteTarget.review_id);
      setDeleteTarget(null);
      fetchReviews();
    } catch (err) {
      setDeleteError(err.response?.data?.message || "Failed to delete draft. Please try again.");
    } finally {
      setIsMutating(false);
    }
  };

  const columns = [
    {
      key: "employee",
      label: "Employee",
      render: (row) => (
        <div>
          <div>{row.first_name} {row.last_name}</div>
          <div className="team-performance-page__employee-code">{row.employee_code}</div>
        </div>
      ),
    },
    { key: "cycle", label: "Cycle", render: (row) => row.cycle_name },
    { key: "period", label: "Review Period", render: (row) => cyclePeriodLabel(row) },
    {
      key: "rating",
      label: "Rating",
      render: (row) => (
        <div>
          <div className="team-performance-page__rating-value">{row.rating} / 5</div>
          <div className={`team-performance-page__rating-label team-performance-page__rating-label--r${row.rating}`}>
            {row.rating_label}
          </div>
        </div>
      ),
    },
    { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
    { key: "submitted_at", label: "Submitted On", render: (row) => (row.submitted_at ? formatDateShort(row.submitted_at) : "-") },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        const items = [{ label: "View Details", icon: Eye, onClick: () => setDetailsRow(row) }];
        if (row.status === "Draft") {
          items.push({ label: "Edit Draft", icon: Pencil, onClick: () => openEditModal(row) });
          items.push({ label: "Submit Review", icon: Send, onClick: () => openSubmitDialog(row) });
          items.push({ label: "Delete Draft", icon: Trash2, variant: "danger", onClick: () => openDeleteDialog(row) });
        }
        return <RowActionsMenu items={items} />;
      },
    },
  ];

  return (
    <div className="team-performance-page">
      <PageHeader
        title="Team Performance"
        subtitle="Create and manage performance reviews for your direct reports"
        actions={
          <button type="button" className="team-performance-page__add-button" onClick={openCreateModal}>
            <Plus size={16} />
            Add Review
          </button>
        }
      />

      <div className="team-performance-page__filter-bar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or employee code..." />
        <select className="team-performance-page__select" value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
          <option value="">All Cycles</option>
          {cycles.map((c) => (
            <option key={c.cycle_id} value={c.cycle_id}>{c.cycle_name}</option>
          ))}
        </select>
        <select className="team-performance-page__select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="team-performance-page__select" value={rating} onChange={(e) => setRating(e.target.value)}>
          <option value="">All Ratings</option>
          {RATING_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <button type="button" className="team-performance-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="team-performance-page__table-card">
        {loadError && <p className="team-performance-page__error">{loadError}</p>}

        <DataTable columns={columns} rows={records} isLoading={isLoading} emptyMessage="No performance reviews yet for your team" />

        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Performance Review" : "Edit Performance Review"}
      >
        <form onSubmit={handleFormSubmit}>
          {modalMode === "create" && (
            <>
              <FormInput
                label="Team Member"
                name="employee_id"
                type="select"
                value={formData.employee_id}
                onChange={(value) => setFormData({ ...formData, employee_id: value })}
                options={team.map((t) => ({
                  value: String(t.employee_id),
                  label: `${t.first_name} ${t.last_name}`,
                }))}
                required
              />

              <FormInput
                label="Review Cycle"
                name="cycle_id"
                type="select"
                value={formData.cycle_id}
                onChange={(value) => setFormData({ ...formData, cycle_id: value })}
                options={cycles.map((c) => ({ value: String(c.cycle_id), label: c.cycle_name }))}
                required
              />

              <div className="team-performance-page__period-info">
                <Info size={13} />
                {selectedCycle
                  ? `Review Period: ${cyclePeriodLabel(selectedCycle)}`
                  : "Selected cycle period will be shown here"}
              </div>
            </>
          )}

          {modalMode === "edit" && editingReview && (
            <>
              <div className="team-performance-page__details-header team-performance-page__edit-summary">
                <span className="team-performance-page__details-avatar">
                  {getInitials(editingReview.first_name, editingReview.last_name)}
                </span>
                <div className="team-performance-page__details-identity">
                  <strong>{editingReview.first_name} {editingReview.last_name}</strong>
                  <span>{editingReview.employee_code}</span>
                </div>
                <StatusBadge status={editingReview.status} />
              </div>

              {/* Review cycle is fixed at creation and cannot be changed
                  afterward - the backend's update endpoint only ever
                  accepts rating/comments. Shown as disabled fields (not
                  just muted text) so that is unambiguous here too. */}
              <FormInput label="Review Cycle" name="cycle_name_readonly" value={editingReview.cycle_name} disabled />
              <FormInput label="Review Period" name="cycle_period_readonly" value={cyclePeriodLabel(editingReview)} disabled />
            </>
          )}

          <FormInput
            label="Rating"
            name="rating"
            type="select"
            value={formData.rating}
            onChange={(value) => setFormData({ ...formData, rating: value })}
            options={RATING_OPTIONS}
            required
          />

          <div className="team-performance-page__field">
            <label className="team-performance-page__field-label">Comments</label>
            <textarea
              className="team-performance-page__comments-input"
              rows={3}
              maxLength={1000}
              placeholder="Enter detailed feedback (e.g. strengths, areas of improvement, overall feedback)..."
              value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
            />
            <span className="team-performance-page__char-count">{formData.comments.length}/1000</span>
          </div>

          {formError && <p className="team-performance-page__field-error">{formError}</p>}

          <div className="team-performance-page__form-actions">
            <button type="button" className="team-performance-page__cancel" onClick={closeModal} disabled={isSavingForm}>
              Cancel
            </button>
            <button type="submit" className="team-performance-page__save" disabled={isSavingForm}>
              {isSavingForm ? "Saving..." : modalMode === "create" ? "Save as Draft" : "Save Changes"}
            </button>
            {modalMode === "edit" && (
              <button
                type="button"
                className="team-performance-page__submit-inline"
                disabled={isSavingForm}
                onClick={handleSaveAndSubmit}
              >
                {isSavingForm ? "Submitting..." : "Submit Review"}
              </button>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={detailsRow !== null}
        onClose={() => setDetailsRow(null)}
        title={detailsRow?.status === "Draft" ? "Draft Performance Review" : "Submitted Performance Review"}
      >
        {detailsRow && (
          <div className="team-performance-page__details">
            <div className="team-performance-page__details-header">
              <span className="team-performance-page__details-avatar">
                {getInitials(detailsRow.first_name, detailsRow.last_name)}
              </span>
              <div className="team-performance-page__details-identity">
                <strong>{detailsRow.first_name} {detailsRow.last_name}</strong>
                <span>{detailsRow.employee_code}</span>
              </div>
              <StatusBadge status={detailsRow.status} />
            </div>

            <div className="team-performance-page__details-grid">
              <div className="team-performance-page__details-cell">
                <span>Review Cycle</span>
                <strong>{detailsRow.cycle_name}</strong>
              </div>
              <div className="team-performance-page__details-cell">
                <span>Review Period</span>
                <strong>{cyclePeriodLabel(detailsRow)}</strong>
              </div>
              <div className="team-performance-page__details-cell">
                <span>Reviewer</span>
                <strong>{detailsRow.reviewer_employee_first_name
                  ? `${detailsRow.reviewer_employee_first_name} ${detailsRow.reviewer_employee_last_name}`
                  : detailsRow.reviewer_admin_name || "-"}</strong>
              </div>
              <div className="team-performance-page__details-cell">
                <span>{detailsRow.status === "Draft" ? "Last Updated" : "Submitted On"}</span>
                <strong>
                  {detailsRow.status === "Draft"
                    ? (detailsRow.updated_at ? formatDateShort(detailsRow.updated_at) : "-")
                    : (detailsRow.submitted_at ? formatDateShort(detailsRow.submitted_at) : "-")}
                </strong>
              </div>
            </div>

            <div className={`team-performance-page__rating-box team-performance-page__rating-box--r${detailsRow.rating}`}>
              <div className="team-performance-page__rating-box-value">{detailsRow.rating}/5</div>
              <div className="team-performance-page__rating-box-label">{detailsRow.rating_label}</div>
            </div>

            <div className="team-performance-page__comments-block">
              <span className="team-performance-page__comments-label">Comments</span>
              <p className="team-performance-page__comments-quote">
                {detailsRow.comments ? `"${detailsRow.comments}"` : "No comments provided"}
              </p>
            </div>
            <div className="team-performance-page__form-actions">
              <button type="button" className="team-performance-page__cancel" onClick={() => setDetailsRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={submitTarget !== null}
        title="Submit Performance Review"
        message={
          submitTarget ? (
            <>
              {`Once submitted, this review cannot be edited, and ${submitTarget.first_name} ${submitTarget.last_name} will be notified. Continue?`}
              {submitError && <span className="team-performance-page__dialog-error">{submitError}</span>}
            </>
          ) : (
            ""
          )
        }
        confirmLabel={isMutating ? "Submitting..." : "Submit Review"}
        onConfirm={handleConfirmSubmitReview}
        onCancel={() => {
          setSubmitTarget(null);
          setSubmitError("");
        }}
      />

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Draft Review"
        message={
          deleteTarget ? (
            <>
              {`Are you sure you want to delete this draft review for ${deleteTarget.first_name} ${deleteTarget.last_name} (${deleteTarget.cycle_name})? This cannot be undone.`}
              {deleteError && <span className="team-performance-page__dialog-error">{deleteError}</span>}
            </>
          ) : (
            ""
          )
        }
        confirmLabel={isMutating ? "Deleting..." : "Delete"}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError("");
        }}
      />
    </div>
  );
}

export default TeamPerformancePage;