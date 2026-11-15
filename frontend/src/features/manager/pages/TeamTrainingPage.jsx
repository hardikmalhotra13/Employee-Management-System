import "./TeamTrainingPage.css";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus, MoreHorizontal, Eye, CheckCircle2, RotateCcw,
  GraduationCap, Clock, AlertTriangle, FileText,
} from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import SearchBar from "../../../components/common/SearchBar.jsx";
import {
  getMyTeam,
  getManagerTrainingPrograms,
  getTeamTrainingRecords,
  createTeamTrainingRecord,
  completeTeamTrainingRecord,
  downloadTeamMemberDocument,
} from "../../../services/api/managerApi.js";

const PAGE_SIZE = 5;
const TYPE_OPTIONS = ["Training", "Certification"];
const STATUS_OPTIONS = ["Assigned", "Completed"];

const EXPIRY_LABEL_CLASS = {
  Valid: "team-training-page__expiry-badge--valid",
  "Expiring Soon": "team-training-page__expiry-badge--soon",
  Expired: "team-training-page__expiry-badge--expired",
};

// Overdue is never stored - it's derived here purely for display, same
// approach already used by the admin-side EmployeeTraining.jsx component:
// Assigned + a due date that has passed.
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

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
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
    return <span className="team-training-page__status-badge team-training-page__status-badge--overdue">Overdue</span>;
  }
  return (
    <span className={`team-training-page__status-badge team-training-page__status-badge--${record.status.toLowerCase()}`}>
      {record.status}
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
    <div className="team-training-page__menu" ref={ref}>
      <button type="button" className="team-training-page__menu-trigger" onClick={() => setIsOpen((v) => !v)} aria-label="More actions">
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="team-training-page__menu-dropdown">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="team-training-page__menu-item"
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

function TeamTrainingPage() {
  const [team, setTeam] = useState([]);
  const [programs, setPrograms] = useState([]);

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignFormData, setAssignFormData] = useState({ employee_id: "", program_id: "", due_date: "" });
  const [assignFormError, setAssignFormError] = useState("");
  const [isAssigning, setIsAssigning] = useState(false);

  const [completeTarget, setCompleteTarget] = useState(null);
  const [completionDate, setCompletionDate] = useState("");
  const [completeFormError, setCompleteFormError] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);

  const [detailsRow, setDetailsRow] = useState(null);
  const [certError, setCertError] = useState("");

  const fetchRecords = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getTeamTrainingRecords({
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
      setLoadError("Failed to load your team's training records. Please try again.");
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

  useEffect(() => {
    getMyTeam().then(setTeam).catch(() => setTeam([]));
  }, []);

  const handleReset = () => {
    setSearch("");
    setType("");
    setStatus("");
  };

  const openAssignModal = async () => {
    setAssignFormData({ employee_id: "", program_id: "", due_date: "" });
    setAssignFormError("");

    try {
      const activePrograms = await getManagerTrainingPrograms();
      setPrograms(activePrograms);
    } catch (err) {
      setPrograms([]);
    }

    setIsAssignModalOpen(true);
  };

  const selectedProgram = programs.find((p) => String(p.program_id) === assignFormData.program_id);

  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (isAssigning) return;

    if (!assignFormData.employee_id || !assignFormData.program_id) {
      setAssignFormError("Please select a team member and a program");
      return;
    }

    if (assignFormData.due_date) {
      const today = toDateStr(new Date());
      if (assignFormData.due_date < today) {
        setAssignFormError("Due date cannot be before the assignment date");
        return;
      }
    }

    setIsAssigning(true);
    try {
      await createTeamTrainingRecord(Number(assignFormData.employee_id), {
        program_id: Number(assignFormData.program_id),
        due_date: assignFormData.due_date || null,
      });
      setIsAssignModalOpen(false);
      fetchRecords();
    } catch (err) {
      setAssignFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsAssigning(false);
    }
  };

  const openCompleteModal = (record) => {
    setCompleteTarget(record);
    setCompletionDate("");
    setCompleteFormError("");
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
      setCompleteFormError("Completion date must be between the assignment date and today");
      return;
    }

    setIsCompleting(true);
    try {
      await completeTeamTrainingRecord(completeTarget.record_id, { completion_date: completionDate });
      setCompleteTarget(null);
      fetchRecords();
    } catch (err) {
      const data = err.response?.data;
      setCompleteFormError(data?.errors?.completion_date || data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsCompleting(false);
    }
  };

  const openDetailsModal = (record) => {
    setCertError("");
    setDetailsRow(record);
  };

  const handleViewCertificate = async (record) => {
    setCertError("");
    try {
      await downloadTeamMemberDocument(record.document_id, record.document_name);
    } catch (err) {
      setCertError("Failed to download the certificate. Please try again.");
    }
  };

  const columns = [
    {
      key: "employee",
      label: "Employee",
      render: (row) => (
        <div className="team-training-page__employee-cell">
          <span className="team-training-page__avatar">{getInitials(row.first_name, row.last_name)}</span>
          <div>
            <div>{row.first_name} {row.last_name}</div>
            <div className="team-training-page__employee-code">{row.employee_code}</div>
          </div>
        </div>
      ),
    },
    { key: "program_name", label: "Program", render: (row) => row.program_name },
    { key: "program_type", label: "Type", render: (row) => row.program_type },
    { key: "assigned_date", label: "Assigned Date", render: (row) => formatDateShort(row.assigned_date) },
    { key: "due_date", label: "Due Date", render: (row) => (row.due_date ? formatDateShort(row.due_date) : "-") },
    { key: "status", label: "Status", render: (row) => <RecordStatusBadge record={row} /> },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        const items = [{ label: "View Details", icon: Eye, onClick: () => openDetailsModal(row) }];
        if (row.status === "Assigned") {
          items.push({ label: "Mark Complete", icon: CheckCircle2, onClick: () => openCompleteModal(row) });
        }
        return <RowActionsMenu items={items} />;
      },
    },
  ];

  return (
    <div className="team-training-page">
      <PageHeader
        title="Team Training & Certifications"
        subtitle="Assign and track training and certifications for your direct reports"
        actions={
          <button type="button" className="team-training-page__add-button" onClick={openAssignModal}>
            <Plus size={16} />
            Assign Training
          </button>
        }
      />

      <div className="team-training-page__summary-grid">
        <div className="team-training-page__summary-card">
          <span className="team-training-page__summary-icon team-training-page__summary-icon--neutral">
            <GraduationCap size={16} />
          </span>
          <div>
            <p className="team-training-page__summary-number">{summary?.total ?? "-"}</p>
            <p className="team-training-page__summary-label">Total</p>
          </div>
        </div>
        <div className="team-training-page__summary-card">
          <span className="team-training-page__summary-icon team-training-page__summary-icon--assigned">
            <Clock size={16} />
          </span>
          <div>
            <p className="team-training-page__summary-number">{summary?.assigned ?? "-"}</p>
            <p className="team-training-page__summary-label">Assigned</p>
          </div>
        </div>
        <div className="team-training-page__summary-card">
          <span className="team-training-page__summary-icon team-training-page__summary-icon--completed">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <p className="team-training-page__summary-number">{summary?.completed ?? "-"}</p>
            <p className="team-training-page__summary-label">Completed</p>
          </div>
        </div>
        <div className="team-training-page__summary-card">
          <span className="team-training-page__summary-icon team-training-page__summary-icon--overdue">
            <AlertTriangle size={16} />
          </span>
          <div>
            <p className="team-training-page__summary-number">{summary?.overdue ?? "-"}</p>
            <p className="team-training-page__summary-label">Overdue</p>
          </div>
        </div>
      </div>

      <div className="team-training-page__filter-bar">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name, employee code, or program..." />
        <select className="team-training-page__select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All Types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className="team-training-page__select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" className="team-training-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="team-training-page__table-card">
        {loadError && <p className="team-training-page__error">{loadError}</p>}

        <DataTable columns={columns} rows={records} isLoading={isLoading} emptyMessage="No training records yet for your team" />

        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>

      <Modal isOpen={isAssignModalOpen} onClose={() => setIsAssignModalOpen(false)} title="Assign Training">
        <form onSubmit={handleAssignSubmit}>
          <FormInput
            label="Team Member"
            name="employee_id"
            type="select"
            value={assignFormData.employee_id}
            onChange={(value) => setAssignFormData({ ...assignFormData, employee_id: value })}
            options={team.map((t) => ({ value: String(t.employee_id), label: `${t.first_name} ${t.last_name}` }))}
            required
          />

          <FormInput
            label="Program"
            name="program_id"
            type="select"
            value={assignFormData.program_id}
            onChange={(value) => setAssignFormData({ ...assignFormData, program_id: value })}
            options={programs.map((p) => ({ value: String(p.program_id), label: `${p.program_name} (${p.program_type})` }))}
            required
          />

          {selectedProgram && (
            <div className="team-training-page__program-info">
              <div><span>Type</span><strong>{selectedProgram.program_type}</strong></div>
              <div>
                <span>Validity</span>
                <strong>{selectedProgram.validity_months ? `${selectedProgram.validity_months} months` : "Not applicable"}</strong>
              </div>
            </div>
          )}

          <FormInput
            label="Due Date (optional)"
            name="due_date"
            type="date"
            value={assignFormData.due_date}
            onChange={(value) => setAssignFormData({ ...assignFormData, due_date: value })}
          />

          {assignFormError && <p className="team-training-page__field-error">{assignFormError}</p>}

          <div className="team-training-page__form-actions">
            <button type="button" className="team-training-page__cancel" onClick={() => setIsAssignModalOpen(false)} disabled={isAssigning}>
              Cancel
            </button>
            <button type="submit" className="team-training-page__save" disabled={isAssigning}>
              {isAssigning ? "Assigning..." : "Assign"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={completeTarget !== null} onClose={() => setCompleteTarget(null)} title="Mark Training Complete">
        {completeTarget && (
          <form onSubmit={handleCompleteSubmit}>
            <p className="team-training-page__modal-copy">
              {completeTarget.first_name} {completeTarget.last_name} - {completeTarget.program_name}
            </p>
            <div className="team-training-page__field">
              <label htmlFor="completion_date" className="team-training-page__field-label">
                Completion Date<span className="team-training-page__required">*</span>
              </label>
              <input
                id="completion_date"
                name="completion_date"
                type="date"
                className="team-training-page__date-input"
                value={completionDate}
                min={completeTarget.assigned_date}
                max={toDateStr(new Date())}
                onChange={(e) => setCompletionDate(e.target.value)}
              />
            </div>

            {completeFormError && <p className="team-training-page__field-error">{completeFormError}</p>}

            <div className="team-training-page__form-actions">
              <button type="button" className="team-training-page__cancel" onClick={() => setCompleteTarget(null)} disabled={isCompleting}>
                Cancel
              </button>
              <button type="submit" className="team-training-page__save" disabled={isCompleting}>
                {isCompleting ? "Saving..." : "Mark Complete"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={detailsRow !== null} onClose={() => setDetailsRow(null)} title="Training Details">
        {detailsRow && (
          <div className="team-training-page__details">
            <div className="team-training-page__details-header">
              <span className="team-training-page__details-icon">
                <GraduationCap size={18} />
              </span>
              <div className="team-training-page__details-identity">
                <strong>{detailsRow.program_name}</strong>
                <span>{detailsRow.first_name} {detailsRow.last_name} ({detailsRow.employee_code})</span>
              </div>
              <RecordStatusBadge record={detailsRow} />
            </div>

            <div className="team-training-page__details-grid">
              <div className="team-training-page__details-cell">
                <span>Type</span>
                <strong>{detailsRow.program_type}</strong>
              </div>
              <div className="team-training-page__details-cell">
                <span>Assigned On</span>
                <strong>{formatDateShort(detailsRow.assigned_date)}</strong>
              </div>
              <div className="team-training-page__details-cell">
                <span>Due Date</span>
                <strong>{detailsRow.due_date ? formatDateShort(detailsRow.due_date) : "-"}</strong>
              </div>
              <div className="team-training-page__details-cell">
                <span>Completed On</span>
                <strong>{detailsRow.completion_date ? formatDateShort(detailsRow.completion_date) : "-"}</strong>
              </div>
              <div className="team-training-page__details-cell">
                <span>Assigned By</span>
                <strong>{assignedByLabel(detailsRow)}</strong>
              </div>
              {detailsRow.expiry_label && (
                <div className="team-training-page__details-cell">
                  <span>Expiry</span>
                  <strong>
                    {formatDateShort(detailsRow.expiry_date)} &middot;{" "}
                    <span className={EXPIRY_LABEL_CLASS[detailsRow.expiry_label]}>{detailsRow.expiry_label}</span>
                  </strong>
                </div>
              )}
            </div>

            {detailsRow.completion_comment && (
              <div className="team-training-page__comment-block">
                <span className="team-training-page__comment-label">Completion Comment</span>
                <p className="team-training-page__comment-quote">{detailsRow.completion_comment}</p>
              </div>
            )}

            <div className="team-training-page__certificate-row">
              <span className="team-training-page__details-cell-label">
                <FileText size={14} />
                Certificate
              </span>
              {detailsRow.document_id ? (
                <button type="button" className="team-training-page__cert-link" onClick={() => handleViewCertificate(detailsRow)}>
                  View Certificate
                </button>
              ) : (
                <span className="team-training-page__no-cert">No certificate uploaded</span>
              )}
            </div>
            {certError && <p className="team-training-page__field-error">{certError}</p>}

            <div className="team-training-page__form-actions">
              <button type="button" className="team-training-page__cancel" onClick={() => setDetailsRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default TeamTrainingPage;