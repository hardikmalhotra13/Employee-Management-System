import apiClient from "./apiClient.js";

export async function listRoles({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/roles", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createRole(data) {
  const response = await apiClient.post("/roles", data);
  return response.data.data;
}

export async function updateRole(id, data) {
  const response = await apiClient.put(`/roles/${id}`, data);
  return response.data.data;
}

export async function archiveRole(id) {
  await apiClient.delete(`/roles/${id}`);
}

export async function restoreRole(id) {
  const response = await apiClient.put(`/roles/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteRole(id) {
  await apiClient.delete(`/roles/${id}/permanent`);
}