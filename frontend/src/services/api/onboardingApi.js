import apiClient from "./apiClient.js";

export async function listOnboardingItems({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/onboarding-items", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createOnboardingItem(data) {
  const response = await apiClient.post("/onboarding-items", data);
  return response.data.data;
}

export async function updateOnboardingItem(id, data) {
  const response = await apiClient.put(`/onboarding-items/${id}`, data);
  return response.data.data;
}

export async function archiveOnboardingItem(id) {
  await apiClient.delete(`/onboarding-items/${id}`);
}

export async function restoreOnboardingItem(id) {
  const response = await apiClient.put(`/onboarding-items/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteOnboardingItem(id) {
  await apiClient.delete(`/onboarding-items/${id}/permanent`);
}

export async function getEmployeeOnboarding(employeeId) {
  const response = await apiClient.get(`/employees/${employeeId}/onboarding`);
  return response.data.data;
}

export async function startEmployeeOnboarding(employeeId) {
  const response = await apiClient.post(`/employees/${employeeId}/onboarding/start`);
  return response.data;
}

export async function updateOnboardingTask(employeeId, taskId, isCompleted) {
  const response = await apiClient.put(`/employees/${employeeId}/onboarding/tasks/${taskId}`, {
    is_completed: isCompleted,
  });
  return response.data.data;
}

export async function completeEmployeeOnboarding(employeeId) {
  const response = await apiClient.put(`/employees/${employeeId}/onboarding/complete`);
  return response.data;
}