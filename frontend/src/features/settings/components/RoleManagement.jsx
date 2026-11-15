import "./RoleManagement.css";
import { useState, useEffect } from "react";
import {
  Plus, Pencil, Trash2, ShieldCheck, Building2, Briefcase, Star, Clock, CalendarRange,
  ClipboardList, Plane, Boxes, Users, FileText, UserCog, History, UserPlus, UserMinus,
  TrendingUp, GraduationCap, Shapes,
} from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import {
  listAdminRoles,
  getAdminRole,
  listPermissions,
  createAdminRole,
  updateAdminRole,
  deleteAdminRole,
} from "../../../services/api/rbacApi.js";

// Purely decorative - one icon per existing permission module, so each
// permission group has a clear visual anchor like the reference. Does not
// add, rename, or change any module/permission; unrecognized modules (if
// any are added later at the data layer) fall back to a generic icon.
const MODULE_ICONS = {
  departments: Building2,
  roles: Briefcase,
  grades: Star,
  shifts: Clock,
  roster: CalendarRange,
  attendance: ClipboardList,
  leave: Plane,
  asset: Boxes,
  employees: Users,
  documents: FileText,
  users: UserCog,
  activity_log: History,
  rbac: ShieldCheck,
  onboarding: UserPlus,
  offboarding: UserMinus,
  performance: TrendingUp,
  training: GraduationCap,
};

function getModuleIcon(module) {
  return MODULE_ICONS[module] || Shapes;
}

function groupByModule(permissions) {
  const groups = {};
  permissions.forEach((permission) => {
    if (!groups[permission.module]) {
      groups[permission.module] = [];
    }
    groups[permission.module].push(permission);
  });
  return groups;
}

function formatModuleName(module) {
  return module
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Every permission's real, existing description should render as-is. This
// is a defensive fallback only - if a permission's description is ever
// missing/blank, it derives a readable label from that same permission's
// own existing permission_key (e.g. "users.mfa_reset" -> "Mfa Reset")
// instead of leaving the checkbox with no visible label at all. It never
// invents a permission or changes what's actually stored.
function permissionLabel(permission) {
  if (permission.description && permission.description.trim()) {
    return permission.description;
  }

  const action = permission.permission_key.split(".").pop();
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function RoleManagement() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingRole, setEditingRole] = useState(null);
  const [formData, setFormData] = useState({ role_name: "", permission_ids: [] });
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionError, setActionError] = useState("");

  const fetchAll = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const [rolesResult, permissionsResult] = await Promise.all([
        listAdminRoles(),
        listPermissions(),
      ]);
      setRoles(rolesResult);
      setPermissions(permissionsResult);
    } catch (err) {
      setLoadError("Failed to load roles and permissions. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const permissionGroups = groupByModule(permissions);

  const openCreateModal = () => {
    setFormData({ role_name: "", permission_ids: [] });
    setFormError("");
    setEditingRole(null);
    setModalMode("create");
  };

  const openEditModal = async (role) => {
    setFormError("");
    setEditingRole(role);
    setModalMode("edit");

    try {
      const fullRole = await getAdminRole(role.admin_role_id);
      setFormData({
        role_name: fullRole.role_name,
        permission_ids: fullRole.permission_ids,
      });
    } catch (err) {
      setFormError("Failed to load this role's permissions. Please try again.");
    }
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingRole(null);
    setFormError("");
  };

  const togglePermission = (permissionId) => {
    setFormData((prev) => {
      const isSelected = prev.permission_ids.includes(permissionId);
      return {
        ...prev,
        permission_ids: isSelected
          ? prev.permission_ids.filter((id) => id !== permissionId)
          : [...prev.permission_ids, permissionId],
      };
    });
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!editingRole?.is_system && !formData.role_name.trim()) {
      setFormError("Role name is required");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    try {
      if (modalMode === "create") {
        await createAdminRole(formData);
      } else {
        await updateAdminRole(editingRole.admin_role_id, formData);
      }
      closeModal();
      fetchAll();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteAdminRole(deleteTarget.admin_role_id);
      setDeleteTarget(null);
      setActionError("");
      fetchAll();
    } catch (err) {
      setDeleteTarget(null);
      setActionError(err.response?.data?.message || "Failed to delete role. Please try again.");
    }
  };

  const columns = [
    { key: "role_name", label: "Role Name" },
    {
      key: "is_system",
      label: "Type",
      render: (row) => (
        <span className={`role-management__type-badge ${row.is_system ? "role-management__type-badge--system" : ""}`}>
          {row.is_system ? "System" : "Custom"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <div className="role-management__row-actions">
          <button
            type="button"
            className="role-management__action-button role-management__action-button--edit"
            onClick={() => openEditModal(row)}
          >
            <Pencil size={16} />
          </button>
          {!row.is_system && (
            <button
              type="button"
              className="role-management__action-button role-management__action-button--delete"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="role-management">
      <div className="role-management__header">
        <div className="role-management__heading">
          <span className="role-management__icon">
            <ShieldCheck size={16} />
          </span>
          <div>
            <p className="role-management__title">Roles &amp; Permissions ({roles.length})</p>
            <p className="role-management__subtitle">
              Manage admin roles and what each one is allowed to do
            </p>
          </div>
        </div>

        <button type="button" className="role-management__add-button" onClick={openCreateModal}>
          <Plus size={16} />
          Add role
        </button>
      </div>

      {loadError && <p className="role-management__error">{loadError}</p>}
      {actionError && <p className="role-management__error">{actionError}</p>}

      <div className="role-management__table-card">
        <DataTable
          columns={columns}
          rows={roles}
          isLoading={isLoading}
          emptyMessage="No roles found"
        />
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Role" : "Edit Role"}
      >
        <form onSubmit={handleFormSubmit}>
          <FormInput
            label="Role Name"
            name="role_name"
            value={formData.role_name}
            onChange={(value) => setFormData({ ...formData, role_name: value })}
            disabled={Boolean(editingRole?.is_system)}
            required
          />
          {editingRole?.is_system && (
            <p className="role-management__hint">
              System roles cannot be renamed, but their permissions can be changed below.
            </p>
          )}

          <div className="role-management__permissions-header">
            <p className="role-management__permissions-label">Permissions</p>
            <p className="role-management__permissions-hint">
              Select the permissions this role should have
            </p>
          </div>

          <div className="role-management__permissions">
            {Object.keys(permissionGroups).sort().map((module) => {
              const ModuleIcon = getModuleIcon(module);

              return (
                <div key={module} className="role-management__permission-group">
                  <div className="role-management__permission-group-header">
                    <span className="role-management__permission-group-icon">
                      <ModuleIcon size={14} />
                    </span>
                    <p className="role-management__permission-group-title">
                      {formatModuleName(module)}
                    </p>
                  </div>
                  {permissionGroups[module].map((permission) => (
                    <label key={permission.permission_id} className="role-management__permission-checkbox">
                      <input
                        type="checkbox"
                        checked={formData.permission_ids.includes(permission.permission_id)}
                        onChange={() => togglePermission(permission.permission_id)}
                      />
                      {permissionLabel(permission)}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>

          {formError && <p className="role-management__error">{formError}</p>}

          <div className="role-management__form-actions">
            <button type="button" className="role-management__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="role-management__submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : modalMode === "create" ? "Create Role" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Role"
        message={`Are you sure you want to delete the "${deleteTarget?.role_name}" role? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default RoleManagement;