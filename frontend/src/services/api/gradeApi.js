import apiClient from "./apiClient.js";

export async function listGrades({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/grades", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createGrade(data) {
  const response = await apiClient.post("/grades", data);
  return response.data.data;
}

export async function updateGrade(id, data) {
  const response = await apiClient.put(`/grades/${id}`, data);
  return response.data.data;
}

export async function archiveGrade(id) {
  await apiClient.delete(`/grades/${id}`);
}

export async function restoreGrade(id) {
  const response = await apiClient.put(`/grades/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteGrade(id) {
  await apiClient.delete(`/grades/${id}/permanent`);
}