import "./MyLeavePage.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { Eye, XCircle, RotateCcw } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import {
  submitLeaveRequest,
  getMyLeaveRequests,
  getMyLeaveBalance,
  cancelLeaveRequest,
} from "../../../services/api/employeeSelfApi.js";

const PAGE_SIZE = 5;

const LEAVE_TYPE_LABELS = { CL: "Casual Leave (CL)", EL: "Earned Leave (EL)" };
const STATUS_OPTIONS = ["Pending", "Approved", "Rejected", "Cancelled"];
const HALF_DAY_OPTIONS = [
  { value: "", label: "Full Day" },
  { value: "First Half", label: "First Half" },
  { value: "Second Half", label: "Second Half" },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function MyLeavePage() {
  const [balances, setBalances] = useState([]);
  const [isBalanceLoading, setIsBalanceLoading] = useState(true);

  const [leaveType, setLeaveType] = useState("CL");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [halfDayPeriod, setHalfDayPeriod] = useState("");
  const [reason, setReason] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [formSuccess, setFormSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  // The page number belongs to the filters it was chosen under: changing any filter is
  // back to page 1 in the same render, so no request is ever sent for the old page number
  // combined with the new filters.
  const filterKey = [filterStatus, filterType, filterStart, filterEnd].join("|");
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 });
  // Stored page belongs to a different filter combination: drop it now (React re-renders at once,
  // before anything is committed or fetched) so coming back to an earlier combination starts at page 1.
  if (pageState.key !== filterKey) setPageState({ key: filterKey, page: 1 });
  const page = pageState.key === filterKey ? pageState.page : 1;
  const setPage = (nextPage) => setPageState({ key: filterKey, page: nextPage });

  // Each loader ignores any response that is no longer the latest request it made.
  const latestBalancesRequest = useRef(0);
  const latestHistoryRequest = useRef(0);

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [detailsRow, setDetailsRow] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelError, setCancelError] = useState("");

  const isSingleDay = startDate === endDate;

  const loadBalances = useCallback(async () => {
    const requestId = ++latestBalancesRequest.current;
    setIsBalanceLoading(true);
    try {
      const data = await getMyLeaveBalance();
      if (requestId === latestBalancesRequest.current) setBalances(data);
    } catch (err) {
      if (requestId === latestBalancesRequest.current) setBalances([]);
    } finally {
      if (requestId === latestBalancesRequest.current) setIsBalanceLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    const requestId = ++latestHistoryRequest.current;
    setIsHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await getMyLeaveRequests({
        status: filterStatus || undefined,
        leave_type: filterType || undefined,
        start_date: filterStart || undefined,
        end_date: filterEnd || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (requestId !== latestHistoryRequest.current) return;

      setRecords(result.records);
      setTotal(result.total);
    } catch (err) {
      if (requestId !== latestHistoryRequest.current) return;
      setHistoryError("Failed to load your leave history. Please try again.");
    } finally {
      if (requestId === latestHistoryRequest.current) setIsHistoryLoading(false);
    }
  }, [filterStatus, filterType, filterStart, filterEnd, page]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!isSingleDay && halfDayPeriod) setHalfDayPeriod("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSingleDay]);

  const handleReset = () => {
    setFilterStatus("");
    setFilterType("");
    setFilterStart("");
    setFilterEnd("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setFormErrors({});
    setFormSuccess("");
    setIsSubmitting(true);

    try {
      await submitLeaveRequest({
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        half_day_period: halfDayPeriod || null,
        reason: reason.trim() || undefined,
      });
      setFormSuccess("Leave request submitted successfully");
      setTimeout(() => setFormSuccess(""), 4000);
      setStartDate(todayStr());
      setEndDate(todayStr());
      setHalfDayPeriod("");
      setReason("");
      loadBalances();
      loadHistory();
    } catch (err) {
      const data = err.response?.data;
      setFormErrors(data?.errors || { start_date: data?.message || "Failed to submit leave request" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    setCancelError("");
    try {
      await cancelLeaveRequest(cancelTarget.leave_request_id);
      setCancelTarget(null);
      loadBalances();
      loadHistory();
    } catch (err) {
      setCancelError(err.response?.data?.message || "Failed to cancel leave request. Please try again.");
    }
  };

  const columns = [
    { key: "leave_type", label: "Type", render: (row) => row.leave_type },
    { key: "start_date", label: "Start Date", render: (row) => formatDateShort(row.start_date) },
    { key: "end_date", label: "End Date", render: (row) => formatDateShort(row.end_date) },
    { key: "duration", label: "Duration", render: (row) => durationLabel(row) },
    { key: "half_day", label: "Half Day", render: (row) => (row.is_half_day ? row.half_day_period || "Yes" : "No") },
    { key: "reason", label: "Reason", render: (row) => row.reason || "-" },
    { key: "status", label: "Status", render: (row) => <LeaveStatusBadge status={row.status} /> },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <span className="my-leave-page__row-actions">
          <button
            type="button"
            className="my-leave-page__icon-button"
            onClick={() => setDetailsRow(row)}
            aria-label="View details"
            title="View details"
          >
            <Eye size={15} />
          </button>
          {row.status === "Pending" && (
            <button
              type="button"
              className="my-leave-page__icon-button my-leave-page__icon-button--danger"
              onClick={() => {
                setCancelError("");
                setCancelTarget(row);
              }}
              aria-label="Cancel request"
              title="Cancel request"
            >
              <XCircle size={15} />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="my-leave-page">
      <PageHeader title="My Leave" subtitle="Request time off and track your balance and requests" />

      <div className="my-leave-page__balance-row">
        {(isBalanceLoading ? [{ leave_type: "CL" }, { leave_type: "EL" }] : balances).map((b) => (
          <div className="my-leave-page__balance-card" key={b.leave_type}>
            <p className="my-leave-page__balance-type">{LEAVE_TYPE_LABELS[b.leave_type] || b.leave_type}</p>
            <p className="my-leave-page__balance-remaining">{isBalanceLoading ? "-" : b.remaining}</p>
            <p className="my-leave-page__balance-detail-label">Available</p>
            <div className="my-leave-page__balance-stats">
              <span>
                <strong>{isBalanceLoading ? "-" : b.annual_quota}</strong> Allocated
              </span>
              <span>
                <strong>{isBalanceLoading ? "-" : b.used}</strong> Used
              </span>
              <span>
                <strong>{isBalanceLoading ? "-" : b.pending}</strong> Pending
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="my-leave-page__form-card">
        <p className="my-leave-page__form-title">Request Leave</p>

        <form onSubmit={handleSubmit}>
          <div className="my-leave-page__form-grid">
            <div className="my-leave-page__field">
              <label className="my-leave-page__field-label">
                Leave Type<span className="my-leave-page__required">*</span>
              </label>
              <select
                className="my-leave-page__select"
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
              >
                {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {formErrors.leave_type && <p className="my-leave-page__field-error">{formErrors.leave_type}</p>}
            </div>

            <div className="my-leave-page__field">
              <label className="my-leave-page__field-label">
                Start Date<span className="my-leave-page__required">*</span>
              </label>
              <input
                type="date"
                className="my-leave-page__date-input"
                value={startDate}
                min={todayStr()}
                onChange={(e) => setStartDate(e.target.value)}
              />
              {formErrors.start_date && <p className="my-leave-page__field-error">{formErrors.start_date}</p>}
            </div>

            <div className="my-leave-page__field">
              <label className="my-leave-page__field-label">
                End Date<span className="my-leave-page__required">*</span>
              </label>
              <input
                type="date"
                className="my-leave-page__date-input"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              {formErrors.end_date && <p className="my-leave-page__field-error">{formErrors.end_date}</p>}
            </div>
          </div>

          <div className="my-leave-page__field my-leave-page__half-day-field">
            <label className="my-leave-page__field-label">Half Day</label>
            <div className="my-leave-page__radio-group">
              {HALF_DAY_OPTIONS.map((opt) => (
                <label key={opt.label} className="my-leave-page__radio">
                  <input
                    type="radio"
                    name="half_day_period"
                    checked={halfDayPeriod === opt.value}
                    disabled={!isSingleDay}
                    onChange={() => setHalfDayPeriod(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {!isSingleDay && (
              <p className="my-leave-page__field-hint">Half day options apply to a single-day request only.</p>
            )}
            {formErrors.half_day_period && (
              <p className="my-leave-page__field-error">{formErrors.half_day_period}</p>
            )}
          </div>

          <div className="my-leave-page__field my-leave-page__reason-field">
            <label className="my-leave-page__field-label">Reason (optional)</label>
            <textarea
              className="my-leave-page__reason-input"
              rows={2}
              placeholder="Enter reason for leave request..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {formSuccess && <p className="my-leave-page__success">{formSuccess}</p>}
          {formErrors._general && <p className="my-leave-page__error">{formErrors._general}</p>}

          <button type="submit" className="my-leave-page__submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </button>
        </form>
      </div>

      <div className="my-leave-page__filter-bar">
        <select
          className="my-leave-page__select"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select className="my-leave-page__select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="my-leave-page__date-input"
          value={filterStart}
          max={filterEnd || undefined}
          onChange={(e) => setFilterStart(e.target.value)}
        />
        <span className="my-leave-page__date-sep">to</span>
        <input
          type="date"
          className="my-leave-page__date-input"
          value={filterEnd}
          min={filterStart || undefined}
          onChange={(e) => setFilterEnd(e.target.value)}
        />

        <button type="button" className="my-leave-page__reset-button" onClick={handleReset}>
          <RotateCcw size={13} />
          Reset
        </button>
      </div>

      <div className="my-leave-page__table-card">
        <div className="my-leave-page__table-header">
          <h2 className="my-leave-page__table-title">Leave History</h2>
        </div>

        {historyError && <p className="my-leave-page__error">{historyError}</p>}

        <DataTable columns={columns} rows={records} isLoading={isHistoryLoading} emptyMessage="No leave requests found" />

        {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
      </div>

      <Modal isOpen={detailsRow !== null} onClose={() => setDetailsRow(null)} title="Leave Details">
        {detailsRow && (
          <div className="my-leave-page__details">
            <div className="my-leave-page__details-row">
              <span>Leave Type</span>
              <strong>{LEAVE_TYPE_LABELS[detailsRow.leave_type] || detailsRow.leave_type}</strong>
            </div>
            <div className="my-leave-page__details-row">
              <span>Start Date</span>
              <strong>{formatDateShort(detailsRow.start_date)}</strong>
            </div>
            <div className="my-leave-page__details-row">
              <span>End Date</span>
              <strong>{formatDateShort(detailsRow.end_date)}</strong>
            </div>
            <div className="my-leave-page__details-row">
              <span>Duration</span>
              <strong>{durationLabel(detailsRow)}</strong>
            </div>
            <div className="my-leave-page__details-row">
              <span>Half Day</span>
              <strong>{detailsRow.is_half_day ? detailsRow.half_day_period || "Yes" : "No"}</strong>
            </div>
            <div className="my-leave-page__details-row">
              <span>Reason</span>
              <strong>{detailsRow.reason || "-"}</strong>
            </div>
            <div className="my-leave-page__details-row">
              <span>Status</span>
              <LeaveStatusBadge status={detailsRow.status} />
            </div>
            {detailsRow.status === "Rejected" && detailsRow.rejection_reason && (
              <div className="my-leave-page__details-row">
                <span>Rejection Reason</span>
                <strong>{detailsRow.rejection_reason}</strong>
              </div>
            )}
            <div className="my-leave-page__details-row">
              <span>Applied On</span>
              <strong>{formatDateShort(String(detailsRow.created_at).slice(0, 10))}</strong>
            </div>
            <div className="my-leave-page__form-actions">
              <button type="button" className="my-leave-page__close-button" onClick={() => setDetailsRow(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={cancelTarget !== null}
        title="Cancel Leave Request"
        message={
          cancelTarget ? (
            <>
              {`Are you sure you want to cancel this leave request? ${cancelTarget.leave_type} - ${formatDateShort(cancelTarget.start_date)} to ${formatDateShort(cancelTarget.end_date)} (${durationLabel(cancelTarget)})`}
              {cancelError && <span className="my-leave-page__dialog-error">{cancelError}</span>}
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Confirm Cancel"
        onConfirm={handleConfirmCancel}
        onCancel={() => {
          setCancelTarget(null);
          setCancelError("");
        }}
      />
    </div>
  );
}

export default MyLeavePage;