import apiClient from "./apiClient.js";

export async function listLeaveRequests(params) {
  const response = await apiClient.get("/leave", { params });
  return response.data.data;
}

export async function approveLeaveRequest(id, reason) {
  const response = await apiClient.put(`/leave/${id}/approve`, { reason });
  return response.data.data;
}

export async function rejectLeaveRequest(id, reason) {
  const response = await apiClient.put(`/leave/${id}/reject`, { reason });
  return response.data.data;
}

export async function getLeaveQuotas() {
  const response = await apiClient.get("/leave/quotas");
  return response.data.data;
}

export async function updateLeaveQuotas(data) {
  const response = await apiClient.put("/leave/quotas", data);
  return response.data.data;
}