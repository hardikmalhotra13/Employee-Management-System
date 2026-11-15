import "./ActivityLog.css";
import { useState, useEffect } from "react";
import { History } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import { listActivityLog } from "../../../services/api/auditApi.js";

const PAGE_SIZE = 10;
const MAX_PAGES = 10;
const MAX_RECORDS = PAGE_SIZE * MAX_PAGES;

const ACTION_LABELS = {
  create: "Created",
  update: "Updated",
  archive: "Archived",
  restore: "Restored",
  upload: "Uploaded",
  delete: "Deleted",
};

function formatAction(action) {
  return ACTION_LABELS[action] || action;
}

const ACTION_BADGE_VARIANT = {
  create: "create",
  update: "update",
  archive: "archive",
  restore: "restore",
  upload: "upload",
  delete: "delete",
};

function ActionBadge({ action }) {
  const variant = ACTION_BADGE_VARIANT[action] || "update";
  return <span className={`activity-log__action-badge activity-log__action-badge--${variant}`}>{formatAction(action)}</span>;
}

function formatEntity(entity) {
  return entity.charAt(0).toUpperCase() + entity.slice(1);
}

function formatDetails(row) {
  if (!row.record_name) {
    return `#${row.record_id}`;
  }
  if (row.entity === "employee" && row.record_code) {
    return `${row.record_name} (${row.record_code})`;
  }
  return row.record_name;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// created_at arrives as a plain "YYYY-MM-DD HH:MM:SS" string with no
// timezone marker (see backend get_activity_log). It is parsed and
// formatted here manually, without ever constructing a JS Date object,
// so the displayed time is exactly the IST wall-clock value already
// stored in the database - no timezone conversion is applied at all.
function formatTimestamp(value) {
  if (!value) return value;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return value;

  const [, year, month, day, hour, minute] = match;
  const monthName = MONTH_NAMES[Number(month) - 1];
  const hourNum = Number(hour);
  const period = hourNum >= 12 ? "PM" : "AM";
  const displayHour = hourNum % 12 === 0 ? 12 : hourNum % 12;

  return `${Number(day)} ${monthName} ${year}, ${String(displayHour).padStart(2, "0")}:${minute} ${period}`;
}

function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchLogs = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listActivityLog({ page, pageSize: PAGE_SIZE });
      setLogs(result.records);
      setTotal(Math.min(result.total, MAX_RECORDS));
    } catch (err) {
      setLoadError("Failed to load activity log. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page]);

  const handlePageChange = (nextPage) => {
    setPage(Math.min(nextPage, MAX_PAGES));
  };

  const columns = [
    {
      key: "admin_name",
      label: "Admin",
      render: (row) => row.admin_name || "Deleted user",
    },
    {
      key: "action",
      label: "Action",
      render: (row) => <ActionBadge action={row.action} />,
    },
    {
      key: "entity",
      label: "Entity",
      render: (row) => formatEntity(row.entity),
    },
    {
      key: "details",
      label: "Details",
      render: (row) => formatDetails(row),
    },
    {
      key: "created_at",
      label: "When",
      render: (row) => formatTimestamp(row.created_at),
    },
  ];

  return (
    <div className="activity-log">
      <div className="activity-log__header">
        <div className="activity-log__heading">
          <span className="activity-log__icon">
            <History size={16} />
          </span>
          <div>
            <p className="activity-log__title">Activity Log</p>
            <p className="activity-log__subtitle">
              Recent administrative activity and changes
            </p>
          </div>
        </div>
      </div>

      {loadError && <p className="activity-log__error">{loadError}</p>}

      <div className="activity-log__table-card">
        <DataTable
          columns={columns}
          rows={logs}
          isLoading={isLoading}
          emptyMessage="No activity recorded yet"
        />
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={handlePageChange}
      />
    </div>
  );
}

export default ActivityLog;