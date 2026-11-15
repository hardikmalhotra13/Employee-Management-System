import "./TeamLeavePage.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { MoreHorizontal, Eye, Check, X, RotateCcw } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import SearchBar from "../../../components/common/SearchBar.jsx";
import {
  getTeamLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
} from "../../../services/api/managerApi.js";

const PAGE_SIZE = 5;
const STATUS_OPTIONS = ["Pending", "Approved", "Rejected", "Cancelled"];
const LEAVE_TYPE_LABELS = { CL: "Casual Leave (CL)", EL: "Earned Leave (EL)" };

function formatDateShort(value) {
  if (!value) return value;
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function durationLabel(row) {
  if (!row.is_half_day) {
    const start = new Date(`${row.start_date}T00:00:00`);
    const end = new Date(`${row.end_date}T00:00:00`);
    // leave_days (from the API) excludes weekends/holidays; the raw span is only a fallback.
    const days = row.leave_days ?? Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    return `${days} Day${days === 1 ? "" : "s"}`;
  }
  return row.half_day_period ? `0.5 Day (${row.half_day_period})` : "0.5 Day";
}

function LeaveStatusBadge({ status }) {
  return <span className={`leave-status-badge leave-status-badge--${status.toLowerCase()}`}>{status}</span>;
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
    <div className="team-leave-page__menu" ref={ref}>
      <button
        type="button"
        className="team-leave-page__menu-trigger"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="More actions"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="team-leave-page__menu-dropdown">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`team-leave-page__menu-item ${item.variant === "danger" ? "team-leave-page__menu-item--danger" : ""} ${item.variant === "success" ? "team-leave-page__menu-item--success" : ""}`}
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

function TeamLeavePage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // The page number belongs to the filters it was chosen under: changing any filter is
  // back to page 1 in the same render, so no request is ever sent for the old page number
  // combined with the new filters.
  const filterKey = [search, status, leaveType, startDate, endDate].join("|");
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  // Stored page belongs to a different filter combination: drop it now (React re-renders at once,
  // before anything is committed or fetched) so coming back to an earlier combination starts at page 1.
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (nextPage) => setPageState({ key: filterKey, page: nextPage });

  // Ignore any response that is no longer the latest request.
  const latestRequest = useRef(0);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [detailsRow, setDetailsRow] = useState(null);
  const [approveTarget, setApproveTarget] = useState(null);
  const [approveError, setApproveError] = useState("");
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [isMutating, setIsMutating] = useState(false);

  const fetchRequests = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setLoadError("");
    try {
      const result = await getTeamLeaveRequests({
        search: search || undefined,
        status: status || undefined,
        leave_type: leaveType || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (requestId !== latestRequest.current) return;

      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setLoadError("Failed to load team leave requests. Please try again.");
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }, [search, status, leaveType, startDate, endDate, page]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleReset = () => {
    setSearch("");
    setStatus("");
    setLeaveType("");
    setStartDate("");
    setEndDate("");
  };

  const handleConfirmApprove = async () => {
    if (isMutating) return;
    setApproveError("");
    setIsMutating(true);
    try {
      await approveLeaveRequest(approveTarget.leave_request_id);
      setApproveTarget(null);
      fetchRequests();
    } catch (err) {
      setApproveError(err.response?.data?.message || "Failed to approve leave request. Please try again.");
    } finally {
      setIsMutating(false);
    }
  };

  const openRejectModal = (row) => {
    setRejectTarget(row);
    setRejectReason("");
    setRejectError("");
  };

  const closeRejectModal = () => {
    setRejectTarget(null);
    setRejectError("");
  };

  const handleConfirmReject = async (e) => {
    e.preventDefault();
    if (isMutating) return;
    if (!rejectReason.trim()) {
      setRejectError("A reason is required to reject a leave request");
      return;
    }
    setIsMutating(true);
    try {
      await rejectLeaveRequest(rejectTarget.leave_request_id, rejectReason.trim());
      setRejectTarget(null);
      fetchRequests();
    } catch (err) {
      setRejectError(err.response?.data?.message || "Failed to reject leave request. Please try again.");
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
          <div className="team-leave-page__employee-code">{row.employee_code}</div>
        </div>
      ),
    },
    { key: "leave_type", label: "Type", render: (row) => row.leave_type },
    { key: "start_date", label: "Start Date", render: (row) => formatDateShort(row.start_date) },
    { key: "end_date", label: "End Date", render: (row) => formatDateShort(row.end_date) },
    { key: "duration", label: "Duration", render: (row) => durationLabel(row) },
    { key: "half_day", label: "Half Day", render: (row) => (row.is_half_day ? row.half_day_period || "Yes" : "No") },
    { key: "status", label: "Status", render: (row) => <LeaveStatusBadge status={row.status} /> },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        // Reason (and, for a rejected request, the rejection reason) live
        // inside View Details rather than their own table column or menu
        // item - that is what keeps the table itself uncrowded.
        const items = [{ label: "View Details", icon: Eye, onClick: () => setDetailsRow(row) }];
        if (row.status === "Pending") {
          items.push({ label: "Approve", icon: Check, variant: "success", onClick: () => setApproveTarget(row) });
          items.push({ label: "Reject", icon: X, variant: "danger", onClick: () => openRejectModal(row) });
        }
        return <RowActionsMenu items={items} />;
      },
    },
  ];

  return (
    <div className="team-leave-page">
      <PageHeader title="Team Leave" subtitle="Approve or reject leave requests from your direct reports" />

      <div className="team-leave-page__filter-bar">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search by name or employee code..."
        />
        <select className="team-leave-page__select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select className="team-leave-page__select" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <input
          type="date"
          className="team-leave-page__date-input"
          value={startDate}
          max={endDate || undefined}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <span className="team-leave-page__date-sep">to</span>
        <input
          type="date"
          className="team-leave-page__date-input"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <button type="button" className="team-leave-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="team-leave-page__table-card">
        <div className="team-leave-page__table-header">
          <h2 className="team-leave-page__table-title">Team Leave Requests</h2>
        </div>

        {loadError && <p className="team-leave-page__error">{loadError}</p>}

        <DataTable columns={columns} rows={records} isLoading={isLoading} emptyMessage="No leave requests found" />

        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>

      <Modal isOpen={detailsRow !== null} onClose={() => setDetailsRow(null)} title="Leave Request Details">
        {detailsRow && (
          <div className="team-leave-page__details">
            <div className="team-leave-page__details-row">
              <span>Employee</span>
              <strong>{detailsRow.first_name} {detailsRow.last_name} ({detailsRow.employee_code})</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>Leave Type</span>
              <strong>{LEAVE_TYPE_LABELS[detailsRow.leave_type] || detailsRow.leave_type}</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>Start Date</span>
              <strong>{formatDateShort(detailsRow.start_date)}</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>End Date</span>
              <strong>{formatDateShort(detailsRow.end_date)}</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>Duration</span>
              <strong>{durationLabel(detailsRow)}</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>Half Day</span>
              <strong>{detailsRow.is_half_day ? detailsRow.half_day_period || "Yes" : "No"}</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>Reason</span>
              <strong>{detailsRow.reason || "-"}</strong>
            </div>
            <div className="team-leave-page__details-row">
              <span>Status</span>
              <LeaveStatusBadge status={detailsRow.status} />
            </div>
            {detailsRow.status === "Rejected" && detailsRow.rejection_reason && (
              <div className="team-leave-page__details-row">
                <span>Rejection Reason</span>
                <strong>{detailsRow.rejection_reason}</strong>
              </div>
            )}
            <div className="team-leave-page__details-row">
              <span>Applied On</span>
              <strong>{formatDateShort(String(detailsRow.created_at).slice(0, 10))}</strong>
            </div>
            <div className="team-leave-page__form-actions">
              <button type="button" className="team-leave-page__close-button" onClick={() => setDetailsRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={approveTarget !== null}
        title="Approve Leave Request"
        message={
          approveTarget ? (
            <>
              {`Are you sure you want to approve this leave request? ${approveTarget.first_name} ${approveTarget.last_name} - ${approveTarget.leave_type} - ${formatDateShort(approveTarget.start_date)} to ${formatDateShort(approveTarget.end_date)}`}
              {approveError && <span className="team-leave-page__dialog-error">{approveError}</span>}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Approve"
        onConfirm={handleConfirmApprove}
        onCancel={() => {
          setApproveTarget(null);
          setApproveError("");
        }}
      />

      <Modal isOpen={rejectTarget !== null} onClose={closeRejectModal} title="Reject Leave Request">
        {rejectTarget && (
          <form onSubmit={handleConfirmReject}>
            <p className="team-leave-page__modal-copy">
              Are you sure you want to reject this leave request? {rejectTarget.first_name} {rejectTarget.last_name} -{" "}
              {rejectTarget.leave_type} - {formatDateShort(rejectTarget.start_date)} to{" "}
              {formatDateShort(rejectTarget.end_date)}
            </p>
            <div className="team-leave-page__field">
              <label className="team-leave-page__field-label">
                Rejection Reason<span className="team-leave-page__required">*</span>
              </label>
              <textarea
                className="team-leave-page__reason-input"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                disabled={isMutating}
              />
              {rejectError && <p className="team-leave-page__field-error">{rejectError}</p>}
            </div>
            <div className="team-leave-page__form-actions">
              <button type="button" className="team-leave-page__cancel-button" onClick={closeRejectModal} disabled={isMutating}>
                Cancel
              </button>
              <button type="submit" className="team-leave-page__reject-button" disabled={isMutating}>
                {isMutating ? "Rejecting..." : "Reject"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

export default TeamLeavePage;