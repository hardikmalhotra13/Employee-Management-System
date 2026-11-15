import apiClient from "./apiClient.js";

export async function listAdminRoles() {
  const response = await apiClient.get("/admin-roles");
  return response.data.data;
}

export async function getAdminRole(id) {
  const response = await apiClient.get(`/admin-roles/${id}`);
  return response.data.data;
}

export async function listPermissions() {
  const response = await apiClient.get("/permissions");
  return response.data.data;
}

export async function createAdminRole(data) {
  const response = await apiClient.post("/admin-roles", data);
  return response.data.data;
}

export async function updateAdminRole(id, data) {
  const response = await apiClient.put(`/admin-roles/${id}`, data);
  return response.data.data;
}

export async function deleteAdminRole(id) {
  await apiClient.delete(`/admin-roles/${id}`);
}