import "./DepartmentListPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, Building2 } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  archiveDepartment,
  restoreDepartment,
  permanentlyDeleteDepartment,
} from "../../../services/api/departmentApi.js";
import { listEmployees } from "../../../services/api/employeeApi.js";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

// Compact "..." row-actions menu - same pattern as the Employees module.
// Presentation only; the items passed in carry the exact same handlers.
function RowActionsMenu({ items }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (items.length === 0) return null;

  return (
    <div className="department-list-page__menu" ref={containerRef}>
      <button
        type="button"
        className="department-list-page__menu-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        title="More actions"
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="department-list-page__menu-dropdown">
          {items.map(({ label, icon: Icon, onClick, variant }) => (
            <button
              key={label}
              type="button"
              className={`department-list-page__menu-item${variant ? ` department-list-page__menu-item--${variant}` : ""}`}
              onClick={() => {
                setIsOpen(false);
                onClick();
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DepartmentListPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "departments.create");
  const canUpdate = hasPermission(admin, "departments.update");
  const canArchive = hasPermission(admin, "departments.archive");
  const canRestore = hasPermission(admin, "departments.restore");
  const canPermanentlyDelete = hasPermission(admin, "departments.delete");

  const [departments, setDepartments] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingDepartment, setEditingDepartment] = useState(null);
  const [formData, setFormData] = useState({
    department_name: "",
    status: "Active",
    department_head_id: "",
    parent_department_id: "",
  });
  const [formError, setFormError] = useState("");
  const [headCandidates, setHeadCandidates] = useState([]);
  const [parentDepartments, setParentDepartments] = useState([]);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const [isCreateParentModalOpen, setIsCreateParentModalOpen] = useState(false);
  const [newParentName, setNewParentName] = useState("");
  const [newParentError, setNewParentError] = useState("");

  const fetchDepartments = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listDepartments({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setDepartments(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load departments. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, [page, showArchived]);

  useEffect(() => {
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setParentDepartments(result.records));
  }, []);

  const openCreateModal = () => {
    setFormData({ department_name: "", status: "Active", department_head_id: "", parent_department_id: "" });
    setFormError("");
    setEditingDepartment(null);
    setHeadCandidates([]);
    setModalMode("create");
  };

  const openEditModal = async (department) => {
    setFormData({
      department_name: department.department_name,
      status: department.status,
      department_head_id: department.department_head_id ? String(department.department_head_id) : "",
      parent_department_id: department.parent_department_id ? String(department.parent_department_id) : "",
    });
    setFormError("");
    setEditingDepartment(department);
    setModalMode("edit");

    // Only employees already in this department can be its head.
    try {
      const result = await listEmployees({ page: 1, pageSize: 100, department_id: department.department_id });
      setHeadCandidates(result.records);
    } catch (err) {
      setHeadCandidates([]);
    }
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingDepartment(null);
    setFormError("");
  };

  const handleParentDepartmentChange = (value) => {
    if (value === "__new__") {
      setNewParentName("");
      setNewParentError("");
      setIsCreateParentModalOpen(true);
      return;
    }

    setFormData({ ...formData, parent_department_id: value });
  };

  const closeCreateParentModal = () => {
    setIsCreateParentModalOpen(false);
  };

  const handleCreateParentDepartment = async (e) => {
    e.preventDefault();

    if (!newParentName.trim()) {
      setNewParentError("Department name is required");
      return;
    }

    try {
      const created = await createDepartment({
        department_name: newParentName.trim(),
        status: "Active",
        parent_department_id: null,
      });

      const result = await listDepartments({ page: 1, pageSize: 100 });
      setParentDepartments(result.records);
      setFormData({ ...formData, parent_department_id: String(created.department_id) });
      setIsCreateParentModalOpen(false);
    } catch (err) {
      setNewParentError(err.response?.data?.message || "Failed to create department");
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.department_name.trim()) {
      setFormError("Department name is required");
      return;
    }

    if (formData.parent_department_id) {
      const parent = parentDepartments.find(
        (dept) => String(dept.department_id) === formData.parent_department_id
      );

      if (parent && parent.department_name.trim().toLowerCase() === formData.department_name.trim().toLowerCase()) {
        setFormError("Parent department cannot have the same name as this department");
        return;
      }
    }

    try {
      if (modalMode === "create") {
        await createDepartment(formData);
      } else {
        await updateDepartment(editingDepartment.department_id, formData);
      }

      closeModal();
      fetchDepartments();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveDepartment(archiveTarget.department_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchDepartments();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive department. Please try again.");
    }
  };

  const handleRestore = async (department) => {
    try {
      await restoreDepartment(department.department_id);
      setArchiveError("");
      fetchDepartments();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore department. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteDepartment(permanentDeleteTarget.department_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchDepartments();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete department. Please try again.");
    }
  };

  const columns = [
    { key: "department_code", label: "Department Code" },
    { key: "department_name", label: "Department Name" },
    {
      key: "parent_department",
      label: "Parent Department",
      render: (row) => row.parent_department_name || "-",
    },
    {
      key: "department_head",
      label: "Department Head",
      render: (row) => (row.head_first_name ? `${row.head_first_name} ${row.head_last_name}` : "-"),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "is_archived",
      label: "Archived",
      render: (row) => (row.is_archived ? <span className="department-list-page__archived-badge">Archived</span> : null),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        if (row.is_archived) {
          const items = [];
          if (canRestore) {
            items.push({ label: "Restore", icon: ArchiveRestore, onClick: () => handleRestore(row), variant: "restore" });
          }
          if (canPermanentlyDelete) {
            items.push({
              label: "Permanently Delete",
              icon: Trash2,
              onClick: () => setPermanentDeleteTarget(row),
              variant: "danger",
            });
          }

          return <RowActionsMenu items={items} />;
        }

        const items = [];
        if (canUpdate) {
          items.push({ label: "Edit", icon: Pencil, onClick: () => openEditModal(row) });
        }
        if (canArchive) {
          items.push({ label: "Archive", icon: Archive, onClick: () => setArchiveTarget(row), variant: "danger" });
        }

        return <RowActionsMenu items={items} />;
      },
    },
  ];

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="department-list-page">
      <PageHeader
        title="Departments"
        subtitle="Manage the organization's departments"
        actions={
          canCreate && (
            <button type="button" className="department-list-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add department
            </button>
          )
        }
      />

      <div className="department-list-page__panel">
        <label className="department-list-page__archived-toggle">
          <span className="department-list-page__switch">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <span className="department-list-page__switch-track" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="department-list-page__delete-error">{loadError}</p>}
      {archiveError && <p className="department-list-page__delete-error">{archiveError}</p>}

      <div className="department-list-page__table-card">
        <div className="department-list-page__table-card-header">
          <div className="department-list-page__table-card-heading">
            <span className="department-list-page__table-card-icon">
              <Building2 size={15} />
            </span>
            <div>
              <p className="department-list-page__table-card-title">Department directory</p>
              <p className="department-list-page__table-card-subtitle">
                {total === 0
                  ? "No departments to show"
                  : `Showing ${rangeStart}-${rangeEnd} of ${total} departments`}
              </p>
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={departments}
          isLoading={isLoading}
          emptyMessage="No departments found"
        />
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
      />

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Department" : "Edit Department"}
      >
        <form className="department-list-page__form" onSubmit={handleFormSubmit}>
          <div className="department-list-page__form-header">
            <span className="department-list-page__form-icon">
              <Building2 size={16} />
            </span>
            <div>
              <p className="department-list-page__form-heading">Department information</p>
              <p className="department-list-page__form-subheading">
                {modalMode === "create" ? "Add a new department to the organization" : "Update department details"}
              </p>
            </div>
          </div>

          {modalMode === "edit" && (
            <p className="department-list-page__code">
              Department Code: {editingDepartment.department_code}
            </p>
          )}

          <FormInput
            label="Department Name"
            name="department_name"
            value={formData.department_name}
            onChange={(value) => setFormData({ ...formData, department_name: value })}
            error={formError}
            required
          />

          <FormInput
            label="Parent Department"
            name="parent_department_id"
            type="select"
            value={formData.parent_department_id}
            onChange={handleParentDepartmentChange}
            options={[
              ...parentDepartments
                .filter((dept) => !editingDepartment || dept.department_id !== editingDepartment.department_id)
                .map((dept) => ({
                  value: String(dept.department_id),
                  label: dept.department_name,
                })),
              { value: "__new__", label: "+ Add new department" },
            ]}
          />

          <FormInput
            label="Status"
            name="status"
            type="select"
            value={formData.status}
            onChange={(value) => setFormData({ ...formData, status: value })}
            options={STATUS_OPTIONS}
            required
          />

          {modalMode === "edit" && (
            <FormInput
              label="Department Head"
              name="department_head_id"
              type="select"
              value={formData.department_head_id}
              onChange={(value) => setFormData({ ...formData, department_head_id: value })}
              options={headCandidates.map((emp) => ({
                value: String(emp.employee_id),
                label: `${emp.first_name} ${emp.last_name} (${emp.employee_code})`,
              }))}
            />
          )}

          <div className="department-list-page__form-actions">
            <button type="button" className="department-list-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="department-list-page__submit">
              {modalMode === "create" ? "Create Department" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isCreateParentModalOpen}
        onClose={closeCreateParentModal}
        title="Add Parent Department"
      >
        <form className="department-list-page__form" onSubmit={handleCreateParentDepartment}>
          <FormInput
            label="Department Name"
            name="new_parent_department_name"
            value={newParentName}
            onChange={setNewParentName}
            error={newParentError}
            required
          />

          <div className="department-list-page__form-actions">
            <button type="button" className="department-list-page__cancel" onClick={closeCreateParentModal}>
              Cancel
            </button>
            <button type="submit" className="department-list-page__submit">
              Create
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Department"
        message={`Are you sure you want to archive ${archiveTarget?.department_name}? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Department"
        message={`Are you sure you want to permanently delete ${permanentDeleteTarget?.department_name}? This action cannot be undone and the record cannot be restored afterward.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default DepartmentListPage;