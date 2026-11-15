import "./EmployeeDocuments.css";
import { useState, useEffect, useRef } from "react";
import { Plus, Download, Trash2, FileText, FolderOpen, MoreHorizontal } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";
import {
  listEmployeeDocuments,
  uploadEmployeeDocument,
  deleteEmployeeDocument,
  downloadEmployeeDocument,
} from "../../../services/api/documentApi.js";

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function getExtension(filename) {
  return filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
}

// Formats the API's RFC/GMT timestamp (e.g. "Sun, 20 Sep 2026 14:19:42 GMT")
// as e.g. "20 Sep 2026, 7:49 PM" in the viewer's local time. This is a real
// UTC timestamp (explicit "GMT"), so letting Date parse it and formatting
// with toLocaleDateString/toLocaleTimeString correctly converts it to local
// time - no manual component parsing needed here.
function formatUploadedAt(value) {
  if (!value) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const datePart = date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return `${datePart}, ${timePart}`;
}

// Row-level "..." actions menu. Download is always available; Delete is
// permission-gated, same as before - just presented as a dropdown instead
// of separate inline icon buttons.
function DocumentActionsMenu({ document: doc, isOpen, onToggle, onClose, canDelete, onDownload, onDelete }) {
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
    <div className="employee-documents__menu" ref={menuRef}>
      <button
        type="button"
        className="employee-documents__menu-trigger"
        onClick={onToggle}
        aria-label="Row actions"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="employee-documents__menu-panel" role="menu">
          <button
            type="button"
            className="employee-documents__menu-item"
            role="menuitem"
            onClick={() => {
              onDownload(doc);
              onClose();
            }}
          >
            <Download size={15} />
            Download
          </button>
          {canDelete && (
            <button
              type="button"
              className="employee-documents__menu-item employee-documents__menu-item--danger"
              role="menuitem"
              onClick={() => {
                onDelete(doc);
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

function EmployeeDocuments({ employeeId }) {
  const { admin } = useAuth();
  const canUpload = hasPermission(admin, "documents.upload");
  const canDelete = hasPermission(admin, "documents.delete");

  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [openMenuId, setOpenMenuId] = useState(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [file, setFile] = useState(null);
  const [formError, setFormError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionError, setActionError] = useState("");

  const fetchDocuments = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listEmployeeDocuments(employeeId);
      setDocuments(result);
    } catch (err) {
      setLoadError("Failed to load documents. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [employeeId]);

  const openAddModal = () => {
    setDocumentName("");
    setFile(null);
    setFormError("");
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setDocumentName("");
    setFile(null);
    setFormError("");
  };

  const handleFileChange = (e) => {
    setFile(e.target.files[0] || null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!documentName.trim()) {
      setFormError("Document name is required");
      return;
    }
    if (!file) {
      setFormError("Please choose a file to upload");
      return;
    }
    if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
      setFormError("Only PDF, JPG, JPEG, and PNG files are allowed");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFormError("File size cannot be greater than 10 MB");
      return;
    }

    setIsUploading(true);
    setFormError("");

    try {
      await uploadEmployeeDocument(employeeId, documentName.trim(), file);
      closeModal();
      fetchDocuments();
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to upload document. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = (row) => {
    downloadEmployeeDocument(row.document_id, `${row.document_name}.${getExtension(row.file_path)}`);
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteEmployeeDocument(deleteTarget.document_id);
      setDeleteTarget(null);
      setActionError("");
      fetchDocuments();
    } catch (err) {
      setDeleteTarget(null);
      setActionError(err.response?.data?.message || "Failed to delete document. Please try again.");
    }
  };

  const columns = [
    {
      key: "document_name",
      label: "Document Name",
      render: (row) => (
        <span className="employee-documents__name-cell">
          <FileText size={14} className="employee-documents__name-icon" />
          {row.document_name}
        </span>
      ),
    },
    {
      key: "uploaded_at",
      label: "Uploaded On",
      render: (row) => formatUploadedAt(row.uploaded_at),
    },
    {
      key: "uploaded_by_name",
      label: "Uploaded By",
      render: (row) => row.uploaded_by_name || "-",
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => (
        <DocumentActionsMenu
          document={row}
          isOpen={openMenuId === row.document_id}
          onToggle={() => setOpenMenuId(openMenuId === row.document_id ? null : row.document_id)}
          onClose={() => setOpenMenuId((current) => (current === row.document_id ? null : current))}
          canDelete={canDelete}
          onDownload={handleDownload}
          onDelete={(doc) => setDeleteTarget(doc)}
        />
      ),
    },
  ];

  return (
    <div className="employee-documents">
      <div className="employee-documents__header">
        <div className="employee-documents__heading">
          <span className="employee-documents__icon">
            <FileText size={16} />
          </span>
          <div>
            <p className="employee-documents__title">Documents ({documents.length})</p>
            <p className="employee-documents__subtitle">
              ID proofs, certificates, and other files for this employee
            </p>
          </div>
        </div>

        {canUpload && (
          <button type="button" className="employee-documents__add-button" onClick={openAddModal}>
            <Plus size={16} />
            Add Document
          </button>
        )}
      </div>

      {loadError && <p className="employee-documents__error">{loadError}</p>}
      {actionError && <p className="employee-documents__error">{actionError}</p>}

      {!isLoading && !loadError && documents.length === 0 ? (
        <div className="employee-documents__empty-state">
          <span className="employee-documents__empty-icon">
            <FolderOpen size={22} />
          </span>
          <p className="employee-documents__empty-title">No documents yet</p>
          <p className="employee-documents__empty-message">
            Upload ID proofs, certificates, or other files for this employee to see them here.
          </p>
          {canUpload && (
            <button type="button" className="employee-documents__add-button" onClick={openAddModal}>
              <Plus size={16} />
              Add Document
            </button>
          )}
        </div>
      ) : (
        <div className="employee-documents__table-card">
          <DataTable
            columns={columns}
            rows={documents}
            isLoading={isLoading}
            emptyMessage="No documents uploaded yet"
          />
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title="Add Document">
        <form onSubmit={handleSubmit}>
          <FormInput
            label="Document Name"
            name="document_name"
            value={documentName}
            onChange={setDocumentName}
            required
          />

          <div className="employee-documents__file-field">
            <label htmlFor="document_file" className="employee-documents__file-label">
              File <span className="employee-documents__required">*</span>
            </label>
            <input
              id="document_file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange}
              className="employee-documents__file-input"
            />
            <p className="employee-documents__file-hint">PDF, JPG, JPEG, or PNG. Max size 10 MB.</p>
          </div>

          {formError && <p className="employee-documents__error">{formError}</p>}

          <div className="employee-documents__form-actions">
            <button type="button" className="employee-documents__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="employee-documents__submit" disabled={isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="Delete Document"
        message={`Are you sure you want to delete "${deleteTarget?.document_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default EmployeeDocuments;