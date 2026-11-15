import apiClient from "./apiClient.js";

export async function listTrainingPrograms({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/training-programs", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createTrainingProgram(data) {
  const response = await apiClient.post("/training-programs", data);
  return response.data.data;
}

export async function updateTrainingProgram(id, data) {
  const response = await apiClient.put(`/training-programs/${id}`, data);
  return response.data.data;
}

export async function archiveTrainingProgram(id) {
  await apiClient.delete(`/training-programs/${id}`);
}

export async function restoreTrainingProgram(id) {
  const response = await apiClient.put(`/training-programs/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteTrainingProgram(id) {
  await apiClient.delete(`/training-programs/${id}/permanent`);
}

export async function assignTrainingToAll(programId, dueDate) {
  const response = await apiClient.post(`/training-programs/${programId}/assign-all`, { due_date: dueDate });
  return response.data;
}

export async function getEmployeeTrainingRecords(employeeId) {
  const response = await apiClient.get(`/employees/${employeeId}/training-records`);
  return response.data.data;
}

export async function createEmployeeTrainingRecord(employeeId, data) {
  const response = await apiClient.post(`/employees/${employeeId}/training-records`, data);
  return response.data.data;
}

export async function completeTrainingRecord(recordId, data) {
  const response = await apiClient.put(`/training-records/${recordId}/complete`, data);
  return response.data.data;
}