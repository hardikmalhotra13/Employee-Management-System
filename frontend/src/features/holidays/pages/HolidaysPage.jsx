import "./HolidaysPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2, MoreHorizontal, Sun, ChevronLeft, ChevronRight } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import DayKindBadge from "../../../components/common/DayKindBadge/DayKindBadge.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import { listHolidays, createHoliday, updateHoliday, deleteHoliday } from "../../../services/api/holidayApi.js";

const DAY_TYPE_OPTIONS = [
  { value: "Holiday", label: "Holiday (office closed on a weekday)" },
  { value: "Working Day", label: "Working Day (work a Saturday/Sunday)" },
];

const EMPTY_FORM = { holiday_date: "", day_type: "Holiday", title: "" };

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function HolidayActionsMenu({ holiday, isOpen, onToggle, onClose, canUpdate, canDelete, onEdit, onDelete }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!canUpdate && !canDelete) return null;

  return (
    <div className="holidays-page__menu" ref={containerRef}>
      <button
        type="button"
        className="holidays-page__menu-trigger"
        aria-label={`Actions for ${holiday.title}`}
        aria-haspopup="true"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <MoreHorizontal size={18} />
      </button>

      {isOpen && (
        <div className="holidays-page__menu-panel" role="menu">
          {canUpdate && (
            <button
              type="button"
              role="menuitem"
              className="holidays-page__menu-item"
              onClick={() => {
                onClose();
                onEdit(holiday);
              }}
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              role="menuitem"
              className="holidays-page__menu-item holidays-page__menu-item--danger"
              onClick={() => {
                onClose();
                onDelete(holiday);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function HolidaysPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "holidays.create");
  const canUpdate = hasPermission(admin, "holidays.update");
  const canDelete = hasPermission(admin, "holidays.delete");

  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingHoliday, setEditingHoliday] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);

  const fetchHolidays = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      setHolidays(await listHolidays(year));
    } catch (err) {
      setLoadError("Failed to load holidays. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, [year]);

  const openCreateModal = () => {
    setEditingHoliday(null);
    setFormData(EMPTY_FORM);
    setFieldErrors({});
    setFormError("");
    setIsModalOpen(true);
  };

  const openEditModal = (holiday) => {
    setEditingHoliday(holiday);
    setFormData({ holiday_date: holiday.holiday_date, day_type: holiday.day_type, title: holiday.title });
    setFieldErrors({});
    setFormError("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingHoliday(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFieldErrors({});
    setFormError("");

    const errors = {};
    if (!formData.holiday_date) errors.holiday_date = "Date is required";
    if (!formData.title.trim()) errors.title = "Title is required";
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = { ...formData, title: formData.title.trim() };

      if (editingHoliday) {
        await updateHoliday(editingHoliday.holiday_id, payload);
      } else {
        await createHoliday(payload);
      }

      const savedYear = Number(formData.holiday_date.slice(0, 4));
      closeModal();

      if (savedYear !== year) {
        setYear(savedYear);
      } else {
        fetchHolidays();
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.errors) {
        setFieldErrors(data.errors);
      } else {
        setFormError(data?.message || "Something went wrong, please try again");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    setActionError("");

    try {
      await deleteHoliday(deleteTarget.holiday_id);
      setDeleteTarget(null);
      fetchHolidays();
    } catch (err) {
      setDeleteTarget(null);
      setActionError(err.response?.data?.message || "Failed to delete. Please try again.");
    }
  };

  const columns = [
    { key: "holiday_date", label: "Date", render: (row) => formatDate(row.holiday_date) },
    { key: "day_type", label: "Type", render: (row) => <DayKindBadge kind={row.day_type} /> },
    { key: "title", label: "Title" },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <HolidayActionsMenu
          holiday={row}
          isOpen={openMenuId === row.holiday_id}
          onToggle={() => setOpenMenuId(openMenuId === row.holiday_id ? null : row.holiday_id)}
          onClose={() => setOpenMenuId((current) => (current === row.holiday_id ? null : current))}
          canUpdate={canUpdate}
          canDelete={canDelete}
          onEdit={openEditModal}
          onDelete={setDeleteTarget}
        />
      ),
    },
  ];

  return (
    <div className="holidays-page">
      <PageHeader
        title="Holidays & Working Days"
        subtitle="Saturdays and Sundays are holidays by default. Add office holidays for specific dates, or mark a weekend as a working day."
        actions={
          canCreate && (
            <button type="button" className="holidays-page__add-button" onClick={openCreateModal}>
              <Plus size={16} /> Add Date
            </button>
          )
        }
      />

      <div className="holidays-page__year-nav">
        <button
          type="button"
          className="holidays-page__year-button"
          aria-label="Previous year"
          onClick={() => setYear(year - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="holidays-page__year-label">{year}</span>
        <button
          type="button"
          className="holidays-page__year-button"
          aria-label="Next year"
          onClick={() => setYear(year + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {actionError && <p className="holidays-page__delete-error">{actionError}</p>}
      {loadError && <p className="holidays-page__delete-error">{loadError}</p>}

      <div className="holidays-page__table-card">
        <div className="holidays-page__table-card-header">
          <span className="holidays-page__table-card-icon">
            <Sun size={16} />
          </span>
          <div>
            <h2 className="holidays-page__table-card-title">Exceptions for {year}</h2>
            <p className="holidays-page__table-card-subtitle">
              Only office holidays and working-day overrides are listed - regular weekends are not.
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={holidays}
          isLoading={isLoading}
          emptyMessage={`No holidays or working-day overrides for ${year}`}
        />
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingHoliday ? "Edit Holiday / Working Day" : "Add Holiday / Working Day"}
      >
        <form className="holidays-page__form" onSubmit={handleSubmit} noValidate>
          <FormInput
            label="Date"
            name="holiday_date"
            type="date"
            value={formData.holiday_date}
            onChange={(value) => setFormData({ ...formData, holiday_date: value })}
            error={fieldErrors.holiday_date}
            required
          />
          <FormInput
            label="Type"
            name="day_type"
            type="select"
            value={formData.day_type}
            onChange={(value) => setFormData({ ...formData, day_type: value })}
            options={DAY_TYPE_OPTIONS}
            error={fieldErrors.day_type}
            required
          />
          <FormInput
            label="Title"
            name="title"
            value={formData.title}
            onChange={(value) => setFormData({ ...formData, title: value })}
            error={fieldErrors.title}
            required
          />

          <p className="holidays-page__form-hint">
            Saving a date never changes attendance, leave or roster records that already exist for it.
          </p>

          {formError && <p className="holidays-page__delete-error">{formError}</p>}

          <div className="holidays-page__form-actions">
            <button type="button" className="holidays-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="holidays-page__submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Date"
        message={
          deleteTarget
            ? `Delete "${deleteTarget.title}" (${formatDate(deleteTarget.holiday_date)})? Existing attendance, leave and roster records are not changed.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default HolidaysPage;