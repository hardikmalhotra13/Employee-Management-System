import "./MyHolidaysPage.css";
import { useState, useEffect, useMemo } from "react";
import { ChevronLeft, ChevronRight, Sun } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";
import { getMyHolidayCalendar } from "../../../services/api/employeeSelfApi.js";

// Monday-first so Saturday and Sunday sit together at the right edge.
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function toIsoDate(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function MyHolidaysPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getMonth());
  const [days, setDays] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError("");

    getMyHolidayCalendar(year)
      .then((result) => {
        if (!cancelled) setDays(result.days);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load the holiday calendar. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [year]);

  const byDate = useMemo(() => Object.fromEntries(days.map((day) => [day.date, day])), [days]);

  // Weekends are already visible on the grid, so the list only shows the
  // days someone set up: office holidays and weekends worked as normal days.
  const listedDays = days.filter((day) => day.kind !== "Weekend");

  const goToMonth = (offset) => {
    const next = new Date(year, monthIndex + offset, 1);
    setYear(next.getFullYear());
    setMonthIndex(next.getMonth());
  };

  const monthLabel = new Date(year, monthIndex, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = (new Date(year, monthIndex, 1).getDay() + 6) % 7; // Monday = 0
  const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const cells = [];
  for (let i = 0; i < leadingBlanks; i += 1) {
    cells.push(<div key={`blank-${i}`} className="my-holidays-page__cell my-holidays-page__cell--blank" />);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIsoDate(year, monthIndex, day);
    const info = byDate[iso];
    const kindClass = info ? ` my-holidays-page__cell--${info.kind === "Working Day" ? "working" : info.kind.toLowerCase()}` : "";
    const todayClass = iso === todayIso ? " my-holidays-page__cell--today" : "";

    cells.push(
      <div key={iso} className={`my-holidays-page__cell${kindClass}${todayClass}`} title={info?.title || undefined}>
        <span className="my-holidays-page__cell-day">{day}</span>
        {info && info.kind !== "Weekend" && <span className="my-holidays-page__cell-label">{info.title}</span>}
      </div>
    );
  }

  return (
    <div className="my-holidays-page">
      <PageHeader
        title="Holidays"
        subtitle="Saturdays and Sundays are holidays unless the office marks them as working days."
      />

      {loadError && <p className="my-holidays-page__error">{loadError}</p>}

      <div className="my-holidays-page__row">
        <div className="my-holidays-page__card">
          <div className="my-holidays-page__calendar-header">
            <button type="button" className="my-holidays-page__nav-button" aria-label="Previous month" onClick={() => goToMonth(-1)}>
              <ChevronLeft size={16} />
            </button>
            <h2 className="my-holidays-page__month">{monthLabel}</h2>
            <button type="button" className="my-holidays-page__nav-button" aria-label="Next month" onClick={() => goToMonth(1)}>
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="my-holidays-page__grid">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="my-holidays-page__weekday">
                {label}
              </div>
            ))}
            {cells}
          </div>

          <div className="my-holidays-page__legend">
            <DayKindBadge kind="Weekend" />
            <DayKindBadge kind="Holiday" />
            <DayKindBadge kind="Working Day" />
          </div>
        </div>

        <div className="my-holidays-page__card">
          <h2 className="my-holidays-page__list-title">
            <Sun size={16} /> Holidays &amp; working days in {year}
          </h2>

          {isLoading ? (
            <p className="my-holidays-page__empty">Loading...</p>
          ) : listedDays.length === 0 ? (
            <p className="my-holidays-page__empty">No office holidays or working-weekend overrides for {year}.</p>
          ) : (
            <ul className="my-holidays-page__list">
              {listedDays.map((day) => (
                <li key={day.date} className="my-holidays-page__list-item">
                  <div>
                    <p className="my-holidays-page__list-name">{day.title}</p>
                    <p className="my-holidays-page__list-date">{formatDate(day.date)}</p>
                  </div>
                  <DayKindBadge kind={day.kind} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default MyHolidaysPage;