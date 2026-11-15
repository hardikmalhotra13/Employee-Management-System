import apiClient from "./apiClient.js";

export async function listRoster(params) {
  const response = await apiClient.get("/roster", { params });
  return response.data.data;
}

export async function createRosterEntry(data) {
  const response = await apiClient.post("/roster", data);
  return response.data.data;
}

export async function updateRosterEntry(id, data) {
  const response = await apiClient.put(`/roster/${id}`, data);
  return response.data.data;
}

export async function deleteRosterEntry(id) {
  const response = await apiClient.delete(`/roster/${id}`);
  return response.data;
}

export async function bulkAssignRoster(data) {
  const response = await apiClient.post("/roster/bulk", data);
  return response.data;
}