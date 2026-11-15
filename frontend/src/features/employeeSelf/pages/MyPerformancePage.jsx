import "./MyPerformancePage.css";
import { useState, useEffect, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import {
  getMyPerformanceReviews,
  getReviewCycles,
} from "../../../services/api/employeeSelfApi.js";

const PAGE_SIZE = 5;
const STATUS_OPTIONS = ["Submitted"];

function formatDateShort(value) {
  if (!value) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function cyclePeriodLabel(review) {
  return `${formatDateShort(review.start_date)} - ${formatDateShort(review.end_date)}`;
}

function reviewerLabel(review) {
  if (review.reviewer_employee_first_name) {
    return `${review.reviewer_employee_first_name} ${review.reviewer_employee_last_name}`;
  }
  return review.reviewer_admin_name || "-";
}

function ratingColor(rating) {
  if (rating >= 4) return "#16A34A";
  if (rating === 3) return "#D97706";
  return "#DC2626";
}

function StatusBadge({ status }) {
  return (
    <span className={`my-performance-page__status-badge my-performance-page__status-badge--${status.toLowerCase()}`}>
      {status}
    </span>
  );
}

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function MyPerformancePage() {
  const [cycles, setCycles] = useState([]);

  const [filterCycle, setFilterCycle] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [detailsRow, setDetailsRow] = useState(null);

  const fetchReviews = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getMyPerformanceReviews({
        cycle_id: filterCycle || undefined,
        status: filterStatus || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load your performance reviews. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [filterCycle, filterStatus, page]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    setPage(1);
  }, [filterCycle, filterStatus]);

  useEffect(() => {
    getReviewCycles().then(setCycles).catch(() => setCycles([]));
  }, []);

  const handleReset = () => {
    setFilterCycle("");
    setFilterStatus("");
  };

  return (
    <div className="my-performance-page">
      <PageHeader title="My Performance" subtitle="View your performance reviews and track your growth over time" />

      <div className="my-performance-page__filter-bar">
        <select
          className="my-performance-page__select"
          value={filterCycle}
          onChange={(e) => setFilterCycle(e.target.value)}
        >
          <option value="">All Cycles</option>
          {cycles.map((c) => (
            <option key={c.cycle_id} value={c.cycle_id}>{c.cycle_name}</option>
          ))}
        </select>

        <select
          className="my-performance-page__select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <button type="button" className="my-performance-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      {loadError && <p className="my-performance-page__error">{loadError}</p>}

      {isLoading && <p className="my-performance-page__loading">Loading your performance reviews...</p>}

      {!isLoading && !loadError && records.length === 0 && (
        <p className="my-performance-page__empty">No performance reviews yet</p>
      )}

      {!isLoading && records.length > 0 && (
        <div className="my-performance-page__list">
          {records.map((review) => (
            <div className="my-performance-page__card" key={review.review_id}>
              <div className="my-performance-page__card-header">
                <div>
                  <p className="my-performance-page__cycle-name">{review.cycle_name}</p>
                  <p className="my-performance-page__cycle-period">{cyclePeriodLabel(review)}</p>
                </div>
                <StatusBadge status={review.status} />
              </div>

              <div className="my-performance-page__card-body">
                <div
                  className="my-performance-page__rating-ring"
                  style={{
                    "--ring-color": ratingColor(review.rating),
                    "--ring-pct": `${(review.rating / 5) * 100}%`,
                  }}
                >
                  <span className="my-performance-page__rating-value">{review.rating}/5</span>
                </div>
                <div className="my-performance-page__card-text">
                  {review.comments && <p className="my-performance-page__comments">"{review.comments}"</p>}
                  <p className="my-performance-page__rating-label">{review.rating_label}</p>
                </div>
                <button
                  type="button"
                  className="my-performance-page__details-button"
                  onClick={() => setDetailsRow(review)}
                >
                  View Details
                </button>
              </div>

              {review.submitted_at && (
                <p className="my-performance-page__meta">Submitted on {formatDateShort(review.submitted_at)}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      <Modal isOpen={detailsRow !== null} onClose={() => setDetailsRow(null)} title="Performance Review Details">
        {detailsRow && (
          <div className="my-performance-page__details">
            <div className="my-performance-page__details-header">
              <span className="my-performance-page__details-avatar">
                {getInitials(detailsRow.first_name, detailsRow.last_name)}
              </span>
              <div className="my-performance-page__details-identity">
                <strong>{detailsRow.first_name} {detailsRow.last_name}</strong>
                <span>{detailsRow.employee_code}</span>
              </div>
              <StatusBadge status={detailsRow.status} />
            </div>

            <div className="my-performance-page__details-grid">
              <div className="my-performance-page__details-cell">
                <span>Review Cycle</span>
                <strong>{detailsRow.cycle_name}</strong>
              </div>
              <div className="my-performance-page__details-cell">
                <span>Review Period</span>
                <strong>{cyclePeriodLabel(detailsRow)}</strong>
              </div>
              <div className="my-performance-page__details-cell">
                <span>Reviewer</span>
                <strong>{reviewerLabel(detailsRow)}</strong>
              </div>
              <div className="my-performance-page__details-cell">
                <span>Submitted On</span>
                <strong>{detailsRow.submitted_at ? formatDateShort(detailsRow.submitted_at) : "-"}</strong>
              </div>
            </div>

            <div className={`my-performance-page__rating-box my-performance-page__rating-box--r${detailsRow.rating}`}>
              <div className="my-performance-page__rating-box-value">{detailsRow.rating}/5</div>
              <div className="my-performance-page__rating-box-label">{detailsRow.rating_label}</div>
            </div>

            <div className="my-performance-page__comments-block">
              <span className="my-performance-page__comments-label">Comments</span>
              <p className="my-performance-page__comments-quote">
                {detailsRow.comments ? `"${detailsRow.comments}"` : "No comments provided"}
              </p>
            </div>

            <div className="my-performance-page__form-actions">
              <button type="button" className="my-performance-page__close-button" onClick={() => setDetailsRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default MyPerformancePage;