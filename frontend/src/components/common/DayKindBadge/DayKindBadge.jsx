import "./DayKindBadge.css";

// kind comes from the API's day_kind / calendar entries:
// "Weekend" | "Holiday" | "Working Day" (a weekend worked via override).
// Renders nothing for an ordinary working day (kind is null).
const VARIANT_MAP = {
  Weekend: "weekend",
  Holiday: "holiday",
  "Working Day": "working",
};

function DayKindBadge({ kind, title }) {
  if (!kind) return null;

  return (
    <span className={`day-kind-badge day-kind-badge--${VARIANT_MAP[kind] || "weekend"}`} title={title || kind}>
      {kind}
    </span>
  );
}

export default DayKindBadge;