import "./OnboardingItemsPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, ListChecks } from "lucide-react";
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
  listOnboardingItems,
  createOnboardingItem,
  updateOnboardingItem,
  archiveOnboardingItem,
  restoreOnboardingItem,
  permanentlyDeleteOnboardingItem,
} from "../../../services/api/onboardingApi.js";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

const REQUIRED_OPTIONS = [
  { value: "true", label: "Required" },
  { value: "false", label: "Optional" },
];

function RequirementBadge({ isRequired }) {
  return (
    <span
      className={
        isRequired
          ? "onboarding-items-page__requirement-badge onboarding-items-page__requirement-badge--required"
          : "onboarding-items-page__requirement-badge onboarding-items-page__requirement-badge--optional"
      }
    >
      {isRequired ? "Required" : "Optional"}
    </span>
  );
}

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before, just presented as a dropdown instead of
// inline icon buttons.
function OnboardingItemActionsMenu({
  item,
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

  const hasAnyAction = item.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="onboarding-items-page__menu" ref={menuRef}>
      <button
        type="button"
        className="onboarding-items-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="onboarding-items-page__menu-panel" role="menu">
          {item.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="onboarding-items-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(item);
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
                  className="onboarding-items-page__menu-item onboarding-items-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(item);
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
                  className="onboarding-items-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(item);
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
                  className="onboarding-items-page__menu-item onboarding-items-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(item);
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

function OnboardingItemsPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "onboarding.manage");
  const canUpdate = hasPermission(admin, "onboarding.manage");
  const canArchive = hasPermission(admin, "onboarding.manage");
  const canRestore = hasPermission(admin, "onboarding.manage");
  const canPermanentlyDelete = hasPermission(admin, "onboarding.manage");

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    item_name: "",
    is_required: "true",
    display_order: "",
    status: "Active",
  });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const fetchItems = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listOnboardingItems({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setItems(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load onboarding checklist items. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [page, showArchived]);

  const openCreateModal = () => {
    // display_order starts blank - left blank, the item is appended to the
    // end of the list (see create_onboarding_item on the backend).
    setFormData({ item_name: "", is_required: "true", display_order: "", status: "Active" });
    setFormError("");
    setEditingItem(null);
    setModalMode("create");
  };

  const openEditModal = (item) => {
    setFormData({
      item_name: item.item_name,
      is_required: item.is_required ? "true" : "false",
      display_order: String(item.display_order),
      status: item.status,
    });
    setFormError("");
    setEditingItem(item);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingItem(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.item_name.trim()) {
      setFormError("Item name is required");
      return;
    }

    const payload = {
      item_name: formData.item_name,
      is_required: formData.is_required === "true",
      // Blank means "append to the end" (backend resolves this on create).
      // In edit mode the field is always a real number, never blank.
      display_order: formData.display_order === "" ? null : Number(formData.display_order),
      status: formData.status,
    };

    try {
      if (modalMode === "create") {
        await createOnboardingItem(payload);
      } else {
        await updateOnboardingItem(editingItem.item_id, { ...payload, display_order: payload.display_order ?? 0 });
      }

      closeModal();
      fetchItems();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveOnboardingItem(archiveTarget.item_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchItems();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive checklist item. Please try again.");
    }
  };

  const handleRestore = async (item) => {
    try {
      await restoreOnboardingItem(item.item_id);
      setArchiveError("");
      fetchItems();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore checklist item. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteOnboardingItem(permanentDeleteTarget.item_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchItems();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete checklist item. Please try again.");
    }
  };

  const columns = [
    {
      key: "item_code",
      label: "Item Code",
      render: (row) => <span className="onboarding-items-page__code-cell">{row.item_code}</span>,
    },
    {
      key: "item_name",
      label: "Item Name",
      render: (row) => <span className="onboarding-items-page__name-cell">{row.item_name}</span>,
    },
    { key: "display_order", label: "Order" },
    {
      key: "is_required",
      label: "Required",
      render: (row) => <RequirementBadge isRequired={row.is_required} />,
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
          <span className="onboarding-items-page__archived-badge">Archived</span>
        ) : (
          <span className="onboarding-items-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <OnboardingItemActionsMenu
          item={row}
          isOpen={openMenuId === row.item_id}
          onToggle={() => setOpenMenuId(openMenuId === row.item_id ? null : row.item_id)}
          onClose={() => setOpenMenuId((current) => (current === row.item_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          onEdit={openEditModal}
          onArchive={(item) => setArchiveTarget(item)}
          onRestore={handleRestore}
          onPermanentDelete={(item) => setPermanentDeleteTarget(item)}
        />
      ),
    },
  ];

  return (
    <div className="onboarding-items-page">
      <PageHeader
        title="Onboarding Checklist"
        subtitle="Manage the checklist items used when starting onboarding for an employee"
        actions={
          canCreate && (
            <button type="button" className="onboarding-items-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add checklist item
            </button>
          )
        }
      />

      <div className="onboarding-items-page__controls">
        <label className="onboarding-items-page__archived-toggle">
          <span
            className={`onboarding-items-page__switch ${showArchived ? "onboarding-items-page__switch--on" : ""}`}
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
            <span className="onboarding-items-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="onboarding-items-page__delete-error">{loadError}</p>}
      {archiveError && <p className="onboarding-items-page__delete-error">{archiveError}</p>}

      <div className="onboarding-items-page__table-card">
        <div className="onboarding-items-page__table-card-header">
          <span className="onboarding-items-page__table-card-icon">
            <ListChecks size={17} />
          </span>
          <div>
            <p className="onboarding-items-page__table-card-title">Checklist items</p>
            <p className="onboarding-items-page__table-card-subtitle">
              {total === 0 ? "No checklist items yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={items}
          isLoading={isLoading}
          emptyMessage="No onboarding checklist items found"
        />

        <div className="onboarding-items-page__table-card-footer">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Checklist Item" : "Edit Checklist Item"}
      >
        <form onSubmit={handleFormSubmit}>
          <div className="onboarding-items-page__form-section-header">
            <span className="onboarding-items-page__form-section-icon">
              <ListChecks size={16} />
            </span>
            <div>
              <p className="onboarding-items-page__form-section-title">Checklist item</p>
              <p className="onboarding-items-page__form-section-subtitle">
                {modalMode === "create"
                  ? "Create a new item for employee onboarding"
                  : "Update this checklist item's details"}
              </p>
            </div>
          </div>

          {modalMode === "edit" && (
            <div className="onboarding-items-page__code-field">
              <span className="onboarding-items-page__code-label">Item Code</span>
              <span className="onboarding-items-page__code-value">{editingItem.item_code}</span>
            </div>
          )}

          <FormInput
            label="Item Name"
            name="item_name"
            value={formData.item_name}
            onChange={(value) => setFormData({ ...formData, item_name: value })}
            error={formError}
            required
          />

          <div className="onboarding-items-page__form-grid">
            <FormInput
              label="Requirement"
              name="is_required"
              type="select"
              value={formData.is_required}
              onChange={(value) => setFormData({ ...formData, is_required: value })}
              options={REQUIRED_OPTIONS}
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
          </div>

          <FormInput
            label="Display Order"
            name="display_order"
            type="number"
            value={formData.display_order}
            onChange={(value) => setFormData({ ...formData, display_order: value })}
            placeholder="e.g., 7 (leave empty to add to the end)"
          />
          {modalMode === "create" && (
            <p className="onboarding-items-page__field-hint">
              If left empty, this item will be added to the end of the list.
            </p>
          )}

          <div className="onboarding-items-page__form-actions">
            <button type="button" className="onboarding-items-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="onboarding-items-page__submit">
              {modalMode === "create" ? "Create Item" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Checklist Item"
        message={`Are you sure you want to archive "${archiveTarget?.item_name}"? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Checklist Item"
        message={`Are you sure you want to permanently delete "${permanentDeleteTarget?.item_name}"? This action cannot be undone. Items already used in an employee's onboarding cannot be deleted.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default OnboardingItemsPage;