import "./RoleListPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, ShieldCheck } from "lucide-react";
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
  listRoles,
  createRole,
  updateRole,
  archiveRole,
  restoreRole,
  permanentlyDeleteRole,
} from "../../../services/api/roleApi.js";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before, just presented as a dropdown instead of
// inline icon buttons.
function RoleActionsMenu({
  role,
  isOpen,
  onToggle,
  onClose,
  canUpdate,
  canArchive,
  canRestore,
  canPermanentlyDelete,
  onEdit,
  onArchive,
  onRestore,
  onPermanentDelete,
}) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  const hasAnyAction = role.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="role-list-page__menu" ref={menuRef}>
      <button
        type="button"
        className="role-list-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="role-list-page__menu-panel" role="menu">
          {role.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="role-list-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(role);
                    onClose();
                  }}
                >
                  <ArchiveRestore size={15} />
                  Restore
                </button>
              )}
              {canPermanentlyDelete && (
                <button
                  type="button"
                  className="role-list-page__menu-item role-list-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(role);
                    onClose();
                  }}
                >
                  <Trash2 size={15} />
                  Permanently Delete
                </button>
              )}
            </>
          ) : (
            <>
              {canUpdate && (
                <button
                  type="button"
                  className="role-list-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(role);
                    onClose();
                  }}
                >
                  <Pencil size={15} />
                  Edit
                </button>
              )}
              {canArchive && (
                <button
                  type="button"
                  className="role-list-page__menu-item role-list-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(role);
                    onClose();
                  }}
                >
                  <Archive size={15} />
                  Archive
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RoleListPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "roles.create");
  const canUpdate = hasPermission(admin, "roles.update");
  const canArchive = hasPermission(admin, "roles.archive");
  const canRestore = hasPermission(admin, "roles.restore");
  const canPermanentlyDelete = hasPermission(admin, "roles.delete");

  const [roles, setRoles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingRole, setEditingRole] = useState(null);
  const [formData, setFormData] = useState({ role_name: "", status: "Active" });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const fetchRoles = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listRoles({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setRoles(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load roles. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, [page, showArchived]);

  const openCreateModal = () => {
    setFormData({ role_name: "", status: "Active" });
    setFormError("");
    setEditingRole(null);
    setModalMode("create");
  };

  const openEditModal = (role) => {
    setFormData({ role_name: role.role_name, status: role.status });
    setFormError("");
    setEditingRole(role);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingRole(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.role_name.trim()) {
      setFormError("Role name is required");
      return;
    }

    try {
      if (modalMode === "create") {
        await createRole(formData);
      } else {
        await updateRole(editingRole.role_id, formData);
      }

      closeModal();
      fetchRoles();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveRole(archiveTarget.role_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchRoles();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive role. Please try again.");
    }
  };

  const handleRestore = async (role) => {
    try {
      await restoreRole(role.role_id);
      setArchiveError("");
      fetchRoles();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore role. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteRole(permanentDeleteTarget.role_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchRoles();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete role. Please try again.");
    }
  };

  const columns = [
    {
      key: "role_code",
      label: "Role Code",
      render: (row) => <span className="role-list-page__code-cell">{row.role_code}</span>,
    },
    {
      key: "role_name",
      label: "Role Name",
      render: (row) => <span className="role-list-page__name-cell">{row.role_name}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "is_archived",
      label: "Archived",
      render: (row) =>
        row.is_archived ? (
          <span className="role-list-page__archived-badge">Archived</span>
        ) : (
          <span className="role-list-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <RoleActionsMenu
          role={row}
          isOpen={openMenuId === row.role_id}
          onToggle={() => setOpenMenuId(openMenuId === row.role_id ? null : row.role_id)}
          onClose={() => setOpenMenuId((current) => (current === row.role_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          onEdit={openEditModal}
          onArchive={(role) => setArchiveTarget(role)}
          onRestore={handleRestore}
          onPermanentDelete={(role) => setPermanentDeleteTarget(role)}
        />
      ),
    },
  ];

  return (
    <div className="role-list-page">
      <PageHeader
        title="Roles"
        subtitle="Manage employee job designations"
        actions={
          canCreate && (
            <button type="button" className="role-list-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add role
            </button>
          )
        }
      />

      <div className="role-list-page__controls">
        <label className="role-list-page__archived-toggle">
          <span
            className={`role-list-page__switch ${showArchived ? "role-list-page__switch--on" : ""}`}
            onClick={() => setShowArchived(!showArchived)}
            role="checkbox"
            aria-checked={showArchived}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowArchived(!showArchived);
              }
            }}
          >
            <span className="role-list-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="role-list-page__delete-error">{loadError}</p>}
      {archiveError && <p className="role-list-page__delete-error">{archiveError}</p>}

      <div className="role-list-page__table-card">
        <div className="role-list-page__table-card-header">
          <span className="role-list-page__table-card-icon">
            <ShieldCheck size={17} />
          </span>
          <div>
            <p className="role-list-page__table-card-title">Roles directory</p>
            <p className="role-list-page__table-card-subtitle">
              {total === 0 ? "No roles yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={roles}
          isLoading={isLoading}
          emptyMessage="No roles found"
        />

        <div className="role-list-page__table-card-footer">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={setPage}
          />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Role" : "Edit Role"}
      >
        <form onSubmit={handleFormSubmit}>
          {modalMode === "edit" && (
            <p className="role-list-page__code">
              Role Code: {editingRole.role_code}
            </p>
          )}

          <FormInput
            label="Role Name"
            name="role_name"
            value={formData.role_name}
            onChange={(value) => setFormData({ ...formData, role_name: value })}
            error={formError}
            required
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

          <div className="role-list-page__form-actions">
            <button type="button" className="role-list-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="role-list-page__submit">
              {modalMode === "create" ? "Create Role" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Role"
        message={`Are you sure you want to archive ${archiveTarget?.role_name}? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Role"
        message={`Are you sure you want to permanently delete ${permanentDeleteTarget?.role_name}? This action cannot be undone and the record cannot be restored afterward.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default RoleListPage;