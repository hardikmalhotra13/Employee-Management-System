import apiClient from "./apiClient.js";

export async function listActivityLog({ page, pageSize }) {
  const response = await apiClient.get("/settings/activity-log", { params: { page, pageSize } });
  return response.data.data;
}