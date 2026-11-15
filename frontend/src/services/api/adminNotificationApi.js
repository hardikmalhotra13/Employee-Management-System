import apiClient from "./apiClient.js";

export async function getMyAdminNotifications({ page = 1, pageSize = 10 } = {}) {
  const response = await apiClient.get("/admin/notifications", {
    params: { page, pageSize },
  });
  return response.data.data;
}

export async function getMyAdminUnreadNotificationCount() {
  const response = await apiClient.get("/admin/notifications/unread-count");
  return response.data.data;
}

export async function markAdminNotificationRead(id) {
  const response = await apiClient.put(`/admin/notifications/${id}/read`);
  return response.data;
}

export async function markAllAdminNotificationsRead() {
  const response = await apiClient.put("/admin/notifications/mark-all-read");
  return response.data;
}