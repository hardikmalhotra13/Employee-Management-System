import "./EmployeeTraining.css";
import { useState, useEffect, useRef } from "react";
import { GraduationCap, Plus, Check, Eye, FileText, MoreHorizontal } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listTrainingPrograms,
  getEmployeeTrainingRecords,
  createEmployeeTrainingRecord,
  completeTrainingRecord,
} from "../../../services/api/trainingApi.js";
import { listEmployeeDocuments, viewEmployeeDocument } from "../../../services/api/documentApi.js";

const EXPIRY_LABEL_CLASS = {
  Valid: "employee-training__expiry-badge--valid",
  "Expiring Soon": "employee-training__expiry-badge--soon",
  Expired: "employee-training__expiry-badge--expired",
};

// Formats today's date as YYYY-MM-DD from local calendar fields.
// toISOString() converts to UTC first, which silently rolls the date back
// by one day in timezones ahead of UTC (e.g. IST).
function todayLocalDateString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assignedByLabel(record) {
  if (record.assigned_by_admin_name) return record.assigned_by_admin_name;
  if (record.assigned_by_employee_first_name) {
    return `${record.assigned_by_employee_first_name} ${record.assigned_by_employee_last_name} (Manager)`;
  }
  return "-";
}

// Overdue is display-only, derived from the existing status/due_date - it
// is never sent to or stored by the backend.
function isOverdue(record) {
  if (record.status !== "Assigned" || !record.due_date) return false;
  const today = todayLocalDateString();
  return record.due_date < today;
}

function RecordStatusBadge({ record }) {
  if (isOverdue(record)) {
    return <span className="employee-training__status-badge employee-training__status-badge--overdue">Overdue</span>;
  }
  return (
    <span
      className={
        record.status === "Completed"
          ? "employee-training__status-badge employee-training__status-badge--completed"
          : "employee-training__status-badge employee-training__status-badge--assigned"
      }
    >
      {record.status}
    </span>
  );
}

// Row-level "..." actions menu. View Details is always available. Mark
// Complete only ever applies to an Assigned (including Overdue, which is
// just a display state of Assigned) record - same condition as before,
// just presented as a dropdown for visual consistency with the rest of
// the app.
function TrainingRecordActionsMenu({ record, isOpen, onToggle, onClose, canManage, onView, onComplete }) {
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

  const canComplete = canManage && record.status === "Assigned";

  return (
    <div className="employee-training__menu" ref={menuRef}>
      <button
        type="button"
        className="employee-training__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="employee-training__menu-panel" role="menu">
          <button
            type="button"
            className="employee-training__menu-item"
            role="menuitem"
            onClick={() => {
              onView(record);
              onClose();
            }}
          >
            <Eye size={15} />
            View Details
          </button>
          {canComplete && (
            <button
              type="button"
              className="employee-training__menu-item"
              role="menuitem"
              onClick={() => {
                onComplete(record);
                onClose();
              }}
            >
              <Check size={15} />
              Mark Complete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmployeeTraining({ employeeId }) {
  const { admin } = useAuth();
  const canManage = hasPermission(admin, "training.manage");

  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [activePrograms, setActivePrograms] = useState([]);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignFormData, setAssignFormData] = useState({ program_id: "", due_date: "" });
  const [assignFormError, setAssignFormError] = useState("");
  const [programsError, setProgramsError] = useState("");

  const [completeTarget, setCompleteTarget] = useState(null);
  const [completeFormData, setCompleteFormData] = useState({ completion_date: "", document_id: "" });
  const [completeFormError, setCompleteFormError] = useState("");
  const [employeeDocuments, setEmployeeDocuments] = useState([]);

  const [viewingRecord, setViewingRecord] = useState(null);
  const [viewCertError, setViewCertError] = useState("");

  const fetchRecords = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getEmployeeTrainingRecords(employeeId);
      setRecords(result);
    } catch (err) {
      setLoadError("Failed to load training records. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [employeeId]);

  const openAssignModal = async () => {
    setAssignFormData({ program_id: "", due_date: "" });
    setAssignFormError("");
    setProgramsError("");

    try {
      const result = await listTrainingPrograms({ page: 1, pageSize: 100, includeArchived: false });
      setActivePrograms(result.records.filter((p) => p.status === "Active"));
    } catch (err) {
      setActivePrograms([]);
      setProgramsError("Failed to load training programs. Please close this and try again.");
    }

    setIsAssignModalOpen(true);
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();

    if (!assignFormData.program_id) {
      setAssignFormError("Please select a program");
      return;
    }

    if (assignFormData.due_date) {
      const today = todayLocalDateString();
      if (assignFormData.due_date < today) {
        setAssignFormError("Due date cannot be before the assignment date");
        return;
      }
    }

    try {
      await createEmployeeTrainingRecord(employeeId, {
        program_id: Number(assignFormData.program_id),
        due_date: assignFormData.due_date || null,
      });
      setIsAssignModalOpen(false);
      fetchRecords();
    } catch (err) {
      setAssignFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const openCompleteModal = async (record) => {
    setCompleteTarget(record);
    setCompleteFormData({ completion_date: "", document_id: "" });
    setCompleteFormError("");
    setEmployeeDocuments([]);

    if (record.program_type === "Certification") {
      try {
        const docs = await listEmployeeDocuments(employeeId);
        setEmployeeDocuments(docs);
      } catch (err) {
        setEmployeeDocuments([]);
      }
    }
  };

  const handleCompleteSubmit = async (e) => {
    e.preventDefault();

    if (!completeFormData.completion_date) {
      setCompleteFormError("Completion date is required");
      return;
    }

    const today = todayLocalDateString();
    if (completeFormData.completion_date < completeTarget.assigned_date || completeFormData.completion_date > today) {
      setCompleteFormError("Completion date must be between the assignment date and today");
      return;
    }

    try {
      await completeTrainingRecord(completeTarget.record_id, {
        completion_date: completeFormData.completion_date,
        document_id: completeFormData.document_id ? Number(completeFormData.document_id) : null,
      });
      setCompleteTarget(null);
      fetchRecords();
    } catch (err) {
      setCompleteFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const openViewModal = (record) => {
    setViewCertError("");
    setViewingRecord(record);
  };

  const closeViewModal = () => {
    setViewingRecord(null);
    setViewCertError("");
  };

  const handleViewCertificate = async (record) => {
    setViewCertError("");

    try {
      await viewEmployeeDocument(record.document_id);
    } catch (err) {
      setViewCertError("Failed to open the certificate. Please try again.");
    }
  };

  const columns = [
    { key: "program_name", label: "Program" },
    { key: "program_type", label: "Type" },
    {
      key: "status",
      label: "Status",
      render: (row) => <RecordStatusBadge record={row} />,
    },
    {
      key: "expiry_label",
      label: "Expiry",
      render: (row) =>
        row.expiry_label ? (
          <span className={`employee-training__expiry-badge ${EXPIRY_LABEL_CLASS[row.expiry_label] || ""}`}>
            {row.expiry_label}
          </span>
        ) : (
          "-"
        ),
    },
    {
      key: "assigned_by",
      label: "Assigned By",
      render: (row) => assignedByLabel(row),
    },
    { key: "assigned_date", label: "Assigned" },
    {
      key: "due_date",
      label: "Due",
      render: (row) => row.due_date || "-",
    },
    {
      key: "completion_date",
      label: "Completed",
      render: (row) => row.completion_date || "-",
    },
    {
      key: "document_name",
      label: "Certificate",
      render: (row) => row.document_name || "-",
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <TrainingRecordActionsMenu
          record={row}
          isOpen={openMenuId === row.record_id}
          onToggle={() => setOpenMenuId(openMenuId === row.record_id ? null : row.record_id)}
          onClose={() => setOpenMenuId((current) => (current === row.record_id ? null : current))}
          canManage={canManage}
          onView={openViewModal}
          onComplete={openCompleteModal}
        />
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="employee-training">
        <p className="employee-training__loading">Loading training records...</p>
      </div>
    );
  }

  return (
    <div className="employee-training">
      <div className="employee-training__header">
        <div className="employee-training__heading">
          <span className="employee-training__icon">
            <GraduationCap size={16} />
          </span>
          <div>
            <p className="employee-training__title">Training & Certifications</p>
            <p className="employee-training__subtitle">Training and certification history for this employee</p>
          </div>
        </div>

        {canManage && (
          <button type="button" className="employee-training__add-button" onClick={openAssignModal}>
            <Plus size={16} />
            Assign Training
          </button>
        )}
      </div>

      {loadError && <p className="employee-training__error">{loadError}</p>}

      {!loadError && records.length === 0 && (
        <p className="employee-training__empty">No training or certification records yet for this employee</p>
      )}

      {records.length > 0 && (
        <div className="employee-training__table-wrap">
          <DataTable columns={columns} rows={records} emptyMessage="No training records found" />
        </div>
      )}

      <Modal
        isOpen={isAssignModalOpen}
        onClose={() => {
          setIsAssignModalOpen(false);
          setProgramsError("");
        }}
        title="Assign Training"
      >
        <form onSubmit={handleAssignSubmit}>
          <div className="employee-training__form-section-header">
            <span className="employee-training__form-section-icon">
              <GraduationCap size={16} />
            </span>
            <div>
              <p className="employee-training__form-section-title">Assign a training/certification</p>
              <p className="employee-training__form-section-subtitle">
                Choose an active program and an optional due date
              </p>
            </div>
          </div>

          {programsError && <p className="employee-training__error">{programsError}</p>}

          <FormInput
            label="Program"
            name="program_id"
            type="select"
            value={assignFormData.program_id}
            onChange={(value) => setAssignFormData({ ...assignFormData, program_id: value })}
            options={activePrograms.map((p) => ({ value: String(p.program_id), label: `${p.program_name} (${p.program_type})` }))}
            error={assignFormError}
            required
          />

          <FormInput
            label="Due Date (optional)"
            name="due_date"
            type="date"
            value={assignFormData.due_date}
            onChange={(value) => setAssignFormData({ ...assignFormData, due_date: value })}
          />

          <div className="employee-training__form-actions">
            <button type="button" className="employee-training__cancel" onClick={() => setIsAssignModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="employee-training__save">
              Assign
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={completeTarget !== null} onClose={() => setCompleteTarget(null)} title="Mark Training Complete">
        <form onSubmit={handleCompleteSubmit}>
          <div className="employee-training__form-section-header">
            <span className="employee-training__form-section-icon">
              <Check size={16} />
            </span>
            <div>
              <p className="employee-training__form-section-title">{completeTarget?.program_name}</p>
              <p className="employee-training__form-section-subtitle">Mark this assignment as complete</p>
            </div>
          </div>

          <FormInput
            label="Completion Date"
            name="completion_date"
            type="date"
            value={completeFormData.completion_date}
            onChange={(value) => setCompleteFormData({ ...completeFormData, completion_date: value })}
            error={completeFormError}
            required
          />

          {completeTarget?.program_type === "Certification" && (
            <FormInput
              label="Attach Certificate (optional)"
              name="document_id"
              type="select"
              value={completeFormData.document_id}
              onChange={(value) => setCompleteFormData({ ...completeFormData, document_id: value })}
              options={employeeDocuments.map((d) => ({ value: String(d.document_id), label: d.document_name }))}
            />
          )}

          <div className="employee-training__form-actions">
            <button type="button" className="employee-training__cancel" onClick={() => setCompleteTarget(null)}>
              Cancel
            </button>
            <button type="submit" className="employee-training__save">
              Mark Complete
            </button>
          </div>
        </form>
      </Modal>

      {/* View Training Details - fully read-only */}
      <Modal isOpen={viewingRecord !== null} onClose={closeViewModal} title="Training Details">
        {viewingRecord && (
          <div className="employee-training__view-details">
            <div className="employee-training__detail-grid">
              <div>
                <span className="employee-training__detail-label">Program</span>
                <p className="employee-training__detail-value">{viewingRecord.program_name}</p>
              </div>
              <div>
                <span className="employee-training__detail-label">Type</span>
                <p className="employee-training__detail-value">{viewingRecord.program_type}</p>
              </div>
              <div>
                <span className="employee-training__detail-label">Status</span>
                <p className="employee-training__detail-value">
                  <RecordStatusBadge record={viewingRecord} />
                </p>
              </div>
              <div>
                <span className="employee-training__detail-label">Assigned By</span>
                <p className="employee-training__detail-value">{assignedByLabel(viewingRecord)}</p>
              </div>
              <div>
                <span className="employee-training__detail-label">Assigned Date</span>
                <p className="employee-training__detail-value">{viewingRecord.assigned_date}</p>
              </div>
              <div>
                <span className="employee-training__detail-label">Due Date</span>
                <p className="employee-training__detail-value">{viewingRecord.due_date || "-"}</p>
              </div>
              <div>
                <span className="employee-training__detail-label">Completion Date</span>
                <p className="employee-training__detail-value">{viewingRecord.completion_date || "-"}</p>
              </div>
              <div>
                <span className="employee-training__detail-label">Expiry</span>
                <p className="employee-training__detail-value">
                  {viewingRecord.expiry_label ? (
                    <span
                      className={`employee-training__expiry-badge ${EXPIRY_LABEL_CLASS[viewingRecord.expiry_label] || ""}`}
                    >
                      {viewingRecord.expiry_label}
                    </span>
                  ) : (
                    "-"
                  )}
                </p>
              </div>
            </div>

            <div className="employee-training__certificate-field">
              <span className="employee-training__detail-label">Certificate</span>
              {viewingRecord.document_id ? (
                <div className="employee-training__certificate-row">
                  <span className="employee-training__detail-value">
                    <FileText size={14} /> {viewingRecord.document_name}
                  </span>
                  <button
                    type="button"
                    className="employee-training__view-certificate-button"
                    onClick={() => handleViewCertificate(viewingRecord)}
                  >
                    <Eye size={14} />
                    View Certificate
                  </button>
                </div>
              ) : (
                <p className="employee-training__detail-value">No certificate attached</p>
              )}
              {viewCertError && <p className="employee-training__error">{viewCertError}</p>}
            </div>

            <div className="employee-training__form-actions">
              <button type="button" className="employee-training__cancel" onClick={closeViewModal}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default EmployeeTraining;