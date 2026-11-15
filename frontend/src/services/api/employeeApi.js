import apiClient from "./apiClient.js";

export async function listEmployees(params) {
  const response = await apiClient.get("/employees", { params });
  return response.data.data;
}

export async function getEmployee(id) {
  const response = await apiClient.get(`/employees/${id}`);
  return response.data.data;
}

export async function getDirectReports(id) {
  const response = await apiClient.get(`/employees/${id}/direct-reports`);
  return response.data.data;
}

export async function getManagerChain(id) {
  const response = await apiClient.get(`/employees/${id}/manager-chain`);
  return response.data.data;
}

export async function createEmployee(data) {
  const response = await apiClient.post("/employees", data);
  return response.data.data;
}

export async function updateEmployee(id, data) {
  const response = await apiClient.put(`/employees/${id}`, data);
  return response.data.data;
}

export async function archiveEmployee(id) {
  await apiClient.delete(`/employees/${id}`);
}

export async function restoreEmployee(id) {
  const response = await apiClient.put(`/employees/${id}/restore`);
  return response.data.data;
}

export async function inviteEmployee(id) {
  const response = await apiClient.post(`/employees/${id}/invite`);
  return response.data.message;
}

export async function permanentlyDeleteEmployee(id) {
  await apiClient.delete(`/employees/${id}/permanent`);
}

export async function exportEmployees(params) {
  let response;
  try {
    response = await apiClient.get("/employees/export", {
      params,
      responseType: "blob",
    });
  } catch (err) {
    // responseType "blob" means error responses arrive as a Blob too,
    // not parsed JSON, so the real backend message has to be read out of it.
    if (err.response?.data instanceof Blob) {
      let message = "Failed to export employees. Please try again.";
      try {
        const text = await err.response.data.text();
        const parsed = JSON.parse(text);
        if (parsed.message) {
          message = parsed.message;
        }
      } catch (parseErr) {
        // fall back to the generic message above
      }
      throw new Error(message);
    }
    throw err;
  }

  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", "employees.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}