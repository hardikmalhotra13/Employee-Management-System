"""
Single source of truth for "is this date a working day?".

Rule, in priority order:
  1. An office_holidays row for the date wins:
       'Holiday'     -> non-working day
       'Working Day' -> working day (overrides a default weekend)
  2. Otherwise Saturday and Sunday are non-working days (the default
     weekend - never stored in the database).
  3. Otherwise it is a normal working day.

Attendance, leave, roster and the holiday screens all go through these
functions so the rule cannot drift between modules. Nothing here writes
to the database.
"""

from datetime import datetime, timedelta

WEEKEND_WEEKDAYS = (5, 6)  # date.weekday(): Saturday = 5, Sunday = 6


def to_date(value):
    """Accepts a date or a 'YYYY-MM-DD' string."""
    if isinstance(value, str):
        return datetime.strptime(value, "%Y-%m-%d").date()
    return value


def load_exceptions(cursor, start_date, end_date):
    """office_holidays rows in the (inclusive) range, keyed by date."""
    cursor.execute(
        "SELECT holiday_id, holiday_date, day_type, title FROM office_holidays "
        "WHERE holiday_date BETWEEN %s AND %s",
        (start_date, end_date)
    )
    return {row["holiday_date"]: row for row in cursor.fetchall()}


def get_day_info(day, exceptions):
    """
    {"is_working_day": bool, "kind": ..., "title": ...} where kind is
    'Holiday', 'Weekend', 'Working Day' (a weekend worked via override),
    or None for an ordinary working day.
    """
    day = to_date(day)
    exception = exceptions.get(day)
    if exception:
        return {
            "is_working_day": exception["day_type"] == "Working Day",
            "kind": exception["day_type"],
            "title": exception["title"],
        }
    if day.weekday() in WEEKEND_WEEKDAYS:
        return {"is_working_day": False, "kind": "Weekend", "title": "Weekend"}
    return {"is_working_day": True, "kind": None, "title": None}


def get_day_info_for(cursor, day):
    """Convenience for a single date."""
    day = to_date(day)
    return get_day_info(day, load_exceptions(cursor, day, day))


def iter_days(start_date, end_date):
    current = to_date(start_date)
    end = to_date(end_date)
    while current <= end:
        yield current
        if current == end:
            break  # stepping past 9999-12-31 would raise OverflowError
        current += timedelta(days=1)


def count_working_days(cursor, start_date, end_date):
    """
    Working days in the inclusive range. Counted arithmetically (whole weeks
    contribute 5, the leftover days are checked one by one) and then adjusted
    for the exception rows, so the cost does not grow with the length of the
    range - a leave request can span any dates the user types.
    """
    start = to_date(start_date)
    end = to_date(end_date)
    if end < start:
        return 0

    full_weeks, leftover_days = divmod((end - start).days + 1, 7)
    working = full_weeks * 5
    for offset in range(leftover_days):
        if (start + timedelta(days=offset)).weekday() not in WEEKEND_WEEKDAYS:
            working += 1

    # Same rule as get_day_info: a 'Holiday' only matters on a weekday and a
    # 'Working Day' only matters on a weekend; anything else changes nothing.
    for day, exception in load_exceptions(cursor, start, end).items():
        is_weekend = day.weekday() in WEEKEND_WEEKDAYS
        if exception["day_type"] == "Holiday" and not is_weekend:
            working -= 1
        elif exception["day_type"] == "Working Day" and is_weekend:
            working += 1
    return working


def non_working_dates(cursor, start_date, end_date):
    """Non-working dates (default weekends not overridden + holidays) in the range."""
    exceptions = load_exceptions(cursor, to_date(start_date), to_date(end_date))
    return [day for day in iter_days(start_date, end_date) if not get_day_info(day, exceptions)["is_working_day"]]


def special_days(cursor, start_date, end_date):
    """
    Every date in the range that is NOT an ordinary working day, as
    [{"date", "kind", "is_working_day", "title"}] - i.e. weekends,
    holidays, and weekends worked via override. This is what the UI uses
    to mark days; any date not listed is a normal working day.
    """
    exceptions = load_exceptions(cursor, to_date(start_date), to_date(end_date))
    days = []
    for day in iter_days(start_date, end_date):
        info = get_day_info(day, exceptions)
        if info["kind"] is not None:
            days.append({
                "date": day.strftime("%Y-%m-%d"),
                "kind": info["kind"],
                "is_working_day": info["is_working_day"],
                "title": info["title"],
            })
    return days


def annotate_day_kind(cursor, entries, date_key="attendance_date"):
    """
    Adds day_kind / day_title to each entry (date already a
    'YYYY-MM-DD' string) so a list view can badge Weekend/Holiday rows.
    Rows on an ordinary working day get day_kind = None.
    """
    dates = [to_date(e[date_key]) for e in entries if e and e.get(date_key)]
    if not dates:
        return entries
    exceptions = load_exceptions(cursor, min(dates), max(dates))
    for entry in entries:
        if entry and entry.get(date_key):
            info = get_day_info(entry[date_key], exceptions)
            entry["day_kind"] = info["kind"]
            entry["day_title"] = info["title"]
    return entries