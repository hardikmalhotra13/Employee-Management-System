import styles from "./NotificationsBell.module.css";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarClock,
  UserPlus,
  UserMinus,
  GraduationCap,
  Laptop2,
  LineChart,
  FileText,
  Sun,
} from "lucide-react";
import { broadcastNotificationsChanged, onNotificationsChanged } from "../../../utils/notificationEvents.js";

// Purely presentational: maps an existing notification `type` string to an
// icon so the dropdown/list reads at a glance. Every key here is one of the
// real event types already written by the backend (see notification_helper.py
// call sites) - this is not a new category system, just an icon lookup.
const TYPE_ICON = {
  leave_submitted: CalendarClock,
  onboarding_started: UserPlus,
  onboarding_completed: UserPlus,
  offboarding_started: UserMinus,
  offboarding_completed: UserMinus,
  training_assigned: GraduationCap,
  training_completed: GraduationCap,
  asset_assigned: Laptop2,
  asset_returned: Laptop2,
  document_uploaded: FileText,
  performance_review_submitted: LineChart,
  holiday_declared: Sun,
  holiday_updated: Sun,
  holiday_cancelled: Sun,
};

export const NOTIFICATION_TYPE_ICONS = TYPE_ICON;

const PREVIEW_PAGE_SIZE = 8;

/**
 * Generic notification bell shell: a trigger button with an unread badge and
 * a dropdown preview panel. Every data operation is passed in as a prop, so
 * this component doesn't know or care whether it's wired to the admin or
 * employee/manager notification feed - only Admin Topbar uses it today, but
 * a future Employee/Manager notification redesign can reuse this same shell
 * by passing its own API functions.
 */
function NotificationsBell({ getNotifications, getUnreadCount, markRead, markAllRead, viewAllPath }) {
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const refreshUnreadCount = () => {
    getUnreadCount()
      .then((data) => setUnreadCount(data.count))
      .catch(() => {});
  };

  useEffect(() => {
    refreshUnreadCount();
  }, []);

  useEffect(() => onNotificationsChanged(refreshUnreadCount), []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);

    if (next) {
      setIsLoading(true);
      getNotifications({ page: 1, pageSize: PREVIEW_PAGE_SIZE })
        .then((data) => setNotifications(data.records))
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }
  };

  const handleItemClick = async (notification) => {
    setIsOpen(false);

    if (!notification.is_read) {
      try {
        await markRead(notification.notification_id);
        refreshUnreadCount();
        broadcastNotificationsChanged();
      } catch (err) {
        // ignore - navigation still proceeds
      }
    }

    if (notification.link) {
      navigate(notification.link);
    }
  };

  const handleMarkAllRead = async (e) => {
    e.stopPropagation();

    try {
      await markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
      broadcastNotificationsChanged();
    } catch (err) {
      // ignore
    }
  };

  const handleViewAll = (e) => {
    e.stopPropagation();
    setIsOpen(false);
    navigate(viewAllPath);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <button type="button" className={styles.trigger} onClick={toggleOpen} aria-label="Notifications">
        <Bell size={18} />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>

      {isOpen && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <p className={styles.panelTitle}>Notifications</p>
            {unreadCount > 0 && (
              <button type="button" className={styles.markAll} onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className={styles.list}>
            {isLoading && <p className={styles.empty}>Loading...</p>}

            {!isLoading && notifications.length === 0 && (
              <p className={styles.empty}>No notifications yet</p>
            )}

            {!isLoading &&
              notifications.map((notification) => {
                const Icon = TYPE_ICON[notification.type] || Bell;
                return (
                  <button
                    type="button"
                    key={notification.notification_id}
                    className={`${styles.item}${notification.is_read ? "" : ` ${styles.itemUnread}`}`}
                    onClick={() => handleItemClick(notification)}
                  >
                    <span className={styles.itemIcon}>
                      <Icon size={15} />
                    </span>
                    <span className={styles.itemBody}>
                      <span className={styles.itemTitle}>{notification.title}</span>
                      <span className={styles.itemMessage}>{notification.message}</span>
                      <span className={styles.itemTime}>{notification.created_at}</span>
                    </span>
                    {!notification.is_read && <span className={styles.itemDot} />}
                  </button>
                );
              })}
          </div>

          {viewAllPath && (
            <button type="button" className={styles.viewAll} onClick={handleViewAll}>
              View all notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationsBell;