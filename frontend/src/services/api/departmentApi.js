import apiClient from "./apiClient.js";

export async function listDepartments({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/departments", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createDepartment(data) {
  const response = await apiClient.post("/departments", data);
  return response.data.data;
}

export async function updateDepartment(id, data) {
  const response = await apiClient.put(`/departments/${id}`, data);
  return response.data.data;
}

export async function archiveDepartment(id) {
  await apiClient.delete(`/departments/${id}`);
}

export async function restoreDepartment(id) {
  const response = await apiClient.put(`/departments/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteDepartment(id) {
  await apiClient.delete(`/departments/${id}/permanent`);
}