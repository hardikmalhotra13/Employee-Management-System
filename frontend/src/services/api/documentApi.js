import apiClient from "./apiClient.js";

export async function listEmployeeDocuments(employeeId) {
  const response = await apiClient.get(`/employees/${employeeId}/documents`);
  return response.data.data;
}

export async function uploadEmployeeDocument(employeeId, documentName, file) {
  const formData = new FormData();
  formData.append("document_name", documentName);
  formData.append("file", file);

  const response = await apiClient.post(`/employees/${employeeId}/documents`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
}

export async function deleteEmployeeDocument(documentId) {
  await apiClient.delete(`/documents/${documentId}`);
}

export async function downloadEmployeeDocument(documentId, downloadName) {
  const response = await apiClient.get(`/documents/${documentId}/download`, {
    responseType: "blob",
  });

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", downloadName || "document");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

// Opens the same document in a new tab for viewing instead of downloading
// it. Reuses the existing download endpoint/response - it must be fetched
// via apiClient (not a plain link) so the Bearer auth header is attached;
// the browser's native PDF/image viewer then renders the resulting blob
// URL inline, regardless of the server's Content-Disposition header.
export async function viewEmployeeDocument(documentId) {
  const viewerWindow = window.open("", "_blank");

  try {
    const response = await apiClient.get(`/documents/${documentId}/download`, {
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));

    if (viewerWindow) {
      viewerWindow.location.href = url;
    }
  } catch (err) {
    if (viewerWindow) viewerWindow.close();
    throw err;
  }
}