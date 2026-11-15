import apiClient from "./apiClient.js";

export async function listAttendance(params) {
  const response = await apiClient.get("/attendance", { params });
  return response.data.data;
}

export async function createAttendance(data) {
  const response = await apiClient.post("/attendance", data);
  return response.data.data;
}

export async function updateAttendance(id, data) {
  const response = await apiClient.put(`/attendance/${id}`, data);
  return response.data.data;
} 