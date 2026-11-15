// The unread badge in the topbar bell only refreshes its own count after
// its own internal actions (opening its dropdown, its own mark-read
// clicks). Nothing told it when a notification was marked read somewhere
// else (the Dashboard's Recent Notifications card, the full Notifications
// page) - so the badge looked "stuck" until the bell's own dropdown was
// used. This is a minimal native-event bridge (no state library) so any
// of those places can say "a notification changed" and the bell can react.
const NOTIFICATIONS_CHANGED_EVENT = "employee-notifications-changed";

export function broadcastNotificationsChanged() {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

export function onNotificationsChanged(handler) {
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handler);
}