import employeeApiClient from "./employeeApiClient.js";

export async function getMyDocuments() {
  const response = await employeeApiClient.get("/employee/documents");
  return response.data.data;
}

export async function uploadMyDocument(documentName, file) {
  const formData = new FormData();
  formData.append("document_name", documentName);
  formData.append("file", file);

  const response = await employeeApiClient.post("/employee/documents", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
}

export async function downloadMyDocument(documentId, downloadName) {
  const response = await employeeApiClient.get(`/employee/documents/${documentId}/download`, {
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