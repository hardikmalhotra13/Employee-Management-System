import styles from "./AdminNotificationsPage.module.css";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import { NOTIFICATION_TYPE_ICONS } from "../../../components/common/NotificationsBell/NotificationsBell.jsx";
import {
  getMyAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
} from "../../../services/api/adminNotificationApi.js";

const PAGE_SIZE = 10;

function AdminNotificationsPage() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const fetchNotifications = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getMyAdminNotifications({ page, pageSize: PAGE_SIZE });
      setNotifications(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load notifications. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [page]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleItemClick = async (notification) => {
    if (!notification.is_read) {
      try {
        await markAdminNotificationRead(notification.notification_id);
        setNotifications((prev) =>
          prev.map((n) => (n.notification_id === notification.notification_id ? { ...n, is_read: true } : n))
        );
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
      await markAllAdminNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      setLoadError("Failed to mark notifications as read. Please try again.");
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Notifications"
        subtitle="Stay updated with important activity across the organization."
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
            <p className={styles.emptySubtitle}>You'll see important administrative activity here.</p>
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

      {!isLoading && total > 0 && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      )}
    </div>
  );
}

export default AdminNotificationsPage;