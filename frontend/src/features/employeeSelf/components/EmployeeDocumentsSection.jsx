import "./EmployeeDocumentsSection.css";
import { useState, useEffect } from "react";
import { Plus, Download, FileText, FolderOpen } from "lucide-react";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import { getMyDocuments, uploadMyDocument, downloadMyDocument } from "../../../services/api/employeeDocumentApi.js";

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

function getExtension(filename) {
  return filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
}

function formatUploadedAt(value) {
  if (!value) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const datePart = date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return `${datePart}, ${timePart}`;
}

/**
 * Self-contained list + upload for the employee's own documents (reuses
 * the existing employeeDocumentApi.js / GET+POST /employee/documents
 * unchanged - no document-specific logic is duplicated here beyond
 * what already lived in MyDocumentsPage.jsx before this extraction).
 * Used both as the standalone My Documents page's body and embedded as
 * a section on My Profile. When `title` is provided this renders its
 * own compact header (for the embedded case); when omitted, only the
 * Upload Document button is shown, since the caller (MyDocumentsPage)
 * already renders a page-level title via PageHeader.
 */
function EmployeeDocumentsSection({ title, subtitle, compact = false }) {
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [documentName, setDocumentName] = useState("");
  const [file, setFile] = useState(null);
  const [formError, setFormError] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const fetchDocuments = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getMyDocuments();
      setDocuments(result);
    } catch (err) {
      setLoadError("Failed to load your documents. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const openUploadModal = () => {
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
      await uploadMyDocument(documentName.trim(), file);
      closeModal();
      fetchDocuments();
    } catch (err) {
      setFormError(err.response?.data?.message || "Failed to upload document. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = (row) => {
    downloadMyDocument(row.document_id, `${row.document_name}.${getExtension(row.file_path)}`);
  };

  const columns = [
    {
      key: "document_name",
      label: "Document Name",
      render: (row) => (
        <span className="employee-documents-section__name-cell">
          <FileText size={14} className="employee-documents-section__name-icon" />
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
        <button
          type="button"
          className="employee-documents-section__download-button"
          onClick={() => handleDownload(row)}
        >
          <Download size={14} />
          Download
        </button>
      ),
    },
  ];

  const uploadButton = (
    <button type="button" className="employee-documents-section__upload-button" onClick={openUploadModal}>
      <Plus size={16} />
      Upload Document
    </button>
  );

  return (
    <div className="employee-documents-section">
      <div className="employee-documents-section__header">
        {title ? (
          <div>
            <h2 className="employee-documents-section__title">
              <FileText size={16} />
              {title}
            </h2>
            {subtitle && <p className="employee-documents-section__subtitle">{subtitle}</p>}
          </div>
        ) : (
          <span />
        )}
        {uploadButton}
      </div>

      {loadError && <p className="employee-documents-section__error">{loadError}</p>}

      {!isLoading && !loadError && documents.length === 0 ? (
        <div className={`employee-documents-section__empty-state${compact ? " employee-documents-section__empty-state--compact" : ""}`}>
          <span className="employee-documents-section__empty-icon">
            <FolderOpen size={22} />
          </span>
          <p className="employee-documents-section__empty-title">No documents yet</p>
          <p className="employee-documents-section__empty-message">
            Upload ID proofs, certificates, or other files to see them here.
          </p>
        </div>
      ) : (
        <div className="employee-documents-section__table-card">
          <DataTable columns={columns} rows={documents} isLoading={isLoading} emptyMessage="No documents yet" />
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title="Upload Document">
        <form onSubmit={handleSubmit}>
          <FormInput label="Document Name" name="document_name" value={documentName} onChange={setDocumentName} required />

          <div className="employee-documents-section__file-field">
            <label htmlFor="document_file" className="employee-documents-section__file-label">
              File <span className="employee-documents-section__required">*</span>
            </label>
            <input
              id="document_file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange}
              className="employee-documents-section__file-input"
            />
            <p className="employee-documents-section__file-hint">PDF, JPG, JPEG, or PNG. Max size 10 MB.</p>
          </div>

          {formError && <p className="employee-documents-section__error">{formError}</p>}

          <div className="employee-documents-section__form-actions">
            <button type="button" className="employee-documents-section__cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="employee-documents-section__submit" disabled={isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default EmployeeDocumentsSection;