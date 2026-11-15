import apiClient from "./apiClient.js";

export async function listOffboardingItems({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/offboarding-items", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createOffboardingItem(data) {
  const response = await apiClient.post("/offboarding-items", data);
  return response.data.data;
}

export async function updateOffboardingItem(id, data) {
  const response = await apiClient.put(`/offboarding-items/${id}`, data);
  return response.data.data;
}

export async function archiveOffboardingItem(id) {
  await apiClient.delete(`/offboarding-items/${id}`);
}

export async function restoreOffboardingItem(id) {
  const response = await apiClient.put(`/offboarding-items/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteOffboardingItem(id) {
  await apiClient.delete(`/offboarding-items/${id}/permanent`);
}

export async function getEmployeeOffboarding(employeeId) {
  const response = await apiClient.get(`/employees/${employeeId}/offboarding`);
  return response.data.data;
}

export async function startEmployeeOffboarding(employeeId, lastWorkingDate) {
  const response = await apiClient.post(`/employees/${employeeId}/offboarding/start`, {
    last_working_date: lastWorkingDate,
  });
  return response.data;
}

export async function updateOffboardingTask(employeeId, taskId, isCompleted) {
  const response = await apiClient.put(`/employees/${employeeId}/offboarding/tasks/${taskId}`, {
    is_completed: isCompleted,
  });
  return response.data.data;
}

export async function completeEmployeeOffboarding(employeeId) {
  const response = await apiClient.put(`/employees/${employeeId}/offboarding/complete`);
  return response.data;
}