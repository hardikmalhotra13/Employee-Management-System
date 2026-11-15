import "./NotificationBell.css";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  getMyNotifications,
  getMyUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../../services/api/employeeNotificationApi.js";

function NotificationBell() {
  const navigate = useNavigate();
  const containerRef = useRef(null);

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const fetchUnreadCount = () => {
    getMyUnreadNotificationCount()
      .then((data) => setUnreadCount(data.count))
      .catch(() => {});
  };

  useEffect(() => {
    fetchUnreadCount();
  }, []);

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
      getMyNotifications()
        .then((data) => setNotifications(data))
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }
  };

  const handleNotificationClick = async (notification) => {
    setIsOpen(false);

    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.notification_id);
        fetchUnreadCount();
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
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (err) {
      // ignore
    }
  };

  return (
    <div className="notification-bell" ref={containerRef}>
      <button
        type="button"
        className="notification-bell__trigger"
        onClick={toggleOpen}
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && <span className="notification-bell__badge">{unreadCount}</span>}
      </button>

      {isOpen && (
        <div className="notification-bell__panel">
          <div className="notification-bell__panel-header">
            <p className="notification-bell__panel-title">Notifications</p>
            {unreadCount > 0 && (
              <button type="button" className="notification-bell__mark-all" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notification-bell__list">
            {isLoading && <p className="notification-bell__empty">Loading...</p>}

            {!isLoading && notifications.length === 0 && (
              <p className="notification-bell__empty">No notifications yet</p>
            )}

            {!isLoading &&
              notifications.map((notification) => (
                <button
                  type="button"
                  key={notification.notification_id}
                  className={`notification-bell__item${
                    notification.is_read ? "" : " notification-bell__item--unread"
                  }`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <p className="notification-bell__item-title">{notification.title}</p>
                  <p className="notification-bell__item-message">{notification.message}</p>
                  <p className="notification-bell__item-time">{notification.created_at}</p>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;