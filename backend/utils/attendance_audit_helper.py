"""
Tells attendance rows the system generated apart from rows a person recorded,
using only the existing audit_logs table (no extra columns).

Why it is needed: leave approval has to relabel/create attendance rows, and a
later reversal has to undo exactly that - without ever touching an Absent or
Half Day row an admin/HR recorded by hand. The attendance row itself cannot say
who wrote it, so the audit trail is the only evidence, and the rule is
deliberately conservative: a row is treated as system-generated ONLY when its
audit trail proves it. Missing, ambiguous or unrecognised history means "not
proven", and the caller then leaves the row exactly as it is.

What the audit trail can and cannot prove:
  - reconcile_absences logs every row it creates with AUTO_ABSENT_DETAILS
    (a fixed sentence). admin_id cannot be used to tell automatic from manual,
    because the admin attendance list runs reconcile as the signed-in admin.
  - Employee check-ins are not audited, but a row with a check-in/out time is
    genuine attendance and is excluded by every caller anyway.
  - A person's create/correct is logged with their free-text reason, which is
    never one of the markers below, so it reads as "not system-generated".
  - Rows created or relabelled by a leave approval BEFORE these markers existed
    have no leave marker. Only the original auto-Absent evidence can still
    identify such a row; a row a leave created from nothing has no audit entry
    at all and therefore cannot be proven (see leave_row_origin).
"""

import re
from datetime import timedelta

# The exact text reconcile_absences logs. attendance_routes imports this so the
# writer and this classifier cannot drift apart.
AUTO_ABSENT_DETAILS = "Auto-marked Absent: no check-in after half of the scheduled shift had elapsed"

# Written by leave approval / reversal (leave_routes).
LEAVE_CREATED_DETAILS = "Created by approved leave request #{}"
LEAVE_RELABELED_DETAILS = "Relabeled by approved leave request #{} (was an auto-marked Absent)"
LEAVE_RESTORED_DETAILS = "Restored to auto-marked Absent after leave request #{} was reversed"
LEAVE_REMOVED_DETAILS = "Removed after leave request #{} was reversed (row was created by that leave)"

# 'update' entries the system itself writes. Anything else on a row's trail
# (an admin's reason text, an archive, ...) means a person was involved.
_SYSTEM_UPDATE_DETAILS = re.compile(
    r"Relabeled by approved leave request #\d+ \(was an auto-marked Absent\)"
    r"|Restored to auto-marked Absent after leave request #\d+ was reversed"
)

# An audit entry older than the attendance row cannot be about that row: after
# a database restart some MySQL versions reuse the ids of deleted rows. A small
# allowance covers the row and its audit entry being written moments apart.
_TRAIL_SLACK = timedelta(seconds=60)


def get_audit_trail(cursor, attendance_row):
    """The audit entries for this attendance row, oldest first, that can really belong to it."""
    cursor.execute(
        "SELECT action, details, created_at FROM audit_logs "
        "WHERE entity = 'attendance' AND record_id = %s ORDER BY log_id",
        (attendance_row["attendance_id"],)
    )
    cutoff = attendance_row["created_at"] - _TRAIL_SLACK
    return [entry for entry in cursor.fetchall() if entry["created_at"] >= cutoff]


def _only_system_entries_besides(trail, creation_entry):
    return all(
        entry is creation_entry
        or (entry["action"] == "update" and _SYSTEM_UPDATE_DETAILS.fullmatch(entry["details"] or ""))
        for entry in trail
    )


def is_system_generated_absent(cursor, attendance_row):
    """
    True only if the row was created by reconcile_absences and nothing since has
    been done to it except by the leave workflow: exactly one creation entry,
    carrying the auto-Absent message, and no other kind of entry. False for a
    row someone recorded by hand, for a row with no audit trail, and whenever
    the trail is unclear (several creations, unrecognised entries).
    """
    trail = get_audit_trail(cursor, attendance_row)
    creations = [entry for entry in trail if entry["action"] == "create"]
    if len(creations) != 1 or creations[0]["details"] != AUTO_ABSENT_DETAILS:
        return False
    return _only_system_entries_besides(trail, creations[0])


def leave_row_origin(cursor, attendance_row, leave_request_id):
    """
    For a row tagged with this leave request, what the leave did to it:
      'created'   - the leave approval inserted the row itself  -> safe to delete
      'converted' - the leave relabelled a system-generated Absent -> safe to restore to Absent
      None        - not provable (person-recorded, no/ambiguous audit trail)
                    -> the caller must leave the row untouched

    'converted' also covers a row relabelled by a leave approved before the
    relabel marker existed: its only evidence is the original auto-Absent entry,
    which is still enough to know the row was system-generated before the leave.
    A row that such an older leave INSERTED has no audit entry at all, so it is
    None here - that is the documented limitation, not a guess.
    """
    trail = get_audit_trail(cursor, attendance_row)
    creations = [entry for entry in trail if entry["action"] == "create"]
    if len(creations) != 1:
        return None

    creation = creations[0]
    if creation["details"] == LEAVE_CREATED_DETAILS.format(leave_request_id):
        return "created" if _only_system_entries_besides(trail, creation) else None
    if creation["details"] == AUTO_ABSENT_DETAILS:
        return "converted" if _only_system_entries_besides(trail, creation) else None
    return None