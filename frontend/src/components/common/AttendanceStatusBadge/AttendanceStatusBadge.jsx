import "./AttendanceStatusBadge.css";

const VARIANT_MAP = {
  Present: "present",
  Late: "late",
  Absent: "absent",
  "Half Day": "half-day",
  "On Leave": "on-leave",
  "Not Checked In": "not-checked-in",
  Weekend: "weekend",
  Holiday: "holiday",
};

/**
 * Renders the attendance display_status (see format_attendance_entry in
 * attendance_routes.py) - approved full-day leave already arrives as
 * "On Leave" from the backend without any DB status change; this
 * component only maps a status string to a color, it doesn't decide
 * what the status is.
 */
function AttendanceStatusBadge({ status }) {
  const variant = VARIANT_MAP[status] || "present";

  return <span className={`attendance-status-badge attendance-status-badge--${variant}`}>{status}</span>;
}

export default AttendanceStatusBadge;