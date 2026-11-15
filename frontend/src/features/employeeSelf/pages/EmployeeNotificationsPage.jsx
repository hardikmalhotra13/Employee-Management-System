import styles from "../../notifications/pages/AdminNotificationsPage.module.css";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import { NOTIFICATION_TYPE_ICONS } from "../../../components/common/NotificationsBell/NotificationsBell.jsx";
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../../services/api/employeeNotificationApi.js";
import { broadcastNotificationsChanged } from "../../../utils/notificationEvents.js";

/**
 * The employee notification list endpoint (GET /employee/notifications)
 * isn't paginated - it's a flat, capped list (existing backend behavior,
 * unchanged here) - so unlike AdminNotificationsPage this has no page
 * controls. Same backend/API, same visual language, just no pagination
 * to match what the endpoint actually supports.
 */
function EmployeeNotificationsPage() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchNotifications = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getMyNotifications();
      setNotifications(result);
    } catch (err) {
      setLoadError("Failed to load notifications. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleItemClick = async (notification) => {
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.notification_id);
        setNotifications((prev) =>
          prev.map((n) => (n.notification_id === notification.notification_id ? { ...n, is_read: true } : n))
        );
        broadcastNotificationsChanged();
      } catch (err) {
        // ignore - navigation still proceeds
      }
    }

    if (notification.link) {
      navigate(notification.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      broadcastNotificationsChanged();
    } catch (err) {
      setLoadError("Failed to mark notifications as read. Please try again.");
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notifications"
        subtitle="Stay updated with your recent activity."
        actions={
          unreadCount > 0 && (
            <button type="button" className={styles.markAllButton} onClick={handleMarkAllRead}>
              <CheckCheck size={15} />
              Mark all read
            </button>
          )
        }
      />

      {loadError && <p className={styles.error}>{loadError}</p>}

      <div className={styles.card}>
        {isLoading && <p className={styles.state}>Loading...</p>}

        {!isLoading && notifications.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>
              <Bell size={20} />
            </span>
            <p className={styles.emptyTitle}>No notifications yet</p>
            <p className={styles.emptySubtitle}>You'll see important updates here.</p>
          </div>
        )}

        {!isLoading &&
          notifications.map((notification) => {
            const Icon = NOTIFICATION_TYPE_ICONS[notification.type] || Bell;
            return (
              <button
                type="button"
                key={notification.notification_id}
                className={`${styles.row}${notification.is_read ? "" : ` ${styles.rowUnread}`}`}
                onClick={() => handleItemClick(notification)}
              >
                <span className={styles.rowIcon}>
                  <Icon size={17} />
                </span>
                <span className={styles.rowBody}>
                  <span className={styles.rowTitle}>{notification.title}</span>
                  <span className={styles.rowMessage}>{notification.message}</span>
                </span>
                <span className={styles.rowMeta}>
                  <span className={styles.rowTime}>{notification.created_at}</span>
                  {!notification.is_read && <span className={styles.rowDot} />}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}

export default EmployeeNotificationsPage;