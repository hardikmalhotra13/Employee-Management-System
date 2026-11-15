import "./EmployeeOffboarding.css";
import { useState, useEffect } from "react";
import { UserMinus, Check, AlertTriangle } from "lucide-react";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  getEmployeeOffboarding,
  startEmployeeOffboarding,
  updateOffboardingTask,
  completeEmployeeOffboarding,
} from "../../../services/api/offboardingApi.js";

function formatDate(value) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function RequirementBadge({ isRequired }) {
  return (
    <span
      className={
        isRequired
          ? "employee-offboarding__requirement-badge employee-offboarding__requirement-badge--required"
          : "employee-offboarding__requirement-badge employee-offboarding__requirement-badge--optional"
      }
    >
      {isRequired ? "Required" : "Optional"}
    </span>
  );
}

function EmployeeOffboarding({ employeeId, isEmployeeArchived, onCompleted }) {
  const { admin } = useAuth();
  const canManage = hasPermission(admin, "offboarding.manage");
  const canComplete = hasPermission(admin, "offboarding.complete");

  const [offboarding, setOffboarding] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [lastWorkingDate, setLastWorkingDate] = useState("");
  const [startFormError, setStartFormError] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const [isCompleteConfirmOpen, setIsCompleteConfirmOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const fetchOffboarding = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getEmployeeOffboarding(employeeId);
      setOffboarding(result);
    } catch (err) {
      setLoadError("Failed to load offboarding details. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOffboarding();
  }, [employeeId]);

  const openStartModal = () => {
    setLastWorkingDate("");
    setStartFormError("");
    setIsStartModalOpen(true);
  };

  const closeStartModal = () => {
    setIsStartModalOpen(false);
    setLastWorkingDate("");
    setStartFormError("");
  };

  const handleStartSubmit = async (e) => {
    e.preventDefault();

    if (!lastWorkingDate) {
      setStartFormError("Last working date is required");
      return;
    }

    setIsStarting(true);
    setStartFormError("");

    try {
      await startEmployeeOffboarding(employeeId, lastWorkingDate);
      closeStartModal();
      fetchOffboarding();
    } catch (err) {
      setStartFormError(err.response?.data?.message || "Failed to start offboarding. Please try again.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleToggleTask = async (task) => {
    setActionError("");

    try {
      await updateOffboardingTask(employeeId, task.task_id, !task.is_completed);
      fetchOffboarding();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to update task. Please try again.");
    }
  };

  const handleConfirmComplete = async () => {
    setIsCompleting(true);
    setActionError("");

    try {
      await completeEmployeeOffboarding(employeeId);
      setIsCompleteConfirmOpen(false);
      fetchOffboarding();
      if (onCompleted) onCompleted();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to complete offboarding. Please try again.");
      setIsCompleteConfirmOpen(false);
    } finally {
      setIsCompleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="employee-offboarding">
        <p className="employee-offboarding__loading">Loading offboarding details...</p>
      </div>
    );
  }

  // Not Started / In Progress / Completed - derived from data already
  // available here (no new API field needed). Completion is durably marked
  // by the employee being archived (employees.is_archived / status =
  // 'Inactive', set atomically by complete_employee_offboarding) - there is
  // no separate "completed" flag to track.
  const state = !offboarding || !offboarding.is_started
    ? "Not Started"
    : isEmployeeArchived
    ? "Completed"
    : "In Progress";

  const percentComplete =
    offboarding && offboarding.total > 0 ? Math.round((offboarding.completed / offboarding.total) * 100) : 0;

  return (
    <div className="employee-offboarding">
      <div className="employee-offboarding__header">
        <div className="employee-offboarding__heading">
          <span className="employee-offboarding__icon">
            <UserMinus size={16} />
          </span>
          <div>
            <p className="employee-offboarding__title">Offboarding</p>
            <p className="employee-offboarding__subtitle">Checklist to complete before this employee is archived</p>
          </div>
        </div>

        {canManage && offboarding && !offboarding.is_started && !isEmployeeArchived && (
          <button type="button" className="employee-offboarding__start-button" onClick={openStartModal}>
            Start Offboarding
          </button>
        )}
      </div>

      {loadError && <p className="employee-offboarding__error">{loadError}</p>}
      {actionError && <p className="employee-offboarding__error">{actionError}</p>}

      {offboarding && !offboarding.is_started && !loadError && (
        <p className="employee-offboarding__empty">Offboarding has not been started for this employee</p>
      )}

      {offboarding && offboarding.is_started && (
        <>
          <div className="employee-offboarding__meta-row">
            <p className="employee-offboarding__last-working-date">
              Last Working Date: {formatDate(offboarding.last_working_date)}
            </p>
            <span
              className={
                state === "Completed"
                  ? "employee-offboarding__state-badge employee-offboarding__state-badge--completed"
                  : "employee-offboarding__state-badge employee-offboarding__state-badge--in-progress"
              }
            >
              {state}
            </span>
          </div>

          <div className="employee-offboarding__progress-section">
            <div className="employee-offboarding__progress-bar-track">
              <div
                className="employee-offboarding__progress-bar-fill"
                style={{ width: `${percentComplete}%` }}
              />
            </div>
            <p className="employee-offboarding__progress">
              {percentComplete}% complete - {offboarding.completed} of {offboarding.total} tasks completed
              {" "}({offboarding.required_completed} of {offboarding.required_total} required)
            </p>
          </div>

          {state === "Completed" && (
            <p className="employee-offboarding__completed-banner">
              Offboarding completed. This employee has been archived and this checklist is now read-only.
            </p>
          )}

          {offboarding.open_assets > 0 && state !== "Completed" && (
            <div className="employee-offboarding__asset-warning">
              <AlertTriangle size={16} />
              <span>
                {offboarding.open_assets} asset(s) are still assigned to this employee. Return them via
                Asset Management before completing offboarding.
              </span>
            </div>
          )}

          <ul className="employee-offboarding__task-list">
            {offboarding.tasks.map((task) => (
              <li
                key={task.task_id}
                className={
                  task.is_completed
                    ? "employee-offboarding__task employee-offboarding__task--done"
                    : "employee-offboarding__task"
                }
              >
                <label className="employee-offboarding__task-label">
                  <input
                    type="checkbox"
                    checked={task.is_completed}
                    onChange={() => handleToggleTask(task)}
                    disabled={!canManage || isEmployeeArchived}
                  />
                  <span
                    className={
                      task.is_completed
                        ? "employee-offboarding__task-name employee-offboarding__task-name--done"
                        : "employee-offboarding__task-name"
                    }
                  >
                    {task.item_name}
                  </span>
                  <RequirementBadge isRequired={task.is_required} />
                </label>

                <span className="employee-offboarding__task-status">
                  {task.is_completed ? (
                    <>
                      {task.completed_at && (
                        <span className="employee-offboarding__completed-on">
                          Completed on {task.completed_at.slice(0, 10)}
                        </span>
                      )}
                      <span className="employee-offboarding__completed-mark">
                        <Check size={14} />
                      </span>
                    </>
                  ) : (
                    <span className="employee-offboarding__not-completed">Not completed</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {!isEmployeeArchived && canComplete && (
            <div className="employee-offboarding__complete-row">
              {!offboarding.can_complete && offboarding.open_assets === 0 && (
                <p className="employee-offboarding__complete-hint">
                  All required tasks must be completed before offboarding can be finished
                </p>
              )}
              <button
                type="button"
                className="employee-offboarding__complete-button"
                disabled={!offboarding.can_complete}
                onClick={() => setIsCompleteConfirmOpen(true)}
              >
                Complete Offboarding
              </button>
            </div>
          )}
        </>
      )}

      <Modal isOpen={isStartModalOpen} onClose={closeStartModal} title="Start Offboarding">
        <form onSubmit={handleStartSubmit}>
          <FormInput
            label="Last Working Date"
            name="last_working_date"
            type="date"
            value={lastWorkingDate}
            onChange={setLastWorkingDate}
            error={startFormError}
            required
          />

          <div className="employee-offboarding__form-actions">
            <button type="button" className="employee-offboarding__cancel" onClick={closeStartModal}>
              Cancel
            </button>
            <button type="submit" className="employee-offboarding__submit" disabled={isStarting}>
              {isStarting ? "Starting..." : "Start Offboarding"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={isCompleteConfirmOpen}
        title="Complete Offboarding"
        message="This will mark the employee as Inactive and archive them. They will disappear from the active employee list. This action cannot be undone. Continue?"
        confirmLabel={isCompleting ? "Completing..." : "Complete Offboarding"}
        onConfirm={handleConfirmComplete}
        onCancel={() => setIsCompleteConfirmOpen(false)}
      />
    </div>
  );
}

export default EmployeeOffboarding;