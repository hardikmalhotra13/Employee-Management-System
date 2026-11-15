import employeeApiClient from "./employeeApiClient.js";

export async function getMyNotifications() {
  const response = await employeeApiClient.get("/employee/notifications");
  return response.data.data;
}

export async function getMyUnreadNotificationCount() {
  const response = await employeeApiClient.get("/employee/notifications/unread-count");
  return response.data.data;
}

export async function markNotificationRead(id) {
  const response = await employeeApiClient.put(`/employee/notifications/${id}/read`);
  return response.data;
}

export async function markAllNotificationsRead() {
  const response = await employeeApiClient.put("/employee/notifications/mark-all-read");
  return response.data;
}