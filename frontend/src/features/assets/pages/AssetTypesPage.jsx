import "./AssetTypesPage.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, MoreHorizontal, Package } from "lucide-react";
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
  listAssetTypes,
  createAssetType,
  updateAssetType,
  archiveAssetType,
  restoreAssetType,
  permanentlyDeleteAssetType,
} from "../../../services/api/assetApi.js";

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "Active", label: "Active" },
  { value: "Inactive", label: "Inactive" },
];

// Row-level "..." actions menu. Scoped to this page only - same actions and
// permission checks as before, just presented as a dropdown instead of
// inline icon buttons.
function AssetTypeActionsMenu({
  assetType,
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

  const hasAnyAction = assetType.is_archived
    ? canRestore || canPermanentlyDelete
    : canUpdate || canArchive;

  if (!hasAnyAction) {
    return null;
  }

  return (
    <div className="asset-types-page__menu" ref={menuRef}>
      <button
        type="button"
        className="asset-types-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="asset-types-page__menu-panel" role="menu">
          {assetType.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="asset-types-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(assetType);
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
                  className="asset-types-page__menu-item asset-types-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(assetType);
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
                  className="asset-types-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(assetType);
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
                  className="asset-types-page__menu-item asset-types-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(assetType);
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

function AssetTypesPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "asset.create");
  const canUpdate = hasPermission(admin, "asset.update");
  const canArchive = hasPermission(admin, "asset.archive");
  const canRestore = hasPermission(admin, "asset.restore");
  const canPermanentlyDelete = hasPermission(admin, "asset.delete");

  const [assetTypes, setAssetTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingType, setEditingType] = useState(null);
  const [formData, setFormData] = useState({ type_name: "", type_code: "", status: "Active" });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const fetchAssetTypes = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listAssetTypes({ page, pageSize: PAGE_SIZE, includeArchived: showArchived });
      setAssetTypes(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load asset types. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssetTypes();
  }, [page, showArchived]);

  const openCreateModal = () => {
    setFormData({ type_name: "", type_code: "", status: "Active" });
    setFormError("");
    setEditingType(null);
    setModalMode("create");
  };

  const openEditModal = (assetType) => {
    setFormData({
      type_name: assetType.type_name,
      type_code: assetType.type_code,
      status: assetType.status,
    });
    setFormError("");
    setEditingType(assetType);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingType(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (!formData.type_name.trim() || !formData.type_code.trim()) {
      setFormError("Type name and type code are required");
      return;
    }

    try {
      if (modalMode === "create") {
        await createAssetType(formData);
      } else {
        await updateAssetType(editingType.asset_type_id, formData);
      }

      closeModal();
      fetchAssetTypes();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveAssetType(archiveTarget.asset_type_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchAssetTypes();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive asset type. Please try again.");
    }
  };

  const handleRestore = async (assetType) => {
    try {
      await restoreAssetType(assetType.asset_type_id);
      setArchiveError("");
      fetchAssetTypes();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore asset type. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteAssetType(permanentDeleteTarget.asset_type_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchAssetTypes();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete asset type. Please try again.");
    }
  };

  const columns = [
    { key: "type_code", label: "Type Code" },
    {
      key: "type_name",
      label: "Type Name",
      render: (row) => <span className="asset-types-page__name-cell">{row.type_name}</span>,
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
          <span className="asset-types-page__archived-badge">Archived</span>
        ) : (
          <span className="asset-types-page__archived-placeholder">—</span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <AssetTypeActionsMenu
          assetType={row}
          isOpen={openMenuId === row.asset_type_id}
          onToggle={() => setOpenMenuId(openMenuId === row.asset_type_id ? null : row.asset_type_id)}
          onClose={() => setOpenMenuId((current) => (current === row.asset_type_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          onEdit={openEditModal}
          onArchive={(assetType) => setArchiveTarget(assetType)}
          onRestore={handleRestore}
          onPermanentDelete={(assetType) => setPermanentDeleteTarget(assetType)}
        />
      ),
    },
  ];

  return (
    <div className="asset-types-page">
      <PageHeader
        title="Asset Types"
        subtitle="Manage the asset catalog (e.g. Laptop, Monitor, Phone)"
        actions={
          canCreate && (
            <button type="button" className="asset-types-page__add-button" onClick={openCreateModal}>
              <Plus size={16} />
              Add asset type
            </button>
          )
        }
      />

      <div className="asset-types-page__controls">
        <label className="asset-types-page__archived-toggle">
          <span
            className={`asset-types-page__switch ${showArchived ? "asset-types-page__switch--on" : ""}`}
            onClick={() => {
              setShowArchived(!showArchived);
              setPage(1);
            }}
            role="checkbox"
            aria-checked={showArchived}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowArchived(!showArchived);
                setPage(1);
              }
            }}
          >
            <span className="asset-types-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="asset-types-page__delete-error">{loadError}</p>}
      {archiveError && <p className="asset-types-page__delete-error">{archiveError}</p>}

      <div className="asset-types-page__table-card">
        <div className="asset-types-page__table-card-header">
          <span className="asset-types-page__table-card-icon">
            <Package size={17} />
          </span>
          <div>
            <p className="asset-types-page__table-card-title">Asset Types</p>
            <p className="asset-types-page__table-card-subtitle">
              {total === 0 ? "No asset types yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={assetTypes}
          isLoading={isLoading}
          emptyMessage="No asset types found"
        />

        <div className="asset-types-page__table-card-footer">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Asset Type" : "Edit Asset Type"}
      >
        <form onSubmit={handleFormSubmit}>
          <div className="asset-types-page__form-section-header">
            <span className="asset-types-page__form-section-icon">
              <Package size={16} />
            </span>
            <div>
              <p className="asset-types-page__form-section-title">Asset type</p>
              <p className="asset-types-page__form-section-subtitle">
                {modalMode === "create"
                  ? "Create a new category of asset for your inventory"
                  : "Update this asset type's details"}
              </p>
            </div>
          </div>

          <FormInput
            label="Type Name"
            name="type_name"
            value={formData.type_name}
            onChange={(value) => setFormData({ ...formData, type_name: value })}
            error={formError}
            required
          />

          <FormInput
            label="Type Code"
            name="type_code"
            value={formData.type_code}
            onChange={(value) => setFormData({ ...formData, type_code: value })}
            required
          />
          <p className="asset-types-page__hint">
            Used to auto-generate asset tags for this type, e.g. "LAP" produces LAP-001, LAP-002...
          </p>

          <FormInput
            label="Status"
            name="status"
            type="select"
            value={formData.status}
            onChange={(value) => setFormData({ ...formData, status: value })}
            options={STATUS_OPTIONS}
            required
          />

          <div className="asset-types-page__form-actions">
            <button type="button" className="asset-types-page__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="asset-types-page__submit">
              {modalMode === "create" ? "Create Asset Type" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Asset Type"
        message={`Are you sure you want to archive "${archiveTarget?.type_name}"? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Asset Type"
        message={`Are you sure you want to permanently delete "${permanentDeleteTarget?.type_name}"? This action cannot be undone. Types with existing inventory items cannot be deleted.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default AssetTypesPage;