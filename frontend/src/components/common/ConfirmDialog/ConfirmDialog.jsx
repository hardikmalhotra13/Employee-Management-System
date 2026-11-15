import Modal from "../Modal/Modal.jsx";
import styles from "./ConfirmDialog.module.css";

function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel, confirmLabel = "Delete" }) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title}>
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.confirm} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export default ConfirmDialog;