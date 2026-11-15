import "./AssetsPage.css";
import { useState, useEffect, useRef } from "react";
import {
  Plus, Pencil, Archive, ArchiveRestore, Trash2, UserPlus, Undo2, Users2, History,
  MoreHorizontal, Eye, Boxes,
} from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listAssets,
  createAsset,
  updateAsset,
  archiveAsset,
  restoreAsset,
  permanentlyDeleteAsset,
  assignAsset,
  returnAsset,
  bulkAssignAssets,
  getAssetHistory,
  listAssetTypes,
} from "../../../services/api/assetApi.js";
import { listDepartments } from "../../../services/api/departmentApi.js";
import { listEmployees } from "../../../services/api/employeeApi.js";

const PAGE_SIZE = 10;

const EDITABLE_STATUS_OPTIONS = [
  { value: "Available", label: "Available" },
  { value: "Under Repair", label: "Under Repair" },
  { value: "Retired", label: "Retired" },
  { value: "Lost", label: "Lost" },
];

const CONDITION_OPTIONS = [
  { value: "New", label: "New" },
  { value: "Good", label: "Good" },
  { value: "Fair", label: "Fair" },
  { value: "Poor", label: "Poor" },
];

const RETURN_CONDITION_OPTIONS = [
  { value: "Good", label: "Good" },
  { value: "Damaged", label: "Damaged" },
  { value: "Missing Parts", label: "Missing Parts" },
  { value: "Non-functional", label: "Non-functional" },
];

function AssetStatusBadge({ status }) {
  const variant = {
    Available: "available",
    Assigned: "assigned",
    "Under Repair": "repair",
    Retired: "retired",
    Lost: "lost",
  }[status] || "available";

  return <span className={`asset-status-badge asset-status-badge--${variant}`}>{status}</span>;
}

// Row-level "..." actions menu. Same actions and permission checks as
// before, just presented as a dropdown matched to the asset's status:
// Available -> View Details, Assign, Assignment History, Edit, Archive
// Assigned  -> View Details, Return, Assignment History, Edit, Archive
// (Assignment History is shown for every non-archived asset, regardless
// of current status - the underlying endpoint already returns an
// asset's full history either way.)
// Archived  -> Restore, Permanently Delete
function AssetActionsMenu({
  asset,
  isOpen,
  onToggle,
  onClose,
  canUpdate,
  canArchive,
  canRestore,
  canPermanentlyDelete,
  canAssign,
  canReturn,
  onView,
  onAssign,
  onReturn,
  onHistory,
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

  return (
    <div className="assets-page__menu" ref={menuRef}>
      <button
        type="button"
        className="assets-page__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="assets-page__menu-panel" role="menu">
          {asset.is_archived ? (
            <>
              {canRestore && (
                <button
                  type="button"
                  className="assets-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onRestore(asset);
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
                  className="assets-page__menu-item assets-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onPermanentDelete(asset);
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
              <button
                type="button"
                className="assets-page__menu-item"
                role="menuitem"
                onClick={() => {
                  onView(asset);
                  onClose();
                }}
              >
                <Eye size={15} />
                View Details
              </button>
              {canAssign && asset.status === "Available" && (
                <button
                  type="button"
                  className="assets-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onAssign(asset);
                    onClose();
                  }}
                >
                  <UserPlus size={15} />
                  Assign
                </button>
              )}
              {canReturn && asset.status === "Assigned" && (
                <button
                  type="button"
                  className="assets-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onReturn(asset);
                    onClose();
                  }}
                >
                  <Undo2 size={15} />
                  Return
                </button>
              )}
              <button
                type="button"
                className="assets-page__menu-item"
                role="menuitem"
                onClick={() => {
                  onHistory(asset);
                  onClose();
                }}
              >
                <History size={15} />
                Assignment History
              </button>
              {canUpdate && asset.status !== "Assigned" && (
                <button
                  type="button"
                  className="assets-page__menu-item"
                  role="menuitem"
                  onClick={() => {
                    onEdit(asset);
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
                  className="assets-page__menu-item assets-page__menu-item--danger"
                  role="menuitem"
                  onClick={() => {
                    onArchive(asset);
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

function AssetsPage() {
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "asset.create");
  const canUpdate = hasPermission(admin, "asset.update");
  const canArchive = hasPermission(admin, "asset.archive");
  const canRestore = hasPermission(admin, "asset.restore");
  const canPermanentlyDelete = hasPermission(admin, "asset.delete");
  const canAssign = hasPermission(admin, "asset.assign");
  const canReturn = hasPermission(admin, "asset.return");

  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");

  const [assetTypes, setAssetTypes] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [modalMode, setModalMode] = useState(null); // "create" | "edit" | null
  const [editingAsset, setEditingAsset] = useState(null);
  const [formData, setFormData] = useState({
    asset_type_id: "",
    serial_number: "",
    manufacturer: "",
    model: "",
    condition: "",
    status: "Available",
    purchase_date: "",
    purchase_cost: "",
    vendor: "",
    warranty_expiry: "",
    notes: "",
  });
  const [formError, setFormError] = useState("");

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [actionError, setActionError] = useState("");
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const [viewingAsset, setViewingAsset] = useState(null);

  const [assignTarget, setAssignTarget] = useState(null);
  const [assignEmployeeId, setAssignEmployeeId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignError, setAssignError] = useState("");

  const [returnTarget, setReturnTarget] = useState(null);
  const [returnCondition, setReturnCondition] = useState("Good");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnError, setReturnError] = useState("");

  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState([{ asset_id: "", employee_id: "" }]);
  const [bulkError, setBulkError] = useState("");
  const [availableAssets, setAvailableAssets] = useState([]);

  const fetchAssets = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listAssets({
        page,
        pageSize: PAGE_SIZE,
        include_archived: showArchived,
        asset_type_id: typeFilter || undefined,
        status: statusFilter || undefined,
        department_id: departmentFilter || undefined,
      });
      setAssets(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load assets. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [page, showArchived, typeFilter, statusFilter, departmentFilter]);

  useEffect(() => {
    listAssetTypes({ page: 1, pageSize: 100 }).then((result) => setAssetTypes(result.records));
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setDepartments(result.records));
    listEmployees({ page: 1, pageSize: 100 }).then((result) => setEmployees(result.records));
  }, []);

  const openCreateModal = () => {
    setFormData({
      asset_type_id: "",
      serial_number: "",
      manufacturer: "",
      model: "",
      condition: "",
      status: "Available",
      purchase_date: "",
      purchase_cost: "",
      vendor: "",
      warranty_expiry: "",
      notes: "",
    });
    setFormError("");
    setEditingAsset(null);
    setModalMode("create");
  };

  const openEditModal = (asset) => {
    setFormData({
      asset_type_id: String(asset.asset_type_id),
      serial_number: asset.serial_number || "",
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      condition: asset.condition || "",
      status: asset.status,
      purchase_date: asset.purchase_date || "",
      purchase_cost: asset.purchase_cost != null ? String(asset.purchase_cost) : "",
      vendor: asset.vendor || "",
      warranty_expiry: asset.warranty_expiry || "",
      notes: asset.notes || "",
    });
    setFormError("");
    setEditingAsset(asset);
    setModalMode("edit");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingAsset(null);
    setFormError("");
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    if (modalMode === "create" && !formData.asset_type_id) {
      setFormError("Asset type is required");
      return;
    }

    try {
      if (modalMode === "create") {
        await createAsset(formData);
      } else {
        await updateAsset(editingAsset.asset_id, formData);
      }

      closeModal();
      fetchAssets();
    } catch (err) {
      setFormError(err.response?.data?.message || "Something went wrong. Please try again.");
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveAsset(archiveTarget.asset_id);
      setArchiveTarget(null);
      setActionError("");
      fetchAssets();
    } catch (err) {
      setArchiveTarget(null);
      setActionError(err.response?.data?.message || "Failed to archive asset. Please try again.");
    }
  };

  const handleRestore = async (asset) => {
    try {
      await restoreAsset(asset.asset_id);
      setActionError("");
      fetchAssets();
    } catch (err) {
      setActionError(err.response?.data?.message || "Failed to restore asset. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteAsset(permanentDeleteTarget.asset_id);
      setPermanentDeleteTarget(null);
      setActionError("");
      fetchAssets();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setActionError(err.response?.data?.message || "Failed to permanently delete asset. Please try again.");
    }
  };

  const openAssignModal = (asset) => {
    setAssignTarget(asset);
    setAssignEmployeeId("");
    setAssignNotes("");
    setAssignError("");
  };

  const handleAssignSubmit = async (e) => {
    e.preventDefault();

    if (!assignEmployeeId) {
      setAssignError("Employee is required");
      return;
    }

    try {
      await assignAsset(assignTarget.asset_id, { employee_id: assignEmployeeId, assignment_notes: assignNotes });
      setAssignTarget(null);
      setActionError("");
      fetchAssets();
    } catch (err) {
      setAssignError(err.response?.data?.message || "Failed to assign asset. Please try again.");
    }
  };

  const openReturnModal = (asset) => {
    setReturnTarget(asset);
    setReturnCondition("Good");
    setReturnNotes("");
    setReturnError("");
  };

  const handleReturnSubmit = async (e) => {
    e.preventDefault();

    try {
      await returnAsset(returnTarget.asset_id, { return_condition: returnCondition, return_notes: returnNotes });
      setReturnTarget(null);
      setActionError("");
      fetchAssets();
    } catch (err) {
      setReturnError(err.response?.data?.message || "Failed to process return. Please try again.");
    }
  };

  const openHistoryModal = async (asset) => {
    setHistoryTarget(asset);
    setHistoryLoading(true);

    try {
      const rows = await getAssetHistory(asset.asset_id);
      setHistoryRows(rows);
    } catch (err) {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openBulkModal = async () => {
    setBulkRows([{ asset_id: "", employee_id: "" }]);
    setBulkError("");
    setIsBulkModalOpen(true);

    try {
      const result = await listAssets({ page: 1, pageSize: 100, status: "Available" });
      setAvailableAssets(result.records);
    } catch (err) {
      setAvailableAssets([]);
    }
  };

  const closeBulkModal = () => {
    setIsBulkModalOpen(false);
  };

  const addBulkRow = () => {
    setBulkRows([...bulkRows, { asset_id: "", employee_id: "" }]);
  };

  const removeBulkRow = (index) => {
    setBulkRows(bulkRows.filter((_, i) => i !== index));
  };

  const updateBulkRow = (index, field, value) => {
    const next = [...bulkRows];
    next[index] = { ...next[index], [field]: value };
    setBulkRows(next);
  };

  const handleBulkSubmit = async (e) => {
    e.preventDefault();

    const rows = bulkRows.filter((r) => r.asset_id && r.employee_id);
    if (rows.length === 0) {
      setBulkError("Add at least one asset/employee pair");
      return;
    }

    try {
      const result = await bulkAssignAssets(rows);
      closeBulkModal();
      setActionError("");
      fetchAssets();
      alert(result.message);
    } catch (err) {
      setBulkError(err.response?.data?.message || "Failed to bulk assign assets. Please try again.");
    }
  };

  const columns = [
    { key: "asset_tag", label: "Asset Tag" },
    { key: "type_name", label: "Type" },
    { key: "serial_number", label: "Serial Number", render: (row) => row.serial_number || "-" },
    {
      key: "status",
      label: "Status",
      render: (row) => <AssetStatusBadge status={row.status} />,
    },
    {
      key: "current_employee",
      label: "Assigned To",
      render: (row) =>
        row.current_employee_id
          ? `${row.current_employee_first_name} ${row.current_employee_last_name}`
          : "-",
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <AssetActionsMenu
          asset={row}
          isOpen={openMenuId === row.asset_id}
          onToggle={() => setOpenMenuId(openMenuId === row.asset_id ? null : row.asset_id)}
          onClose={() => setOpenMenuId((current) => (current === row.asset_id ? null : current))}
          canUpdate={canUpdate}
          canArchive={canArchive}
          canRestore={canRestore}
          canPermanentlyDelete={canPermanentlyDelete}
          canAssign={canAssign}
          canReturn={canReturn}
          onView={(asset) => setViewingAsset(asset)}
          onAssign={openAssignModal}
          onReturn={openReturnModal}
          onHistory={openHistoryModal}
          onEdit={openEditModal}
          onArchive={(asset) => setArchiveTarget(asset)}
          onRestore={handleRestore}
          onPermanentDelete={(asset) => setPermanentDeleteTarget(asset)}
        />
      ),
    },
  ];

  return (
    <div className="assets-page">
      <PageHeader
        title="Assets"
        subtitle="Manage physical asset inventory and assignments"
        actions={
          <div className="assets-page__header-actions">
            {canAssign && (
              <button type="button" className="assets-page__bulk-button" onClick={openBulkModal}>
                <Users2 size={16} />
                Bulk assign
              </button>
            )}
            {canCreate && (
              <button type="button" className="assets-page__add-button" onClick={openCreateModal}>
                <Plus size={16} />
                Add asset
              </button>
            )}
          </div>
        }
      />

      <div className="assets-page__filters">
        <div className="assets-page__filter-select">
          <label className="assets-page__filter-label">Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="assets-page__select">
            <option value="">All types</option>
            {assetTypes.map((t) => (
              <option key={t.asset_type_id} value={t.asset_type_id}>{t.type_name}</option>
            ))}
          </select>
        </div>
        <div className="assets-page__filter-select">
          <label className="assets-page__filter-label">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="assets-page__select">
            <option value="">All statuses</option>
            <option value="Available">Available</option>
            <option value="Assigned">Assigned</option>
            <option value="Under Repair">Under Repair</option>
            <option value="Retired">Retired</option>
            <option value="Lost">Lost</option>
          </select>
        </div>
        <div className="assets-page__filter-select">
          <label className="assets-page__filter-label">Department</label>
          <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className="assets-page__select">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
            ))}
          </select>
        </div>
        <label className="assets-page__archived-toggle">
          <span
            className={`assets-page__switch ${showArchived ? "assets-page__switch--on" : ""}`}
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
            <span className="assets-page__switch-knob" />
          </span>
          Show archived
        </label>
      </div>

      {loadError && <p className="assets-page__delete-error">{loadError}</p>}
      {actionError && <p className="assets-page__delete-error">{actionError}</p>}

      <div className="assets-page__table-card">
        <div className="assets-page__table-card-header">
          <span className="assets-page__table-card-icon">
            <Boxes size={17} />
          </span>
          <div>
            <p className="assets-page__table-card-title">Asset inventory</p>
            <p className="assets-page__table-card-subtitle">
              {total === 0 ? "No assets yet" : `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}`}
            </p>
          </div>
        </div>

        <DataTable columns={columns} rows={assets} isLoading={isLoading} emptyMessage="No assets found" />

        <div className="assets-page__table-card-footer">
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={closeModal}
        title={modalMode === "create" ? "Add Asset" : "Edit Asset"}
      >
        <form onSubmit={handleFormSubmit}>
          <div className="assets-page__form-section-header">
            <span className="assets-page__form-section-icon">
              <Boxes size={16} />
            </span>
            <div>
              <p className="assets-page__form-section-title">
                {modalMode === "create" ? "New asset" : "Edit asset"}
              </p>
              <p className="assets-page__form-section-subtitle">
                {modalMode === "create" ? "Add a new item to the asset inventory" : "Update this asset's details"}
              </p>
            </div>
          </div>

          {modalMode === "edit" ? (
            <div className="assets-page__code-field">
              <span className="assets-page__code-label">Asset Tag</span>
              <span className="assets-page__code-value">{editingAsset.asset_tag} ({editingAsset.type_name})</span>
            </div>
          ) : (
            <FormInput
              label="Asset Type"
              name="asset_type_id"
              type="select"
              value={formData.asset_type_id}
              onChange={(value) => setFormData({ ...formData, asset_type_id: value })}
              options={assetTypes.map((t) => ({ value: String(t.asset_type_id), label: t.type_name }))}
              required
            />
          )}

          <div className="assets-page__form-grid">
            <FormInput
              label="Serial Number"
              name="serial_number"
              value={formData.serial_number}
              onChange={(value) => setFormData({ ...formData, serial_number: value })}
            />

            {modalMode === "edit" && (
              <FormInput
                label="Status"
                name="status"
                type="select"
                value={formData.status}
                onChange={(value) => setFormData({ ...formData, status: value })}
                options={EDITABLE_STATUS_OPTIONS}
                required
              />
            )}
          </div>

          <div className="assets-page__form-grid">
            <FormInput
              label="Manufacturer / Brand"
              name="manufacturer"
              value={formData.manufacturer}
              onChange={(value) => setFormData({ ...formData, manufacturer: value })}
            />

            <FormInput
              label="Model"
              name="model"
              value={formData.model}
              onChange={(value) => setFormData({ ...formData, model: value })}
            />
          </div>

          <FormInput
            label="Condition"
            name="condition"
            type="select"
            value={formData.condition}
            onChange={(value) => setFormData({ ...formData, condition: value })}
            options={CONDITION_OPTIONS}
          />

          <div className="assets-page__form-grid">
            <FormInput
              label="Purchase Date"
              name="purchase_date"
              type="date"
              value={formData.purchase_date}
              onChange={(value) => setFormData({ ...formData, purchase_date: value })}
            />

            <FormInput
              label="Purchase Cost"
              name="purchase_cost"
              type="number"
              value={formData.purchase_cost}
              onChange={(value) => setFormData({ ...formData, purchase_cost: value })}
            />
          </div>

          <div className="assets-page__form-grid">
            <FormInput
              label="Vendor"
              name="vendor"
              value={formData.vendor}
              onChange={(value) => setFormData({ ...formData, vendor: value })}
            />

            <FormInput
              label="Warranty Expiry"
              name="warranty_expiry"
              type="date"
              value={formData.warranty_expiry}
              onChange={(value) => setFormData({ ...formData, warranty_expiry: value })}
            />
          </div>

          <div className="assets-page__notes-field">
            <label className="assets-page__notes-label">Notes</label>
            <textarea
              className="assets-page__notes-input"
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          {formError && <p className="assets-page__form-error">{formError}</p>}

          <div className="assets-page__form-actions">
            <button type="button" className="assets-page__cancel" onClick={closeModal}>Cancel</button>
            <button type="submit" className="assets-page__submit">
              {modalMode === "create" ? "Create Asset" : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* View Asset Details - fully read-only */}
      <Modal isOpen={viewingAsset !== null} onClose={() => setViewingAsset(null)} title="Asset Details">
        {viewingAsset && (
          <div className="assets-page__view-details">
            <div className="assets-page__detail-section-title">Identification</div>
            <div className="assets-page__detail-grid">
              <div>
                <span className="assets-page__detail-label">Asset Tag</span>
                <p className="assets-page__detail-value">{viewingAsset.asset_tag}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Type</span>
                <p className="assets-page__detail-value">{viewingAsset.type_name}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Serial Number</span>
                <p className="assets-page__detail-value">{viewingAsset.serial_number || "-"}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Manufacturer</span>
                <p className="assets-page__detail-value">{viewingAsset.manufacturer || "-"}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Model</span>
                <p className="assets-page__detail-value">{viewingAsset.model || "-"}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Condition</span>
                <p className="assets-page__detail-value">{viewingAsset.condition || "-"}</p>
              </div>
            </div>

            <div className="assets-page__detail-section-title">Purchase Information</div>
            <div className="assets-page__detail-grid">
              <div>
                <span className="assets-page__detail-label">Purchase Date</span>
                <p className="assets-page__detail-value">{viewingAsset.purchase_date || "-"}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Purchase Cost</span>
                <p className="assets-page__detail-value">
                  {viewingAsset.purchase_cost != null ? viewingAsset.purchase_cost : "-"}
                </p>
              </div>
              <div>
                <span className="assets-page__detail-label">Vendor</span>
                <p className="assets-page__detail-value">{viewingAsset.vendor || "-"}</p>
              </div>
              <div>
                <span className="assets-page__detail-label">Warranty Expiry</span>
                <p className="assets-page__detail-value">{viewingAsset.warranty_expiry || "-"}</p>
              </div>
            </div>

            <div className="assets-page__detail-section-title">Current Status</div>
            <div className="assets-page__detail-grid">
              <div>
                <span className="assets-page__detail-label">Status</span>
                <p className="assets-page__detail-value">
                  <AssetStatusBadge status={viewingAsset.status} />
                </p>
              </div>
              <div>
                <span className="assets-page__detail-label">Assigned To</span>
                <p className="assets-page__detail-value">
                  {viewingAsset.current_employee_id
                    ? `${viewingAsset.current_employee_first_name} ${viewingAsset.current_employee_last_name}`
                    : "-"}
                </p>
              </div>
              <div>
                <span className="assets-page__detail-label">Department</span>
                <p className="assets-page__detail-value">{viewingAsset.current_employee_department_name || "-"}</p>
              </div>
            </div>

            <div className="assets-page__reason-field">
              <span className="assets-page__detail-label">Notes</span>
              <p className="assets-page__employee-reason">{viewingAsset.notes || "-"}</p>
            </div>

            <div className="assets-page__form-actions">
              <button type="button" className="assets-page__cancel" onClick={() => setViewingAsset(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={assignTarget !== null} onClose={() => setAssignTarget(null)} title="Assign Asset">
        <form onSubmit={handleAssignSubmit}>
          {assignTarget && (
            <p className="assets-page__code">Asset: {assignTarget.asset_tag} ({assignTarget.type_name})</p>
          )}

          <FormInput
            label="Employee"
            name="employee_id"
            type="select"
            value={assignEmployeeId}
            onChange={setAssignEmployeeId}
            options={employees.map((e) => ({
              value: String(e.employee_id),
              label: `${e.first_name} ${e.last_name} (${e.employee_code})`,
            }))}
            required
          />

          <div className="assets-page__notes-field">
            <label className="assets-page__notes-label">Assignment Notes (optional)</label>
            <textarea
              className="assets-page__notes-input"
              rows={2}
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
            />
          </div>

          {assignError && <p className="assets-page__form-error">{assignError}</p>}

          <div className="assets-page__form-actions">
            <button type="button" className="assets-page__cancel" onClick={() => setAssignTarget(null)}>Cancel</button>
            <button type="submit" className="assets-page__submit">Assign</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={returnTarget !== null} onClose={() => setReturnTarget(null)} title="Return Asset">
        <form onSubmit={handleReturnSubmit}>
          {returnTarget && (
            <p className="assets-page__code">
              Asset: {returnTarget.asset_tag} ({returnTarget.type_name}) - currently with{" "}
              {returnTarget.current_employee_first_name} {returnTarget.current_employee_last_name}
            </p>
          )}

          <FormInput
            label="Return Condition"
            name="return_condition"
            type="select"
            value={returnCondition}
            onChange={setReturnCondition}
            options={RETURN_CONDITION_OPTIONS}
            required
          />
          <p className="assets-page__hint">
            "Good" returns the asset to Available. Any other condition sets it to Under Repair.
          </p>

          <div className="assets-page__notes-field">
            <label className="assets-page__notes-label">Return Notes (optional)</label>
            <textarea
              className="assets-page__notes-input"
              rows={2}
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
            />
          </div>

          {returnError && <p className="assets-page__form-error">{returnError}</p>}

          <div className="assets-page__form-actions">
            <button type="button" className="assets-page__cancel" onClick={() => setReturnTarget(null)}>Cancel</button>
            <button type="submit" className="assets-page__submit">Process Return</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={historyTarget !== null} onClose={() => setHistoryTarget(null)} title="Assignment History">
        {historyTarget && (
          <p className="assets-page__code">{historyTarget.asset_tag} ({historyTarget.type_name})</p>
        )}
        {historyLoading && <p className="assets-page__hint">Loading...</p>}
        {!historyLoading && historyRows.length === 0 && <p className="assets-page__hint">No assignment history</p>}
        {!historyLoading && historyRows.length > 0 && (
          <div className="assets-page__history-list">
            {historyRows.map((h) => (
              <div key={h.assignment_id} className="assets-page__history-item">
                <p className="assets-page__history-employee">{h.first_name} {h.last_name}</p>
                <p className="assets-page__history-dates">
                  Assigned: {h.assigned_date}{h.returned_date ? ` — Returned: ${h.returned_date}` : " (current)"}
                </p>
                {h.return_condition && (
                  <p className="assets-page__history-dates">Condition on return: {h.return_condition}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal isOpen={isBulkModalOpen} onClose={closeBulkModal} title="Bulk Assign Assets">
        <form onSubmit={handleBulkSubmit}>
          <p className="assets-page__hint">
            Assign multiple available assets to different employees in a single, all-or-nothing operation.
          </p>

          {bulkRows.map((row, index) => (
            <div key={index} className="assets-page__bulk-row">
              <select
                value={row.asset_id}
                onChange={(e) => updateBulkRow(index, "asset_id", e.target.value)}
                className="assets-page__select"
              >
                <option value="">Select asset</option>
                {availableAssets.map((a) => (
                  <option key={a.asset_id} value={a.asset_id}>{a.asset_tag} ({a.type_name})</option>
                ))}
              </select>
              <select
                value={row.employee_id}
                onChange={(e) => updateBulkRow(index, "employee_id", e.target.value)}
                className="assets-page__select"
              >
                <option value="">Select employee</option>
                {employees.map((emp) => (
                  <option key={emp.employee_id} value={emp.employee_id}>
                    {emp.first_name} {emp.last_name}
                  </option>
                ))}
              </select>
              {bulkRows.length > 1 && (
                <button type="button" className="assets-page__bulk-remove" onClick={() => removeBulkRow(index)}>
                  Remove
                </button>
              )}
            </div>
          ))}

          <button type="button" className="assets-page__bulk-add" onClick={addBulkRow}>
            + Add row
          </button>

          {bulkError && <p className="assets-page__form-error">{bulkError}</p>}

          <div className="assets-page__form-actions">
            <button type="button" className="assets-page__cancel" onClick={closeBulkModal}>Cancel</button>
            <button type="submit" className="assets-page__submit">Assign All</button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Asset"
        message={`Are you sure you want to archive ${archiveTarget?.asset_tag}? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Asset"
        message={`Are you sure you want to permanently delete ${permanentDeleteTarget?.asset_tag}? Assets with assignment history cannot be deleted.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default AssetsPage;