import "./UserManagement.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Trash2, Users, ShieldOff, MoreHorizontal } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserMfa,
} from "../../../services/api/settingsApi.js";
import { listAdminRoles } from "../../../services/api/rbacApi.js";

function getInitials(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : parts[0].slice(0, 2).toUpperCase();
}

// Row-level "..." actions menu. Same three existing actions and permission
// checks as before (Edit, Delete, Reset MFA - only shown when the row's
// mfa_enabled is genuinely true), just presented as a dropdown instead of
// separate inline icon buttons.
function UserActionsMenu({ user, isOpen, onToggle, onClose, canUpdate, canDelete, canResetMfa, onEdit, onDelete, onResetMfa }) {
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

  // mfa_enabled comes back from the API as a raw MySQL 0/1, not a real
  // boolean - Boolean(...) here avoids ever rendering a stray "0".
  const showResetMfa = canResetMfa && Boolean(user.mfa_enabled);
  const hasAnyAction = canUpdate || canDelete || showResetMfa;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="user-management__menu" ref={menuRef}>
      <button
        type="button"
        className="user-management__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="user-management__menu-panel" role="menu">
          {canUpdate && (
            <button
              type="button"
              className="user-management__menu-item"
              role="menuitem"
              onClick={() => {
                onEdit(user);
                onClose();
              }}
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
          {showResetMfa && (
            <button
              type="button"
              className="user-management__menu-item"
              role="menuitem"
              onClick={() => {
                onResetMfa(user);
                onClose();
              }}
            >
              <ShieldOff size={15} />
              Reset MFA
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="user-management__menu-item user-management__menu-item--danger"
              role="menuitem"
              onClick={() => {
                onDelete(user);
                onClose();
              }}
            >
              <Trash2 size={15} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function UserManagement() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "users.create");
  const canUpdate = hasPermission(admin, "users.update");
  const canDelete = hasPermission(admin, "users.delete");
  const canResetMfa = hasPermission(admin, "users.mfa_reset");

  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [roles, setRoles] = useState([]);

  const [modalMode, setModalMode] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ name: "", email: "", admin_role_id: "" });
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState("");

  const [mfaResetTarget, setMfaResetTarget] = useState(null);
  const [mfaResetError, setMfaResetError] = useState("");

  const [openMenuId, setOpenMenuId] = useState(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listUsers();
      setUsers(result);
    } catch (err) {
      setLoadError("Failed to load users. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const result = await listAdminRoles();
      setRoles(result);
    } catch (err) {
      // Role dropdown will just be empty; the rest of the section still works.
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchRoles();
  }, []);

  const roleOptions = roles.map((role) => ({
    value: role.admin_role_id,
    label: role.role_name,
  }));

  const openCreateModal = () => {
    setFormData({ name: "", email: "", admin_role_id: roles[0]?.admin_role_id || "" });
    setFormError("");
    setFormNotice("");
    setEditingUser(null);
    setModalMode("create");
  };

  const openEditModal = (user) => {
    setFormData({
      name: user.name,
      email: user.email,
      admin_role_id: user.admin_role_id,
    });
    setFormError("");
    setFormNotice("");
    setEditingUser(user);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingUser(null);
    setFormError("");
    setFormNotice("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.email.trim()) {
      setFormError("Name and email are required");
      return;
    }

    try {
      if (modalMode === "create") {
        const result = await createUser(formData);

        if (
          result.message &&
          result.message.includes("could not be sent")
        ) {
          setFormNotice(result.message);
        } else {
          closeModal();
        }
      } else {
        await updateUser(editingUser.admin_id, formData);
        closeModal();
      }

      fetchUsers();
    } catch (err) {
      setFormError(
        err.response?.data?.message ||
          "Something went wrong. Please try again."
      );
    }
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteUser(deleteTarget.admin_id);
      setDeleteTarget(null);
      setDeleteError("");
      fetchUsers();
    } catch (err) {
      setDeleteTarget(null);
      setDeleteError(
        err.response?.data?.message ||
          "Failed to delete user. Please try again."
      );
    }
  };

  const handleConfirmMfaReset = async () => {
    try {
      await resetUserMfa(mfaResetTarget.admin_id);
      setMfaResetTarget(null);
      setMfaResetError("");
      fetchUsers();
    } catch (err) {
      setMfaResetTarget(null);
      setMfaResetError(
        err.response?.data?.message ||
          "Failed to reset MFA. Please try again."
      );
    }
  };

  const columns = [
    {
      key: "name",
      label: "Name",
      render: (row) => (
        <div className="user-management__name-cell">
          <span className="user-management__avatar">{getInitials(row.name)}</span>
          <span>{row.name}</span>
        </div>
      ),
    },
    {
      key: "email",
      label: "Email",
    },
    {
      key: "role",
      label: "Role",
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        if (row.admin_id === admin?.admin_id) {
          return null;
        }

        return (
          <UserActionsMenu
            user={row}
            isOpen={openMenuId === row.admin_id}
            onToggle={() => setOpenMenuId(openMenuId === row.admin_id ? null : row.admin_id)}
            onClose={() => setOpenMenuId((current) => (current === row.admin_id ? null : current))}
            canUpdate={canUpdate}
            canDelete={canDelete}
            canResetMfa={canResetMfa}
            onEdit={openEditModal}
            onDelete={(user) => setDeleteTarget(user)}
            onResetMfa={(user) => setMfaResetTarget(user)}
          />
        );
      },
    },
  ];

  return (
    <div className="user-management">
      <div className="user-management__header">
        <div className="user-management__heading">
          <span className="user-management__icon">
            <Users size={16} />
          </span>
          <div>
            <p className="user-management__title">User Management ({users.length})</p>
            <p className="user-management__subtitle">
              Manage administrator accounts and their access
            </p>
          </div>
        </div>

        {canCreate && (
          <button
            type="button"
            className="user-management__add-button"
            onClick={openCreateModal}
          >
            <Plus size={16} />
            Add user
          </button>
        )}
      </div>

      {loadError && (
        <p className="user-management__error">{loadError}</p>
      )}

      {deleteError && (
        <p className="user-management__error">{deleteError}</p>
      )}

      {mfaResetError && (
        <p className="user-management__error">{mfaResetError}</p>
      )}

      <div className="user-management__table-card">
        <DataTable
          columns={columns}
          rows={users}
          isLoading={isLoading}
          emptyMessage="No users found"
        />
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add User" : "Edit User"}
      >
        <form onSubmit={handleFormSubmit}>
          <FormInput
            label="Name"
            name="name"
            value={formData.name}
            onChange={(value) =>
              setFormData({ ...formData, name: value })
            }
            error={formError}
            required
          />

          <FormInput
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={(value) =>
              setFormData({ ...formData, email: value })
            }
            required
          />

          <FormInput
            label="Role"
            name="admin_role_id"
            type="select"
            value={formData.admin_role_id}
            onChange={(value) =>
              setFormData({ ...formData, admin_role_id: value })
            }
            options={roleOptions}
            required
          />

          {formNotice && (
            <p className="user-management__notice">
              {formNotice}
            </p>
          )}

          <div className="user-management__form-actions">
            <button
              type="button"
              className="user-management__cancel"
              onClick={closeModal}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="user-management__submit"
            >
              {modalMode === "create"
                ? "Create User"
                : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete User"
        message={`Are you sure you want to delete ${deleteTarget?.name}? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        isOpen={mfaResetTarget !== null}
        title="Reset MFA"
        message={`Are you sure you want to reset two-factor authentication for ${mfaResetTarget?.name}? They will be required to re-enroll on their next login.`}
        confirmLabel="Reset MFA"
        onConfirm={handleConfirmMfaReset}
        onCancel={() => setMfaResetTarget(null)}
      />
    </div>
  );
}

export default UserManagement;