import apiClient from "./apiClient.js";

export async function listShifts({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/shifts", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createShift(data) {
  const response = await apiClient.post("/shifts", data);
  return response.data.data;
}

export async function updateShift(id, data) {
  const response = await apiClient.put(`/shifts/${id}`, data);
  return response.data.data;
}

export async function archiveShift(id) {
  await apiClient.delete(`/shifts/${id}`);
}

export async function restoreShift(id) {
  const response = await apiClient.put(`/shifts/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteShift(id) {
  await apiClient.delete(`/shifts/${id}/permanent`);
}