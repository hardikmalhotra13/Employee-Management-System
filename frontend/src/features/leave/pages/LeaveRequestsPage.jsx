import "./LeaveRequestsPage.css";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  Settings,
  MoreHorizontal,
  Check,
  X,
  Eye,
  RefreshCw,
  ClipboardList,
  Hourglass,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  getLeaveQuotas,
  updateLeaveQuotas,
} from "../../../services/api/leaveApi.js";
import { listDepartments } from "../../../services/api/departmentApi.js";
import { listEmployees } from "../../../services/api/employeeApi.js";

const LEAVE_TYPE_OPTIONS = [
  { value: "CL", label: "CL" },
  { value: "EL", label: "EL" },
];

const STATUS_OPTIONS = [
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Rejected", label: "Rejected" },
  { value: "Cancelled", label: "Cancelled" },
];

function LeaveStatusBadge({ status }) {
  const variant = {
    Pending: "pending",
    Approved: "approved",
    Rejected: "rejected",
    Cancelled: "cancelled",
  }[status] || "pending";

  return <span className={`leave-status-badge leave-status-badge--${variant}`}>{status}</span>;
}

// Row-level "..." menu. Pending -> Approve/Reject/View Details. Approved or
// Rejected -> Change Decision/View Details (the reversal target is implied
// by the current status, so there's nothing to pick). Cancelled -> View
// Details only.
function LeaveActionsMenu({
  leaveRequest,
  isOpen,
  onToggle,
  onClose,
  canApprove,
  onApprove,
  onReject,
  onChangeDecision,
  onViewDetails,
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

  return (
    <div className="leave-requests-page__menu" ref={menuRef}>
      <button
        type="button"
        className="leave-requests-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="leave-requests-page__menu-panel" role="menu">
          {leaveRequest.status === "Pending" && canApprove && (
            <>
              <button
                type="button"
                className="leave-requests-page__menu-item"
                role="menuitem"
                onClick={() => {
                  onApprove(leaveRequest);
                  onClose();
                }}
              >
                <Check size={15} />
                Approve
              </button>
              <button
                type="button"
                className="leave-requests-page__menu-item leave-requests-page__menu-item--danger"
                role="menuitem"
                onClick={() => {
                  onReject(leaveRequest);
                  onClose();
                }}
              >
                <X size={15} />
                Reject
              </button>
            </>
          )}

          {(leaveRequest.status === "Approved" || leaveRequest.status === "Rejected") && canApprove && (
            <button
              type="button"
              className="leave-requests-page__menu-item"
              role="menuitem"
              onClick={() => {
                onChangeDecision(leaveRequest);
                onClose();
              }}
            >
              <RefreshCw size={15} />
              Change Decision
            </button>
          )}

          <button
            type="button"
            className="leave-requests-page__menu-item"
            role="menuitem"
            onClick={() => {
              onViewDetails(leaveRequest);
              onClose();
            }}
          >
            <Eye size={15} />
            View Details
          </button>
        </div>
      )}
    </div>
  );
}

function LeaveRequestsPage() {
  const { admin } = useAuth();
  const canUpdate = hasPermission(admin, "leave.update"); // still gates Manage Quotas
  const canApprove = hasPermission(admin, "leave.approve");

  const [departmentFilter, setDepartmentFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [leaveTypeFilter, setLeaveTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [openMenuId, setOpenMenuId] = useState(null);

  // "approve" | "reject" | "change" | "view" | null
  const [actionMode, setActionMode] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isQuotaModalOpen, setIsQuotaModalOpen] = useState(false);
  const [quotaFormData, setQuotaFormData] = useState({ CL: "", EL: "" });
  const [quotaError, setQuotaError] = useState("");

  const fetchRequests = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listLeaveRequests({
        department_id: departmentFilter || undefined,
        employee_id: employeeFilter || undefined,
        leave_type: leaveTypeFilter || undefined,
        status: statusFilter || undefined,
      });
      setRequests(result);
    } catch (err) {
      setLoadError("Failed to load leave requests. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [departmentFilter, employeeFilter, leaveTypeFilter, statusFilter]);

  useEffect(() => {
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setDepartments(result.records));
    listEmployees({ page: 1, pageSize: 100 }).then((result) => setEmployees(result.records));
  }, []);

  // Purely derived from the already-fetched requests - no new API calls.
  const summary = useMemo(() => {
    const countOf = (status) => requests.filter((r) => r.status === status).length;
    return {
      total: requests.length,
      pending: countOf("Pending"),
      approved: countOf("Approved"),
      rejected: countOf("Rejected"),
      cancelled: countOf("Cancelled"),
    };
  }, [requests]);

  const openApproveModal = (leaveRequest) => {
    setActionTarget(leaveRequest);
    setReason("");
    setFormError("");
    setActionMode("approve");
  };

  const openRejectModal = (leaveRequest) => {
    setActionTarget(leaveRequest);
    setReason("");
    setFormError("");
    setActionMode("reject");
  };

  const openChangeDecisionModal = (leaveRequest) => {
    setActionTarget(leaveRequest);
    setReason("");
    setFormError("");
    setActionMode("change");
  };

  const openViewDetailsModal = (leaveRequest) => {
    setActionTarget(leaveRequest);
    setActionMode("view");
  };

  const closeActionModal = () => {
    setActionMode(null);
    setActionTarget(null);
    setReason("");
    setFormError("");
  };

  // The target status for a Change Decision is fully determined by the
  // request's current status - Approved can only reverse to Rejected and
  // vice versa - so there's nothing for the admin to pick.
  const changeDecisionTarget =
    actionMode === "change" && actionTarget
      ? actionTarget.status === "Approved"
        ? "Rejected"
        : "Approved"
      : null;

  const handleReasonSubmit = async (e) => {
    e.preventDefault();

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setFormError("A reason is required");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    try {
      if (actionMode === "approve") {
        await approveLeaveRequest(actionTarget.leave_request_id, trimmedReason);
      } else if (actionMode === "reject") {
        await rejectLeaveRequest(actionTarget.leave_request_id, trimmedReason);
      } else if (actionMode === "change") {
        if (changeDecisionTarget === "Approved") {
          await approveLeaveRequest(actionTarget.leave_request_id, trimmedReason);
        } else {
          await rejectLeaveRequest(actionTarget.leave_request_id, trimmedReason);
        }
      }

      closeActionModal();
      fetchRequests();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openQuotaModal = async () => {
    setQuotaError("");
    setIsQuotaModalOpen(true);

    try {
      const quotas = await getLeaveQuotas();
      const next = { CL: "", EL: "" };
      quotas.forEach((q) => {
        next[q.leave_type] = String(q.annual_quota);
      });
      setQuotaFormData(next);
    } catch (err) {
      setQuotaError("Failed to load current quotas. Please try again.");
    }
  };

  const closeQuotaModal = () => {
    setIsQuotaModalOpen(false);
  };

  const handleQuotaSubmit = async (e) => {
    e.preventDefault();

    if (!quotaFormData.CL || !quotaFormData.EL) {
      setQuotaError("Both CL and EL quotas are required");
      return;
    }

    try {
      await updateLeaveQuotas({ CL: quotaFormData.CL, EL: quotaFormData.EL });
      closeQuotaModal();
    } catch (err) {
      setQuotaError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const columns = [
    {
      key: "employee",
      label: "Employee",
      render: (row) => (
        <div className="leave-requests-page__employee-cell">
          <span className="leave-requests-page__employee-name">
            {row.first_name} {row.last_name}
          </span>
          <span className="leave-requests-page__employee-code">{row.employee_code}</span>
        </div>
      ),
    },
    { key: "department_name", label: "Department" },
    { key: "leave_type", label: "Type" },
    { key: "start_date", label: "Start Date" },
    { key: "end_date", label: "End Date" },
    {
      key: "is_half_day",
      label: "Half Day",
      render: (row) => (row.is_half_day ? "Yes" : "No"),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <LeaveStatusBadge status={row.status} />,
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <LeaveActionsMenu
          leaveRequest={row}
          isOpen={openMenuId === row.leave_request_id}
          onToggle={() => setOpenMenuId(openMenuId === row.leave_request_id ? null : row.leave_request_id)}
          onClose={() => setOpenMenuId((current) => (current === row.leave_request_id ? null : current))}
          canApprove={canApprove}
          onApprove={openApproveModal}
          onReject={openRejectModal}
          onChangeDecision={openChangeDecisionModal}
          onViewDetails={openViewDetailsModal}
        />
      ),
    },
  ];

  return (
    <div className="leave-requests-page">
      <PageHeader
        title="Leave Requests"
        subtitle="View and manage leave requests across the organization"
        actions={
          canUpdate && (
            <button type="button" className="leave-requests-page__quota-button" onClick={openQuotaModal}>
              <Settings size={16} />
              Manage Quotas
            </button>
          )
        }
      />

      <div className="leave-requests-page__summary">
        <div className="leave-requests-page__summary-card">
          <span className="leave-requests-page__summary-icon leave-requests-page__summary-icon--total">
            <ClipboardList size={16} />
          </span>
          <div>
            <p className="leave-requests-page__summary-value">{summary.total}</p>
            <p className="leave-requests-page__summary-label">Total Requests</p>
          </div>
        </div>

        <div className="leave-requests-page__summary-card">
          <span className="leave-requests-page__summary-icon leave-requests-page__summary-icon--pending">
            <Hourglass size={16} />
          </span>
          <div>
            <p className="leave-requests-page__summary-value">{summary.pending}</p>
            <p className="leave-requests-page__summary-label">Pending</p>
          </div>
        </div>

        <div className="leave-requests-page__summary-card">
          <span className="leave-requests-page__summary-icon leave-requests-page__summary-icon--approved">
            <CheckCircle2 size={16} />
          </span>
          <div>
            <p className="leave-requests-page__summary-value">{summary.approved}</p>
            <p className="leave-requests-page__summary-label">Approved</p>
          </div>
        </div>

        <div className="leave-requests-page__summary-card">
          <span className="leave-requests-page__summary-icon leave-requests-page__summary-icon--rejected">
            <XCircle size={16} />
          </span>
          <div>
            <p className="leave-requests-page__summary-value">{summary.rejected}</p>
            <p className="leave-requests-page__summary-label">Rejected</p>
          </div>
        </div>

        <div className="leave-requests-page__summary-card">
          <span className="leave-requests-page__summary-icon leave-requests-page__summary-icon--cancelled">
            <Ban size={16} />
          </span>
          <div>
            <p className="leave-requests-page__summary-value">{summary.cancelled}</p>
            <p className="leave-requests-page__summary-label">Cancelled</p>
          </div>
        </div>
      </div>

      <div className="leave-requests-page__filters">
        <div className="leave-requests-page__filter-select">
          <label className="leave-requests-page__filter-label">Department</label>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="leave-requests-page__select"
          >
            <option value="">All departments</option>
            {departments.map((dept) => (
              <option key={dept.department_id} value={dept.department_id}>
                {dept.department_name}
              </option>
            ))}
          </select>
        </div>
        <div className="leave-requests-page__filter-select">
          <label className="leave-requests-page__filter-label">Employee</label>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="leave-requests-page__select"
          >
            <option value="">All employees</option>
            {employees.map((emp) => (
              <option key={emp.employee_id} value={emp.employee_id}>
                {emp.first_name} {emp.last_name}
              </option>
            ))}
          </select>
        </div>
        <div className="leave-requests-page__filter-select">
          <label className="leave-requests-page__filter-label">Leave Type</label>
          <select
            value={leaveTypeFilter}
            onChange={(e) => setLeaveTypeFilter(e.target.value)}
            className="leave-requests-page__select"
          >
            <option value="">All types</option>
            {LEAVE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="leave-requests-page__filter-select">
          <label className="leave-requests-page__filter-label">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="leave-requests-page__select"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError && <p className="leave-requests-page__error">{loadError}</p>}

      <div className="leave-requests-page__table-card">
        <DataTable
          columns={columns}
          rows={requests}
          isLoading={isLoading}
          emptyMessage="No leave requests found"
        />
      </div>

      {/* Approve / Reject / Change Decision share one reason-driven modal shape */}
      <Modal
        isOpen={actionMode === "approve" || actionMode === "reject" || actionMode === "change"}
        onClose={closeActionModal}
        title={
          actionMode === "approve"
            ? "Approve Leave Request"
            : actionMode === "reject"
            ? "Reject Leave Request"
            : `Change Decision${changeDecisionTarget ? ` to ${changeDecisionTarget}` : ""}`
        }
      >
        {actionTarget && (
          <form onSubmit={handleReasonSubmit}>
            <div
              className={`leave-requests-page__action-banner leave-requests-page__action-banner--${
                actionMode === "reject" || changeDecisionTarget === "Rejected" ? "reject" : "approve"
              }`}
            >
              {actionMode === "approve" && "You are approving this leave request."}
              {actionMode === "reject" && "You are rejecting this leave request."}
              {actionMode === "change" &&
                `This request is currently ${actionTarget.status}. Changing the decision will set it to ${changeDecisionTarget}.`}
            </div>

            <div className="leave-requests-page__detail-grid">
              <div>
                <span className="leave-requests-page__detail-label">Employee</span>
                <p className="leave-requests-page__detail-value">
                  {actionTarget.first_name} {actionTarget.last_name} ({actionTarget.employee_code})
                </p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Leave Type</span>
                <p className="leave-requests-page__detail-value">{actionTarget.leave_type}</p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Dates</span>
                <p className="leave-requests-page__detail-value">
                  {actionTarget.start_date} to {actionTarget.end_date}
                  {actionTarget.is_half_day ? " (Half Day)" : ""}
                </p>
              </div>
            </div>

            <div className="leave-requests-page__reason-field">
              <label className="leave-requests-page__reason-label">Employee's Reason</label>
              <p className="leave-requests-page__employee-reason">{actionTarget.reason || "-"}</p>
            </div>

            <div className="leave-requests-page__reason-field">
              <label className="leave-requests-page__reason-label" htmlFor="action-reason">
                {actionMode === "approve"
                  ? "Approval Reason"
                  : actionMode === "reject"
                  ? "Rejection Reason"
                  : "Reason for changing this decision"}
                <span className="leave-requests-page__required">*</span>
              </label>
              <textarea
                id="action-reason"
                className="leave-requests-page__reason-input"
                rows={3}
                placeholder={
                  actionMode === "approve"
                    ? "e.g., leave approved based on available quota, no operational conflict"
                    : actionMode === "reject"
                    ? "e.g., operational requirements, insufficient quota"
                    : "Why is this decision being changed?"
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            {formError && <p className="leave-requests-page__form-error">{formError}</p>}

            <div className="leave-requests-page__form-actions">
              <button type="button" className="leave-requests-page__cancel" onClick={closeActionModal}>
                Cancel
              </button>
              <button
                type="submit"
                className={
                  actionMode === "reject" || changeDecisionTarget === "Rejected"
                    ? "leave-requests-page__submit leave-requests-page__submit--danger"
                    : "leave-requests-page__submit"
                }
                disabled={isSubmitting}
              >
                {actionMode === "approve" && "Approve Leave"}
                {actionMode === "reject" && "Reject Leave"}
                {actionMode === "change" && `Confirm: Set to ${changeDecisionTarget}`}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* View Details - fully read-only */}
      <Modal isOpen={actionMode === "view"} onClose={closeActionModal} title="Leave Request Details">
        {actionTarget && (
          <div className="leave-requests-page__view-details">
            <div className="leave-requests-page__detail-grid">
              <div>
                <span className="leave-requests-page__detail-label">Employee</span>
                <p className="leave-requests-page__detail-value">
                  {actionTarget.first_name} {actionTarget.last_name} ({actionTarget.employee_code})
                </p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Department</span>
                <p className="leave-requests-page__detail-value">{actionTarget.department_name}</p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Leave Type</span>
                <p className="leave-requests-page__detail-value">{actionTarget.leave_type}</p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Status</span>
                <p className="leave-requests-page__detail-value">
                  <LeaveStatusBadge status={actionTarget.status} />
                </p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Start Date</span>
                <p className="leave-requests-page__detail-value">{actionTarget.start_date}</p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">End Date</span>
                <p className="leave-requests-page__detail-value">{actionTarget.end_date}</p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Half Day</span>
                <p className="leave-requests-page__detail-value">{actionTarget.is_half_day ? "Yes" : "No"}</p>
              </div>
              <div>
                <span className="leave-requests-page__detail-label">Submitted On</span>
                <p className="leave-requests-page__detail-value">{actionTarget.created_at || "-"}</p>
              </div>
            </div>

            <div className="leave-requests-page__reason-field">
              <label className="leave-requests-page__reason-label">Employee's Reason</label>
              <p className="leave-requests-page__employee-reason">{actionTarget.reason || "-"}</p>
            </div>

            {(actionTarget.reviewer_admin_name ||
              actionTarget.reviewer_employee_first_name ||
              actionTarget.reviewed_at) && (
              <div className="leave-requests-page__reason-field">
                <label className="leave-requests-page__reason-label">Reviewed</label>
                <p className="leave-requests-page__employee-reason">
                  {actionTarget.reviewer_admin_name ||
                    (actionTarget.reviewer_employee_first_name
                      ? `${actionTarget.reviewer_employee_first_name} ${actionTarget.reviewer_employee_last_name}`
                      : "-")}
                  {actionTarget.reviewed_at ? ` on ${actionTarget.reviewed_at}` : ""}
                </p>
              </div>
            )}

            <div className="leave-requests-page__form-actions">
              <button type="button" className="leave-requests-page__cancel" onClick={closeActionModal}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={isQuotaModalOpen} onClose={closeQuotaModal} title="Manage Leave Quotas">
        <form onSubmit={handleQuotaSubmit}>
          <p className="leave-requests-page__quota-note">
            These are global annual quotas applied to every employee - not per-employee allowances.
          </p>

          <FormInput
            label="Casual Leave (CL) - annual quota"
            name="cl_quota"
            type="number"
            value={quotaFormData.CL}
            onChange={(value) => setQuotaFormData({ ...quotaFormData, CL: value })}
            required
          />

          <FormInput
            label="Earned Leave (EL) - annual quota"
            name="el_quota"
            type="number"
            value={quotaFormData.EL}
            onChange={(value) => setQuotaFormData({ ...quotaFormData, EL: value })}
            required
          />

          {quotaError && <p className="leave-requests-page__form-error">{quotaError}</p>}

          <div className="leave-requests-page__form-actions">
            <button type="button" className="leave-requests-page__cancel" onClick={closeQuotaModal}>
              Cancel
            </button>
            <button type="submit" className="leave-requests-page__submit">
              Save Quotas
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default LeaveRequestsPage;