import "./EmployeeSettingsPage.css";
import { useState, useEffect } from "react";
import { ShieldCheck, LockKeyhole } from "lucide-react";
import QRCode from "qrcode";
import PageHeader from "../../../components/common/PageHeader.jsx";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import RecoveryCodesDisplay from "../../../components/common/RecoveryCodesDisplay.jsx";
import {
  getSecurityStatus,
  startMfaSetup,
  confirmMfaSetup,
  disableMfa,
  changePassword,
} from "../../../services/api/employeeSelfApi.js";
import { startGoogleOAuth } from "../../../utils/googleOAuth.js";

function StatusBadge({ active, activeLabel = "Enabled", inactiveLabel = "Not enabled" }) {
  return (
    <span className={`employee-settings__status-badge ${active ? "employee-settings__status-badge--on" : "employee-settings__status-badge--off"}`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

function EmployeeSettingsPage() {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Enable 2-Step Verification
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [setupSecret, setSetupSecret] = useState("");
  const [setupOtpauthUri, setSetupOtpauthUri] = useState("");
  const [setupQrDataUrl, setSetupQrDataUrl] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState("");

  // Disable 2-Step Verification - requires a current authenticator code
  // or an unused recovery code, never just a click.
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);
  const [disableMethod, setDisableMethod] = useState("totp"); // "totp" | "recovery"
  const [disableCode, setDisableCode] = useState("");
  const [disableRecoveryCode, setDisableRecoveryCode] = useState("");
  const [disableError, setDisableError] = useState("");

  // Shown once, right after enabling
  const [newRecoveryCodes, setNewRecoveryCodes] = useState(null);

  // Change Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const fetchStatus = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await getSecurityStatus();
      setStatus(result);
    } catch (err) {
      setLoadError("Failed to load security settings. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (!setupOtpauthUri) {
      setSetupQrDataUrl("");
      return;
    }
    QRCode.toDataURL(setupOtpauthUri).then(setSetupQrDataUrl).catch(() => setSetupQrDataUrl(""));
  }, [setupOtpauthUri]);

  const openSetupModal = async () => {
    setSetupCode("");
    setSetupError("");

    try {
      const result = await startMfaSetup();
      setSetupSecret(result.secret);
      setSetupOtpauthUri(result.otpauth_uri);
      setIsSetupModalOpen(true);
    } catch (err) {
      setLoadError("Failed to start 2-Step Verification setup. Please try again.");
    }
  };

  const handleConfirmSetup = async (e) => {
    e.preventDefault();

    if (!setupCode) {
      setSetupError("Please enter the 6-digit code from your authenticator app");
      return;
    }

    try {
      const result = await confirmMfaSetup(setupSecret, setupCode);
      setIsSetupModalOpen(false);
      setNewRecoveryCodes(result.recovery_codes || null);
      fetchStatus();
    } catch (err) {
      setSetupError(err.response?.data?.message || "Invalid verification code");
    }
  };

  const openDisableModal = () => {
    setDisableMethod("totp");
    setDisableCode("");
    setDisableRecoveryCode("");
    setDisableError("");
    setIsDisableModalOpen(true);
  };

  const handleConfirmDisable = async (e) => {
    e.preventDefault();

    const useRecovery = disableMethod === "recovery";
    if (useRecovery ? !disableRecoveryCode.trim() : !disableCode.trim()) {
      setDisableError(useRecovery ? "Please enter a recovery code" : "Please enter the 6-digit code");
      return;
    }

    try {
      await disableMfa(
        useRecovery ? { recovery_code: disableRecoveryCode.trim() } : { code: disableCode.trim() }
      );
      setIsDisableModalOpen(false);
      fetchStatus();
    } catch (err) {
      setDisableError(err.response?.data?.message || "Invalid code");
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();

    const errors = {};
    if (!currentPassword) errors.current_password = "Current password is required";
    if (!newPassword) errors.new_password = "New password is required";
    if (newPassword && confirmPassword && newPassword !== confirmPassword) {
      errors.confirm_password = "Passwords do not match";
    }

    setPasswordErrors(errors);
    setPasswordSuccess("");
    if (Object.keys(errors).length) return;

    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password changed successfully");
      setTimeout(() => setPasswordSuccess(""), 4000);
    } catch (err) {
      const data = err.response?.data;
      setPasswordErrors(data?.errors || { current_password: data?.message || "Something went wrong" });
    }
  };

  return (
    <div className="employee-settings-page">
      <PageHeader title="Settings" subtitle="Manage your account security" />

      <div className="employee-settings__card">
        <div className="employee-settings__heading">
          <span className="employee-settings__icon">
            <ShieldCheck size={16} />
          </span>
          <h2 className="employee-settings__title">Security</h2>
        </div>

        {loadError && <p className="employee-settings__error">{loadError}</p>}

        {isLoading ? (
          <p className="employee-settings__loading">Loading security settings...</p>
        ) : (
          status && (
            <>
              <div className="employee-settings__row">
                <div>
                  <p className="employee-settings__row-title">2-Step Verification</p>
                  <p className="employee-settings__row-subtitle">
                    <StatusBadge active={status.mfa_enabled} />
                  </p>
                </div>
                {status.mfa_enabled ? (
                  <button type="button" className="employee-settings__action-button" onClick={openDisableModal}>
                    Turn off
                  </button>
                ) : (
                  <button type="button" className="employee-settings__action-button" onClick={openSetupModal}>
                    Turn on
                  </button>
                )}
              </div>

              <div className="employee-settings__row">
                <div>
                  <p className="employee-settings__row-title">Google Account</p>
                  <p className="employee-settings__row-subtitle">
                    <StatusBadge active={status.google_linked} activeLabel="Linked" inactiveLabel="Not linked" />
                  </p>
                </div>
                <button
                  type="button"
                  className="employee-settings__action-button"
                  onClick={() => startGoogleOAuth("employee-link")}
                >
                  {status.google_linked ? "Re-link Google Account" : "Link Google Account"}
                </button>
              </div>

              <div className="employee-settings__row employee-settings__row--form">
                <div className="employee-settings__row-header">
                  <span className="employee-settings__icon">
                    <LockKeyhole size={16} />
                  </span>
                  <p className="employee-settings__row-title">Change Password</p>
                </div>

                <form className="employee-settings__password-form" onSubmit={handleChangePassword} noValidate>
                  <FormInput
                    label="Current Password"
                    name="current_password"
                    type="password"
                    value={currentPassword}
                    onChange={setCurrentPassword}
                    error={passwordErrors.current_password}
                    required
                  />
                  <FormInput
                    label="New Password"
                    name="new_password"
                    type="password"
                    value={newPassword}
                    onChange={setNewPassword}
                    error={passwordErrors.new_password}
                    required
                  />
                  <FormInput
                    label="Confirm New Password"
                    name="confirm_password"
                    type="password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    error={passwordErrors.confirm_password}
                    required
                  />

                  {passwordSuccess && <p className="employee-settings__success">{passwordSuccess}</p>}

                  <div className="employee-settings__form-actions">
                    <button type="submit" className="employee-settings__save">
                      Change Password
                    </button>
                  </div>
                </form>
              </div>
            </>
          )
        )}
      </div>

      <Modal isOpen={isSetupModalOpen} onClose={() => setIsSetupModalOpen(false)} title="Turn On 2-Step Verification">
        <form onSubmit={handleConfirmSetup}>
          <p className="employee-settings__modal-copy">
            Scan the QR code with your authenticator app (or enter the key manually), then enter the code it
            generates.
          </p>

          {setupQrDataUrl && (
            <img className="employee-settings__qr-code" alt="Scan with your authenticator app" src={setupQrDataUrl} />
          )}

          <p className="employee-settings__manual-key">
            Manual entry key: <code>{setupSecret}</code>
          </p>

          <FormInput
            label="Authenticator Code"
            name="code"
            value={setupCode}
            onChange={setSetupCode}
            error={setupError}
            required
          />

          <div className="employee-settings__form-actions">
            <button type="button" className="employee-settings__cancel" onClick={() => setIsSetupModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="employee-settings__save">
              Turn On
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isDisableModalOpen} onClose={() => setIsDisableModalOpen(false)} title="Turn Off 2-Step Verification">
        <form onSubmit={handleConfirmDisable}>
          <p className="employee-settings__modal-copy">
            {disableMethod === "recovery"
              ? "Enter one of your unused recovery codes to confirm."
              : "Enter the 6-digit code from your authenticator app to confirm."}
          </p>

          {disableMethod === "totp" ? (
            <FormInput
              label="Authenticator Code"
              name="disable_code"
              value={disableCode}
              onChange={setDisableCode}
              error={disableError}
              required
            />
          ) : (
            <FormInput
              label="Recovery Code"
              name="disable_recovery_code"
              value={disableRecoveryCode}
              onChange={setDisableRecoveryCode}
              error={disableError}
              required
            />
          )}

          <button
            type="button"
            className="employee-settings__link-button"
            onClick={() => {
              setDisableError("");
              setDisableCode("");
              setDisableRecoveryCode("");
              setDisableMethod(disableMethod === "totp" ? "recovery" : "totp");
            }}
          >
            {disableMethod === "totp" ? "Use a recovery code instead" : "Use my authenticator app instead"}
          </button>

          <div className="employee-settings__form-actions">
            <button type="button" className="employee-settings__cancel" onClick={() => setIsDisableModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="employee-settings__save">
              Turn Off
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={newRecoveryCodes !== null} onClose={() => setNewRecoveryCodes(null)} title="Save Your Recovery Codes">
        {newRecoveryCodes && (
          <>
            <RecoveryCodesDisplay codes={newRecoveryCodes} />
            <div className="employee-settings__form-actions">
              <button type="button" className="employee-settings__save" onClick={() => setNewRecoveryCodes(null)}>
                I've saved these
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default EmployeeSettingsPage;