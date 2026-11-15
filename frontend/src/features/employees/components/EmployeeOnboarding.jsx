import "./EmployeeOnboarding.css";
import { useState, useEffect } from "react";
import { UserPlus, Check } from "lucide-react";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  getEmployeeOnboarding,
  startEmployeeOnboarding,
  updateOnboardingTask,
  completeEmployeeOnboarding,
} from "../../../services/api/onboardingApi.js";

function RequirementBadge({ isRequired }) {
  return (
    <span
      className={
        isRequired
          ? "employee-onboarding__requirement-badge employee-onboarding__requirement-badge--required"
          : "employee-onboarding__requirement-badge employee-onboarding__requirement-badge--optional"
      }
    >
      {isRequired ? "Required" : "Optional"}
    </span>
  );
}

function EmployeeOnboarding({ employeeId, onCompleted }) {
  const { admin } = useAuth();
  const canManage = hasPermission(admin, "onboarding.manage");

  const [onboarding, setOnboarding] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [isStartConfirmOpen, setIsStartConfirmOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const [isCompleteConfirmOpen, setIsCompleteConfirmOpen] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const fetchOnboarding = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getEmployeeOnboarding(employeeId);
      setOnboarding(result);
    } catch (err) {
      setLoadError("Failed to load onboarding details. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOnboarding();
  }, [employeeId]);

  const handleConfirmStart = async () => {
    setIsStarting(true);
    setActionError("");

    try {
      await startEmployeeOnboarding(employeeId);
      setIsStartConfirmOpen(false);
      fetchOnboarding();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to start onboarding. Please try again.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleToggleTask = async (task) => {
    setActionError("");

    try {
      await updateOnboardingTask(employeeId, task.task_id, !task.is_completed);
      fetchOnboarding();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to update task. Please try again.");
    }
  };

  const handleConfirmComplete = async () => {
    setIsCompleting(true);
    setActionError("");

    try {
      await completeEmployeeOnboarding(employeeId);
      setIsCompleteConfirmOpen(false);
      fetchOnboarding();
      if (onCompleted) onCompleted();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to complete onboarding. Please try again.");
      setIsCompleteConfirmOpen(false);
    } finally {
      setIsCompleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="employee-onboarding">
        <p className="employee-onboarding__loading">Loading onboarding details...</p>
      </div>
    );
  }

  const percentComplete =
    onboarding && onboarding.total > 0 ? Math.round((onboarding.completed / onboarding.total) * 100) : 0;

  return (
    <div className="employee-onboarding">
      <div className="employee-onboarding__header">
        <div className="employee-onboarding__heading">
          <span className="employee-onboarding__icon">
            <UserPlus size={16} />
          </span>
          <div>
            <p className="employee-onboarding__title">Onboarding</p>
            <p className="employee-onboarding__subtitle">Checklist to complete for this employee's onboarding</p>
          </div>
        </div>

        {canManage && onboarding && (!onboarding.is_started || onboarding.state === "Completed") && (
          <button
            type="button"
            className="employee-onboarding__start-button"
            onClick={() => setIsStartConfirmOpen(true)}
          >
            {onboarding.state === "Completed" ? "Start New Onboarding" : "Start Onboarding"}
          </button>
        )}
      </div>

      {loadError && <p className="employee-onboarding__error">{loadError}</p>}
      {actionError && <p className="employee-onboarding__error">{actionError}</p>}

      {onboarding && !onboarding.is_started && !loadError && (
        <p className="employee-onboarding__empty">Onboarding has not been started for this employee yet</p>
      )}

      {onboarding && onboarding.is_started && (
        <>
          <div className="employee-onboarding__progress-section">
            <div className="employee-onboarding__progress-bar-track">
              <div
                className="employee-onboarding__progress-bar-fill"
                style={{ width: `${percentComplete}%` }}
              />
            </div>
            <div className="employee-onboarding__progress-meta">
              <span className="employee-onboarding__progress-percent">
                {percentComplete}% complete
                <span
                  className={
                    onboarding.state === "Completed"
                      ? "employee-onboarding__state-badge employee-onboarding__state-badge--completed"
                      : "employee-onboarding__state-badge employee-onboarding__state-badge--in-progress"
                  }
                >
                  {onboarding.state}
                </span>
              </span>
              <span className="employee-onboarding__progress-text">
                {onboarding.completed} of {onboarding.total} tasks completed
                {" "}({onboarding.required_completed} of {onboarding.required_total} required)
              </span>
            </div>
          </div>

          {onboarding.state === "Completed" && (
            <p className="employee-onboarding__completed-banner">
              Onboarding completed on {onboarding.completed_at ? onboarding.completed_at.slice(0, 10) : "-"}.
              This checklist is now read-only.
            </p>
          )}

          <ul className="employee-onboarding__task-list">
            {onboarding.tasks.map((task) => (
              <li
                key={task.task_id}
                className={
                  task.is_completed
                    ? "employee-onboarding__task employee-onboarding__task--done"
                    : "employee-onboarding__task"
                }
              >
                <label className="employee-onboarding__task-label">
                  <input
                    type="checkbox"
                    checked={task.is_completed}
                    onChange={() => handleToggleTask(task)}
                    disabled={!canManage || onboarding.state === "Completed"}
                  />
                  <span
                    className={
                      task.is_completed
                        ? "employee-onboarding__task-name employee-onboarding__task-name--done"
                        : "employee-onboarding__task-name"
                    }
                  >
                    {task.item_name}
                  </span>
                  <RequirementBadge isRequired={task.is_required} />
                </label>

                <span className="employee-onboarding__task-status">
                  {task.is_completed ? (
                    <>
                      {task.completed_at && (
                        <span className="employee-onboarding__completed-on">
                          Completed on {task.completed_at.slice(0, 10)}
                        </span>
                      )}
                      <span className="employee-onboarding__completed-mark">
                        <Check size={14} />
                      </span>
                    </>
                  ) : (
                    <span className="employee-onboarding__not-completed">Not completed</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {canManage && onboarding.state !== "Completed" && (
            <div className="employee-onboarding__complete-row">
              {!onboarding.can_complete && (
                <p className="employee-onboarding__complete-hint">
                  All required tasks must be completed before onboarding can be finished
                </p>
              )}
              <button
                type="button"
                className="employee-onboarding__complete-button"
                disabled={!onboarding.can_complete}
                onClick={() => setIsCompleteConfirmOpen(true)}
              >
                Complete Onboarding
              </button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={isStartConfirmOpen}
        title={onboarding?.state === "Completed" ? "Start New Onboarding" : "Start Onboarding"}
        message={
          onboarding?.state === "Completed"
            ? "This employee's previous onboarding cycle is complete. Starting a new cycle will replace it with a fresh checklist based on the currently active checklist items. Continue?"
            : "This will create the onboarding checklist for this employee based on the currently active checklist items. Continue?"
        }
        confirmLabel={isStarting ? "Starting..." : "Start Onboarding"}
        onConfirm={handleConfirmStart}
        onCancel={() => setIsStartConfirmOpen(false)}
      />

      <ConfirmDialog
        isOpen={isCompleteConfirmOpen}
        title="Complete Onboarding"
        message="This will mark onboarding as complete for this employee. If they are currently On Probation, their status will change to Active. Continue?"
        confirmLabel={isCompleting ? "Completing..." : "Complete Onboarding"}
        onConfirm={handleConfirmComplete}
        onCancel={() => setIsCompleteConfirmOpen(false)}
      />
    </div>
  );
}

export default EmployeeOnboarding;