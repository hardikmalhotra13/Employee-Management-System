import "./EmployeePerformance.css";
import { useState, useEffect, useRef } from "react";
import { Star, Plus, Pencil, Check, Eye, MoreHorizontal } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listReviewCycles,
  getEmployeePerformanceReviews,
  createEmployeePerformanceReview,
  updatePerformanceReview,
  submitPerformanceReview,
} from "../../../services/api/performanceApi.js";

function reviewerLabel(review) {
  if (review.reviewer_admin_name) return review.reviewer_admin_name;
  if (review.reviewer_employee_first_name) {
    return `${review.reviewer_employee_first_name} ${review.reviewer_employee_last_name} (Manager)`;
  }
  return "-";
}

function RatingStars({ rating }) {
  return (
    <span className="employee-performance__rating-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          className={
            n <= rating
              ? "employee-performance__rating-star employee-performance__rating-star--filled"
              : "employee-performance__rating-star"
          }
          fill={n <= rating ? "currentColor" : "none"}
        />
      ))}
      <span className="employee-performance__rating-value">{rating} / 5</span>
    </span>
  );
}

// Same 1-5 rating value as before, just a clickable star picker instead of
// a dropdown - purely a form-input style change.
function RatingPicker({ value, onChange }) {
  return (
    <div className="employee-performance__rating-picker">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="employee-performance__rating-picker-button"
          onClick={() => onChange(n)}
          aria-label={`Rate ${n} out of 5`}
        >
          <Star
            size={26}
            className={
              n <= value
                ? "employee-performance__rating-star employee-performance__rating-star--filled"
                : "employee-performance__rating-star"
            }
            fill={n <= value ? "currentColor" : "none"}
          />
        </button>
      ))}
      <span className="employee-performance__rating-picker-hint">Select a rating (1-5)</span>
    </div>
  );
}

function ReviewStatusBadge({ status }) {
  return (
    <span
      className={
        status === "Submitted"
          ? "employee-performance__status-badge employee-performance__status-badge--submitted"
          : "employee-performance__status-badge employee-performance__status-badge--draft"
      }
    >
      {status}
    </span>
  );
}

// Row-level "..." actions menu. Draft -> Edit/Submit/View. Submitted ->
// View only (submitted reviews are immutable).
function ReviewActionsMenu({ review, isOpen, onToggle, onClose, canManage, onEdit, onSubmit, onView }) {
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

  const isDraft = review.status === "Draft";

  return (
    <div className="employee-performance__menu" ref={menuRef}>
      <button
        type="button"
        className="employee-performance__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="employee-performance__menu-panel" role="menu">
          {canManage && isDraft && (
            <button
              type="button"
              className="employee-performance__menu-item"
              role="menuitem"
              onClick={() => {
                onEdit(review);
                onClose();
              }}
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
          {canManage && isDraft && (
            <button
              type="button"
              className="employee-performance__menu-item"
              role="menuitem"
              onClick={() => {
                onSubmit(review);
                onClose();
              }}
            >
              <Check size={15} />
              Submit
            </button>
          )}
          <button
            type="button"
            className="employee-performance__menu-item"
            role="menuitem"
            onClick={() => {
              onView(review);
              onClose();
            }}
          >
            <Eye size={15} />
            View
          </button>
        </div>
      )}
    </div>
  );
}

function EmployeePerformance({ employeeId }) {
  const { admin } = useAuth();
  const canManage = hasPermission(admin, "performance.manage");

  const [reviews, setReviews] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [activeCycles, setActiveCycles] = useState([]);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | "view" | null
  const [editingReview, setEditingReview] = useState(null);
  const [viewingReview, setViewingReview] = useState(null);
  const [formData, setFormData] = useState({ cycle_id: "", rating: "3", comments: "" });
  const [formError, setFormError] = useState("");
  const [cyclesError, setCyclesError] = useState("");

  const [submitTarget, setSubmitTarget] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitIntentRef = useRef("draft");

  const fetchReviews = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getEmployeePerformanceReviews(employeeId);
      setReviews(result);
    } catch (err) {
      setLoadError("Failed to load performance reviews. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [employeeId]);

  const openCreateModal = async () => {
    setFormData({ cycle_id: "", rating: "3", comments: "" });
    setFormError("");
    setCyclesError("");
    setEditingReview(null);
    submitIntentRef.current = "draft";

    try {
      const result = await listReviewCycles({ page: 1, pageSize: 100, includeArchived: false });
      setActiveCycles(result.records.filter((c) => c.status === "Active"));
    } catch (err) {
      setActiveCycles([]);
      setCyclesError("Failed to load review cycles. Please close this and try again.");
    }

    setModalMode("create");
  };

  const openEditModal = (review) => {
    setFormData({
      cycle_id: String(review.cycle_id),
      rating: String(review.rating),
      comments: review.comments || "",
    });
    setFormError("");
    setEditingReview(review);
    submitIntentRef.current = "draft";
    setModalMode("edit");
  };

  const openViewModal = (review) => {
    setViewingReview(review);
    setModalMode("view");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingReview(null);
    setViewingReview(null);
    setFormError("");
    setCyclesError("");
    submitIntentRef.current = "draft";
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    const intent = submitIntentRef.current;

    if (modalMode === "create" && !formData.cycle_id) {
      setFormError("Please select a review cycle");
      return;
    }

    try {
      let reviewId = editingReview?.review_id;

      if (modalMode === "create") {
        const created = await createEmployeePerformanceReview(employeeId, {
          cycle_id: Number(formData.cycle_id),
          rating: Number(formData.rating),
          comments: formData.comments,
        });
        reviewId = created.review_id;
      } else {
        await updatePerformanceReview(editingReview.review_id, {
          rating: Number(formData.rating),
          comments: formData.comments,
        });
      }

      if (intent === "submit") {
        try {
          await submitPerformanceReview(reviewId);
        } catch (submitErr) {
          // The draft itself was saved successfully - only the submit step
          // failed, so close and refresh rather than losing the save, and
          // let the row's own Submit action be used to retry.
          closeModal();
          fetchReviews();
          setActionError(
            submitErr.response?.data?.message || "Saved as draft, but submitting failed. Please try submitting it from the list."
          );
          return;
        }
      }

      closeModal();
      fetchReviews();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmSubmitReview = async () => {
    setIsSubmitting(true);
    setActionError("");

    try {
      await submitPerformanceReview(submitTarget.review_id);
      setSubmitTarget(null);
      fetchReviews();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to submit review. Please try again.");
      setSubmitTarget(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns = [
    { key: "cycle_name", label: "Review Cycle" },
    {
      key: "rating",
      label: "Rating",
      render: (row) => <RatingStars rating={row.rating} />,
    },
    {
      key: "reviewer",
      label: "Reviewer",
      render: (row) => reviewerLabel(row),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <ReviewStatusBadge status={row.status} />,
    },
    {
      key: "submitted_at",
      label: "Submitted On",
      render: (row) => (row.submitted_at ? row.submitted_at.slice(0, 10) : "-"),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <ReviewActionsMenu
          review={row}
          isOpen={openMenuId === row.review_id}
          onToggle={() => setOpenMenuId(openMenuId === row.review_id ? null : row.review_id)}
          onClose={() => setOpenMenuId((current) => (current === row.review_id ? null : current))}
          canManage={canManage}
          onEdit={openEditModal}
          onSubmit={(review) => setSubmitTarget(review)}
          onView={openViewModal}
        />
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="employee-performance">
        <p className="employee-performance__loading">Loading performance reviews...</p>
      </div>
    );
  }

  return (
    <div className="employee-performance">
      <div className="employee-performance__header">
        <div className="employee-performance__heading">
          <span className="employee-performance__icon">
            <Star size={16} />
          </span>
          <div>
            <p className="employee-performance__title">Performance Reviews</p>
            <p className="employee-performance__subtitle">Review history and performance assessment for this employee</p>
          </div>
        </div>

        {canManage && (
          <button type="button" className="employee-performance__add-button" onClick={openCreateModal}>
            <Plus size={16} />
            Add Review
          </button>
        )}
      </div>

      {loadError && <p className="employee-performance__error">{loadError}</p>}
      {actionError && <p className="employee-performance__error">{actionError}</p>}

      {!loadError && reviews.length === 0 && (
        <p className="employee-performance__empty">No performance reviews yet for this employee</p>
      )}

      {reviews.length > 0 && (
        <div className="employee-performance__table-wrap">
          <DataTable columns={columns} rows={reviews} emptyMessage="No performance reviews found" />
        </div>
      )}

      <Modal
        isOpen={modalMode === "create" || modalMode === "edit"}
        onClose={closeModal}
        title={modalMode === "create" ? "Create Performance Review" : "Edit Performance Review"}
      >
        <form onSubmit={handleFormSubmit}>
          <div className="employee-performance__form-section-header">
            <span className="employee-performance__form-section-icon">
              <Star size={16} />
            </span>
            <div>
              <p className="employee-performance__form-section-title">
                {modalMode === "create" ? "New review" : "Edit draft review"}
              </p>
              <p className="employee-performance__form-section-subtitle">
                Simple, focused form with a 1-5 rating and comments
              </p>
            </div>
          </div>

          {modalMode === "create" && cyclesError && (
            <p className="employee-performance__error">{cyclesError}</p>
          )}

          {modalMode === "create" && (
            <FormInput
              label="Review Cycle"
              name="cycle_id"
              type="select"
              value={formData.cycle_id}
              onChange={(value) => setFormData({ ...formData, cycle_id: value })}
              options={activeCycles.map((c) => ({ value: String(c.cycle_id), label: c.cycle_name }))}
              error={formError}
              required
            />
          )}

          {modalMode === "edit" && formError && (
            <p className="employee-performance__error">{formError}</p>
          )}

          <div className="employee-performance__rating-field">
            <label className="employee-performance__textarea-label">Overall Rating</label>
            <RatingPicker value={Number(formData.rating)} onChange={(n) => setFormData({ ...formData, rating: String(n) })} />
          </div>

          <div className="employee-performance__textarea-field">
            <label className="employee-performance__textarea-label" htmlFor="performance-comments">
              Performance Comments
            </label>
            <textarea
              id="performance-comments"
              className="employee-performance__textarea"
              rows={4}
              maxLength={500}
              placeholder="Add your assessment of the employee's performance..."
              value={formData.comments}
              onChange={(e) => setFormData({ ...formData, comments: e.target.value })}
            />
          </div>

          <div className="employee-performance__form-actions">
            <button type="button" className="employee-performance__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button
              type="submit"
              className="employee-performance__save"
              onClick={() => {
                submitIntentRef.current = "draft";
              }}
            >
              {modalMode === "create" ? "Save Draft" : "Save Changes"}
            </button>
            <button
              type="submit"
              className="employee-performance__submit-review"
              onClick={() => {
                submitIntentRef.current = "submit";
              }}
            >
              Submit Review
            </button>
          </div>
        </form>
      </Modal>

      {/* Review View - fully read-only */}
      <Modal isOpen={modalMode === "view"} onClose={closeModal} title="Performance Review">
        {viewingReview && (
          <div className="employee-performance__view-details">
            <div className="employee-performance__detail-grid">
              <div>
                <span className="employee-performance__detail-label">Employee</span>
                <p className="employee-performance__detail-value">
                  {viewingReview.first_name} {viewingReview.last_name} ({viewingReview.employee_code})
                </p>
              </div>
              <div>
                <span className="employee-performance__detail-label">Review Cycle</span>
                <p className="employee-performance__detail-value">{viewingReview.cycle_name}</p>
              </div>
              <div>
                <span className="employee-performance__detail-label">Reviewer</span>
                <p className="employee-performance__detail-value">{reviewerLabel(viewingReview)}</p>
              </div>
              <div>
                <span className="employee-performance__detail-label">Status</span>
                <p className="employee-performance__detail-value">
                  <ReviewStatusBadge status={viewingReview.status} />
                </p>
              </div>
              <div>
                <span className="employee-performance__detail-label">Submitted On</span>
                <p className="employee-performance__detail-value">
                  {viewingReview.submitted_at ? viewingReview.submitted_at.slice(0, 10) : "-"}
                </p>
              </div>
            </div>

            <div className="employee-performance__view-rating">
              <span className="employee-performance__detail-label">Overall Rating</span>
              <RatingStars rating={viewingReview.rating} />
            </div>

            <div className="employee-performance__reason-field">
              <span className="employee-performance__detail-label">Performance Comments</span>
              <p className="employee-performance__employee-reason">{viewingReview.comments || "-"}</p>
            </div>

            {viewingReview.status === "Submitted" && (
              <p className="employee-performance__readonly-note">
                This review has been submitted and cannot be edited.
              </p>
            )}

            <div className="employee-performance__form-actions">
              <button type="button" className="employee-performance__cancel" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={submitTarget !== null}
        title="Submit Performance Review"
        message="Once submitted, this review cannot be edited, and the employee will be notified. Continue?"
        confirmLabel={isSubmitting ? "Submitting..." : "Submit Review"}
        onConfirm={handleConfirmSubmitReview}
        onCancel={() => setSubmitTarget(null)}
      />
    </div>
  );
}

export default EmployeePerformance;