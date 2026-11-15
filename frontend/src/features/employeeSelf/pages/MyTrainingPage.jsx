import "./MyTrainingPage.css";
import { useState, useEffect, useCallback } from "react";
import { RotateCcw, GraduationCap, Clock, CheckCircle2, AlertTriangle, Shield, FileText } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import SearchBar from "../../../components/common/SearchBar.jsx";
import {
  getMyTrainingRecords,
  uploadMyTrainingCertificate,
  completeMyTrainingRecord,
} from "../../../services/api/employeeSelfApi.js";
import { downloadMyDocument } from "../../../services/api/employeeDocumentApi.js";

const PAGE_SIZE = 5;
const TYPE_OPTIONS = ["Training", "Certification"];
const STATUS_OPTIONS = ["Assigned", "Completed"];
const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function getExtension(filename) {
  return filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
}

const EXPIRY_LABEL_CLASS = {
  Valid: "my-training-page__expiry-badge--valid",
  "Expiring Soon": "my-training-page__expiry-badge--soon",
  Expired: "my-training-page__expiry-badge--expired",
};

// Derived purely for display, same as the admin and Team Training
// equivalents - never stored, never sent to the backend.
function isOverdue(record) {
  if (record.status !== "Assigned" || !record.due_date) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${record.due_date}T00:00:00`) < today;
}

function toDateStr(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateShort(value) {
  if (!value) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function assignedByLabel(record) {
  if (record.assigned_by_employee_first_name) {
    return `${record.assigned_by_employee_first_name} ${record.assigned_by_employee_last_name} (Manager)`;
  }
  return record.assigned_by_admin_name ? `${record.assigned_by_admin_name} (Admin)` : "-";
}

function RecordStatusBadge({ record }) {
  if (isOverdue(record)) {
    return <span className="my-training-page__status-badge my-training-page__status-badge--overdue">Overdue</span>;
  }
  return (
    <span className={`my-training-page__status-badge my-training-page__status-badge--${record.status.toLowerCase()}`}>
      {record.status}
    </span>
  );
}

function MyTrainingPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [detailsRow, setDetailsRow] = useState(null);
  const [certError, setCertError] = useState("");
  const [isUploadingCert, setIsUploadingCert] = useState(false);

  const [completeTarget, setCompleteTarget] = useState(null);
  const [completionDate, setCompletionDate] = useState("");
  const [completeFile, setCompleteFile] = useState(null);
  const [completeComment, setCompleteComment] = useState("");
  const [completeFormError, setCompleteFormError] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getMyTrainingRecords({
        search: search || undefined,
        type: type || undefined,
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setRecords(result.records);
      setTotal(result.total);
      setSummary(result.summary);
    } catch (err) {
      setLoadError("Failed to load your training records. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [search, type, status, page]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    setPage(1);
  }, [search, type, status]);

  const handleReset = () => {
    setSearch("");
    setType("");
    setStatus("");
  };

  const openDetailsModal = (record) => {
    setCertError("");
    setDetailsRow(record);
  };

  const handleViewCertificate = async (record) => {
    setCertError("");
    try {
      await downloadMyDocument(record.document_id, record.document_name);
    } catch (err) {
      setCertError("Failed to download the certificate. Please try again.");
    }
  };

  const handleCertificateFileChange = async (e) => {
    const file = e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later if an upload fails
    if (!file) return;

    setCertError("");

    if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
      setCertError("Only PDF, JPG, JPEG, and PNG files are allowed");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setCertError("File size cannot be greater than 10 MB");
      return;
    }

    setIsUploadingCert(true);
    try {
      const updatedRecord = await uploadMyTrainingCertificate(detailsRow.record_id, file);
      setDetailsRow(updatedRecord);
      setRecords((prev) => prev.map((r) => (r.record_id === updatedRecord.record_id ? updatedRecord : r)));
    } catch (err) {
      setCertError(err.response?.data?.message || "Failed to upload the certificate. Please try again.");
    } finally {
      setIsUploadingCert(false);
    }
  };

  const openCompleteModal = (record) => {
    setCompleteTarget(record);
    setCompletionDate("");
    setCompleteFile(null);
    setCompleteComment("");
    setCompleteFormError("");
  };

  const handleCompleteFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
      setCompleteFormError("Only PDF, JPG, JPEG, and PNG files are allowed");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setCompleteFormError("File size cannot be greater than 10 MB");
      e.target.value = "";
      return;
    }

    setCompleteFormError("");
    setCompleteFile(file);
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();
    if (isCompleting) return;

    if (!completionDate) {
      setCompleteFormError("Completion date is required");
      return;
    }
    const today = toDateStr(new Date());
    if (completionDate < completeTarget.assigned_date || completionDate > today) {
      setCompleteFormError("Completion date must be between the assigned date and today");
      return;
    }
    if (completeTarget.program_type === "Certification" && !completeFile) {
      setCompleteFormError("A certificate is required to complete a Certification");
      return;
    }

    setIsCompleting(true);
    try {
      await completeMyTrainingRecord(completeTarget.record_id, completionDate, completeFile, completeComment.trim());
      setCompleteTarget(null);
      fetchRecords(); // refreshes both the list and the summary counts together
    } catch (err) {
      const data = err.response?.data;
      setCompleteFormError(
        data?.errors?.file || data?.errors?.completion_date || data?.errors?.completion_comment ||
        data?.message || "Something went wrong. Please try again."
      );
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <div className="my-training-page">
      <PageHeader title="My Training & Certifications" subtitle="Your training and certification history" />

      <div className="my-training-page__summary-grid">
        <div className="my-training-page__summary-card">
          <span className="my-training-page__summary-icon my-training-page__summary-icon--neutral">
            <GraduationCap size={16} />
          </span>
          <div>
            <p className="my-training-page__summary-number">{summary?.total ?? "-"}</p>
            <p className="my-training-page__summary-label">Total</p>
          </div>
        </div>
        <div className="my-training-page__summary-card">
          <span className="my-training-page__summary-icon my-training-page__summary-icon--assigned">
            <Clock size={16} />
          </span>
          <div>
            <p className="my-training-page__summary-number">{summary?.assigned ?? "-"}</p>
            <p className="my-training-page__summary-label">Assigned</p>
          </div>
        </div>
        <div className="my-training-page__summary-card">
          <span className="my-training-page__summary-icon my-training-page__summary-icon--overdue">
            <AlertTriangle size={16} />
          </span>
          <div>
            <p className="my-training-page__summary-number">{summary?.overdue ?? "-"}</p>
            <p className="my-training-page__summary-label">Overdue</p>
          </div>
        </div>
        <div className="my-training-page__summary-card">
          <span className="my-training-page__summary-icon my-training-page__summary-icon--completed">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <p className="my-training-page__summary-number">{summary?.completed ?? "-"}</p>
            <p className="my-training-page__summary-label">Completed</p>
          </div>
        </div>
      </div>

      <div className="my-training-page__filter-bar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by program name..." />
        <select className="my-training-page__select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All Types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="my-training-page__select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" className="my-training-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      {loadError && <p className="my-training-page__error">{loadError}</p>}

      {isLoading && <p className="my-training-page__loading">Loading your training records...</p>}

      {!isLoading && !loadError && records.length === 0 && (
        <p className="my-training-page__empty">No training records found</p>
      )}

      {!isLoading && records.length > 0 && (
        <div className="my-training-page__list">
          {records.map((record) => {
            const overdue = isOverdue(record);
            return (
              <div
                className={`my-training-page__card ${overdue ? "my-training-page__card--overdue" : ""}`}
                key={record.record_id}
              >
                <span className="my-training-page__card-icon">
                  {record.program_type === "Certification" ? <Shield size={18} /> : <GraduationCap size={18} />}
                </span>

                <div className="my-training-page__card-body">
                  <div className="my-training-page__card-top">
                    <p className="my-training-page__program-name">{record.program_name}</p>
                    <span className="my-training-page__type-badge">{record.program_type}</span>
                    <RecordStatusBadge record={record} />
                  </div>

                  <div className="my-training-page__card-dates">
                    <span>Assigned {formatDateShort(record.assigned_date)}</span>
                    {record.due_date && <span>Due {formatDateShort(record.due_date)}</span>}
                    {record.completion_date && <span>Completed {formatDateShort(record.completion_date)}</span>}
                    {record.document_id && (
                      <span className="my-training-page__cert-chip">
                        <FileText size={11} /> Certificate
                      </span>
                    )}
                  </div>
                </div>

                <div className="my-training-page__card-actions">
                  {record.status === "Assigned" && (
                    <button
                      type="button"
                      className="my-training-page__complete-button"
                      onClick={() => openCompleteModal(record)}
                    >
                      Mark Complete
                    </button>
                  )}
                  <button type="button" className="my-training-page__details-button" onClick={() => openDetailsModal(record)}>
                    View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      <Modal isOpen={detailsRow !== null} onClose={() => setDetailsRow(null)} title="Training Details">
        {detailsRow && (
          <div className="my-training-page__details">
            <div className="my-training-page__details-header">
              <span className="my-training-page__details-icon">
                {detailsRow.program_type === "Certification" ? <Shield size={18} /> : <GraduationCap size={18} />}
              </span>
              <div className="my-training-page__details-identity">
                <strong>{detailsRow.program_name}</strong>
                <span>{detailsRow.program_type}</span>
              </div>
              <RecordStatusBadge record={detailsRow} />
            </div>

            <div className="my-training-page__details-grid">
              <div className="my-training-page__details-cell">
                <span>Assigned On</span>
                <strong>{formatDateShort(detailsRow.assigned_date)}</strong>
              </div>
              <div className="my-training-page__details-cell">
                <span>Due Date</span>
                <strong>{detailsRow.due_date ? formatDateShort(detailsRow.due_date) : "-"}</strong>
              </div>
              <div className="my-training-page__details-cell">
                <span>Completed On</span>
                <strong>{detailsRow.completion_date ? formatDateShort(detailsRow.completion_date) : "-"}</strong>
              </div>
              <div className="my-training-page__details-cell">
                <span>Assigned By</span>
                <strong>{assignedByLabel(detailsRow)}</strong>
              </div>
              {detailsRow.expiry_label && (
                <div className="my-training-page__details-cell">
                  <span>Expiry</span>
                  <strong>
                    {formatDateShort(detailsRow.expiry_date)} &middot;{" "}
                    <span className={EXPIRY_LABEL_CLASS[detailsRow.expiry_label]}>{detailsRow.expiry_label}</span>
                  </strong>
                </div>
              )}
            </div>

            {detailsRow.completion_comment && (
              <div className="my-training-page__comment-block">
                <span className="my-training-page__comment-label">Completion Comment</span>
                <p className="my-training-page__comment-quote">{detailsRow.completion_comment}</p>
              </div>
            )}

            <div className="my-training-page__certificate-row">
              <span className="my-training-page__details-cell-label">
                <FileText size={14} />
                Certificate
              </span>
              {detailsRow.document_id ? (
                <button type="button" className="my-training-page__cert-link" onClick={() => handleViewCertificate(detailsRow)}>
                  View Certificate
                </button>
              ) : detailsRow.program_type !== "Certification" ? (
                <span className="my-training-page__no-cert">Not applicable</span>
              ) : detailsRow.status !== "Completed" ? (
                <span className="my-training-page__no-cert">Available after completion</span>
              ) : (
                <label className="my-training-page__cert-upload">
                  {isUploadingCert ? "Uploading..." : "Upload Certificate"}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={handleCertificateFileChange}
                    disabled={isUploadingCert}
                    hidden
                  />
                </label>
              )}
            </div>
            {certError && <p className="my-training-page__field-error">{certError}</p>}

            <div className="my-training-page__form-actions">
              <button type="button" className="my-training-page__close-button" onClick={() => setDetailsRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={completeTarget !== null} onClose={() => setCompleteTarget(null)} title="Mark Training Complete">
        {completeTarget && (
          <form onSubmit={handleCompleteSubmit}>
            <p className="my-training-page__modal-copy">
              {completeTarget.program_name} ({completeTarget.program_type})
            </p>

            <div className="my-training-page__field">
              <label className="my-training-page__field-label">
                Completion Date<span className="my-training-page__required">*</span>
              </label>
              <input
                type="date"
                className="my-training-page__date-input"
                value={completionDate}
                min={completeTarget.assigned_date}
                max={toDateStr(new Date())}
                onChange={(e) => setCompletionDate(e.target.value)}
              />
            </div>

            {completeTarget.program_type === "Certification" && (
              <div className="my-training-page__field">
                <label className="my-training-page__field-label">
                  Certificate<span className="my-training-page__required">*</span>
                </label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleCompleteFileChange} />
                {completeFile && <p className="my-training-page__file-selected">Selected: {completeFile.name}</p>}
              </div>
            )}

            <div className="my-training-page__field">
              <label className="my-training-page__field-label">Comment (optional)</label>
              <textarea
                className="my-training-page__comment-input"
                rows={3}
                maxLength={500}
                placeholder="Add a note about your completion..."
                value={completeComment}
                onChange={(e) => setCompleteComment(e.target.value)}
              />
              <span className="my-training-page__char-count">{completeComment.length}/500</span>
            </div>

            {completeFormError && <p className="my-training-page__field-error">{completeFormError}</p>}

            <div className="my-training-page__form-actions">
              <button
                type="button"
                className="my-training-page__close-button"
                onClick={() => setCompleteTarget(null)}
                disabled={isCompleting}
              >
                Cancel
              </button>
              <button type="submit" className="my-training-page__complete-submit" disabled={isCompleting}>
                {isCompleting ? "Saving..." : "Mark Complete"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default MyTrainingPage;