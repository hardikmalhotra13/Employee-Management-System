import apiClient from "./apiClient.js";

export async function listAssetTypes({ page, pageSize, includeArchived }) {
  const response = await apiClient.get("/asset-types", {
    params: { page, pageSize, include_archived: includeArchived },
  });
  return response.data.data;
}

export async function createAssetType(data) {
  const response = await apiClient.post("/asset-types", data);
  return response.data.data;
}

export async function updateAssetType(id, data) {
  const response = await apiClient.put(`/asset-types/${id}`, data);
  return response.data.data;
}

export async function archiveAssetType(id) {
  const response = await apiClient.delete(`/asset-types/${id}`);
  return response.data;
}

export async function restoreAssetType(id) {
  const response = await apiClient.put(`/asset-types/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteAssetType(id) {
  const response = await apiClient.delete(`/asset-types/${id}/permanent`);
  return response.data;
}

export async function listAssets(params) {
  const response = await apiClient.get("/assets", { params });
  return response.data.data;
}

export async function getAsset(id) {
  const response = await apiClient.get(`/assets/${id}`);
  return response.data.data;
}

export async function getAssetHistory(id) {
  const response = await apiClient.get(`/assets/${id}/history`);
  return response.data.data;
}

export async function createAsset(data) {
  const response = await apiClient.post("/assets", data);
  return response.data.data;
}

export async function updateAsset(id, data) {
  const response = await apiClient.put(`/assets/${id}`, data);
  return response.data.data;
}

export async function archiveAsset(id) {
  const response = await apiClient.delete(`/assets/${id}`);
  return response.data;
}

export async function restoreAsset(id) {
  const response = await apiClient.put(`/assets/${id}/restore`);
  return response.data.data;
}

export async function permanentlyDeleteAsset(id) {
  const response = await apiClient.delete(`/assets/${id}/permanent`);
  return response.data;
}

export async function assignAsset(id, data) {
  const response = await apiClient.post(`/assets/${id}/assign`, data);
  return response.data.data;
}

export async function returnAsset(id, data) {
  const response = await apiClient.post(`/assets/${id}/return`, data);
  return response.data.data;
}

export async function bulkAssignAssets(assignments) {
  const response = await apiClient.post("/assets/bulk-assign", { assignments });
  return response.data;
}