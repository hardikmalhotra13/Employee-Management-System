import "./StatusBadge.css";

const VARIANT_MAP = {
  Active: "success",
  "On Probation": "info",
  "On Notice": "notice",
  Inactive: "warning",
};

function StatusBadge({ status }) {
  const variant = VARIANT_MAP[status] || "warning";

  return (
    <span className={`status-badge status-badge--${variant}`}>
      {status}
    </span>
  );
}

export default StatusBadge;