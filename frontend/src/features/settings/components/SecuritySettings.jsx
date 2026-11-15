import "./SecuritySettings.css";
import { useState, useEffect } from "react";
import { ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import Modal from "../../../components/common/Modal/Modal.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import RecoveryCodesDisplay from "../../../components/common/RecoveryCodesDisplay.jsx";
import {
  getSecurityStatus,
  startMfaSetup,
  confirmMfaSetup,
  setupRecoveryCodes,
  startMfaReenroll,
  confirmMfaReenroll,
  disableMfa,
} from "../../../services/api/settingsApi.js";
import { startGoogleOAuth } from "../../../utils/googleOAuth.js";

function SecurityStatusBadge({ active, activeLabel, inactiveLabel }) {
  return (
    <span className={`security-settings__status-badge ${active ? "security-settings__status-badge--on" : "security-settings__status-badge--off"}`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

function SecuritySettings() {
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // First-time voluntary enrollment (Read-only, or anyone not yet enrolled)
  const [isSetupModalOpen, setIsSetupModalOpen] = useState(false);
  const [setupSecret, setSetupSecret] = useState("");
  const [setupOtpauthUri, setSetupOtpauthUri] = useState("");
  const [setupQrDataUrl, setSetupQrDataUrl] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState("");

  // One-time backfill for admins who were already enrolled before recovery
  // codes existed - authorized by their current TOTP code, not a recovery
  // code (they still have their authenticator; this isn't a recovery path).
  const [isBackfillModalOpen, setIsBackfillModalOpen] = useState(false);
  const [backfillCode, setBackfillCode] = useState("");
  const [backfillError, setBackfillError] = useState("");

  // Replace authenticator - authorized by one currently-unused recovery
  // code (never just by being logged in), two steps: validate the
  // recovery code, then confirm a new TOTP secret.
  const [reenrollStep, setReenrollStep] = useState(null); // null | "recovery" | "totp"
  const [reenrollRecoveryCode, setReenrollRecoveryCode] = useState("");
  const [reenrollGrantToken, setReenrollGrantToken] = useState("");
  const [reenrollError, setReenrollError] = useState("");
  const [reenrollSecret, setReenrollSecret] = useState("");
  const [reenrollOtpauthUri, setReenrollOtpauthUri] = useState("");
  const [reenrollQrDataUrl, setReenrollQrDataUrl] = useState("");
  const [reenrollCode, setReenrollCode] = useState("");

  // Shared "here are your codes, save them now" modal - shown after any
  // successful (re-)enrollment or the one-time backfill.
  const [newRecoveryCodes, setNewRecoveryCodes] = useState(null);

  // Turn off MFA - same rule as the employee side: being logged in is
  // never enough on its own, a current authenticator code or an unused
  // recovery code is required either way.
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);
  const [disableMethod, setDisableMethod] = useState("totp"); // "totp" | "recovery"
  const [disableCode, setDisableCode] = useState("");
  const [disableRecoveryCode, setDisableRecoveryCode] = useState("");
  const [disableError, setDisableError] = useState("");

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

  useEffect(() => {
    if (!reenrollOtpauthUri) {
      setReenrollQrDataUrl("");
      return;
    }
    QRCode.toDataURL(reenrollOtpauthUri).then(setReenrollQrDataUrl).catch(() => setReenrollQrDataUrl(""));
  }, [reenrollOtpauthUri]);

  const openSetupModal = async () => {
    setSetupCode("");
    setSetupError("");

    try {
      const result = await startMfaSetup();
      setSetupSecret(result.secret);
      setSetupOtpauthUri(result.otpauth_uri);
      setIsSetupModalOpen(true);
    } catch (err) {
      setLoadError("Failed to start MFA setup. Please try again.");
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
      setNewRecoveryCodes(result.data?.recovery_codes || null);
      fetchStatus();
    } catch (err) {
      setSetupError(err.response?.data?.message || "Invalid verification code");
    }
  };

  const openBackfillModal = () => {
    setBackfillCode("");
    setBackfillError("");
    setIsBackfillModalOpen(true);
  };

  const handleConfirmBackfill = async (e) => {
    e.preventDefault();

    if (!backfillCode) {
      setBackfillError("Please enter the 6-digit code from your authenticator app");
      return;
    }

    try {
      const result = await setupRecoveryCodes(backfillCode);
      setIsBackfillModalOpen(false);
      setNewRecoveryCodes(result.data?.recovery_codes || null);
      fetchStatus();
    } catch (err) {
      setBackfillError(err.response?.data?.message || "Invalid verification code");
    }
  };

  const openReenrollModal = async () => {
    setReenrollRecoveryCode("");
    setReenrollCode("");
    setReenrollError("");

    // A recovery-code login that used the admin's LAST unused code
    // leaves a short-lived grant instead - skip straight to the new-
    // authenticator step in that case, since there's no unused code
    // left to submit. A normal TOTP session never has this set, so it
    // still goes through the recovery-code step as before.
    const grantToken = sessionStorage.getItem("mfa_recovery_grant_token");
    if (grantToken) {
      setReenrollGrantToken(grantToken);
      try {
        const result = await startMfaReenroll({ recoveryGrantToken: grantToken });
        setReenrollSecret(result.secret);
        setReenrollOtpauthUri(result.otpauth_uri);
        setReenrollStep("totp");
      } catch (err) {
        // Grant expired/already used - fall back to the normal path.
        sessionStorage.removeItem("mfa_recovery_grant_token");
        setReenrollGrantToken("");
        setReenrollStep("recovery");
      }
      return;
    }

    setReenrollGrantToken("");
    setReenrollStep("recovery");
  };

  const closeReenrollModal = () => {
    setReenrollStep(null);
    setReenrollSecret("");
    setReenrollOtpauthUri("");
  };

  const handleReenrollRecoverySubmit = async (e) => {
    e.preventDefault();

    if (!reenrollRecoveryCode) {
      setReenrollError("Please enter one of your recovery codes");
      return;
    }

    try {
      const result = await startMfaReenroll({ recoveryCode: reenrollRecoveryCode });
      setReenrollSecret(result.secret);
      setReenrollOtpauthUri(result.otpauth_uri);
      setReenrollError("");
      setReenrollStep("totp");
    } catch (err) {
      setReenrollError(err.response?.data?.message || "Invalid or already-used recovery code");
    }
  };

  const handleReenrollConfirmSubmit = async (e) => {
    e.preventDefault();

    if (!reenrollCode) {
      setReenrollError("Please enter the 6-digit code from your authenticator app");
      return;
    }

    try {
      const result = await confirmMfaReenroll({
        recoveryCode: reenrollGrantToken ? undefined : reenrollRecoveryCode,
        recoveryGrantToken: reenrollGrantToken || undefined,
        secret: reenrollSecret,
        code: reenrollCode,
      });
      sessionStorage.removeItem("mfa_recovery_grant_token");
      setReenrollGrantToken("");
      closeReenrollModal();
      setNewRecoveryCodes(result.data?.recovery_codes || null);
      fetchStatus();
    } catch (err) {
      setReenrollError(err.response?.data?.message || "Invalid verification code");
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

  const handleLinkGoogle = () => {
    startGoogleOAuth("link");
  };

  if (isLoading) {
    return (
      <div className="security-settings">
        <p className="security-settings__loading">Loading security settings...</p>
      </div>
    );
  }

  return (
    <div className="security-settings">
      <div className="security-settings__heading">
        <span className="security-settings__icon">
          <ShieldCheck size={16} />
        </span>
        <h2 className="security-settings__title">Security</h2>
      </div>

      {loadError && <p className="security-settings__error">{loadError}</p>}

      {status && (
        <>
          <div className="security-settings__row">
            <div>
              <p className="security-settings__row-title">Two-Factor Authentication</p>
              <p className="security-settings__row-subtitle">
                <SecurityStatusBadge active={status.mfa_enabled} activeLabel="Enabled" inactiveLabel="Not enabled" />
                {status.mfa_required && !status.mfa_enabled && (
                  <span className="security-settings__row-note"> Required for your role</span>
                )}
              </p>
            </div>
            {!status.mfa_enabled && (
              <button type="button" className="security-settings__action-button" onClick={openSetupModal}>
                Enable MFA
              </button>
            )}
            {status.mfa_enabled && !status.has_recovery_codes && (
              <button type="button" className="security-settings__action-button" onClick={openBackfillModal}>
                Set up recovery codes
              </button>
            )}
            {status.mfa_enabled && status.has_recovery_codes && (
              <button type="button" className="security-settings__action-button" onClick={openReenrollModal}>
                Replace authenticator
              </button>
            )}
            {status.mfa_enabled && (
              <button type="button" className="security-settings__action-button" onClick={openDisableModal}>
                Turn off
              </button>
            )}
          </div>

          {status.mfa_enabled && !status.has_recovery_codes && (
            <p className="security-settings__reminder">
              You don't have recovery codes yet. Set them up so you can still sign in if you ever lose your
              authenticator app.
            </p>
          )}

          <div className="security-settings__row">
            <div>
              <p className="security-settings__row-title">Google Account</p>
              <p className="security-settings__row-subtitle">
                <SecurityStatusBadge active={status.google_linked} activeLabel="Linked" inactiveLabel="Not linked" />
              </p>
            </div>
            <button type="button" className="security-settings__action-button" onClick={handleLinkGoogle}>
              {status.google_linked ? "Re-link Google Account" : "Link Google Account"}
            </button>
          </div>
        </>
      )}

      <Modal isOpen={isSetupModalOpen} onClose={() => setIsSetupModalOpen(false)} title="Enable Two-Factor Authentication">
        <form onSubmit={handleConfirmSetup}>
          <p className="security-settings__modal-copy">
            Scan the QR code with your authenticator app (or enter the key manually), then enter the code it
            generates.
          </p>

          {setupQrDataUrl && (
            <img className="security-settings__qr-code" alt="Scan with your authenticator app" src={setupQrDataUrl} />
          )}

          <p className="security-settings__manual-key">
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

          <div className="security-settings__form-actions">
            <button type="button" className="security-settings__cancel" onClick={() => setIsSetupModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="security-settings__save">
              Enable MFA
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={isBackfillModalOpen} onClose={() => setIsBackfillModalOpen(false)} title="Set Up Recovery Codes">
        <form onSubmit={handleConfirmBackfill}>
          <p className="security-settings__modal-copy">
            Enter your current authenticator code to generate 4 recovery codes. Your authenticator itself won't
            change.
          </p>

          <FormInput
            label="Authenticator Code"
            name="backfill_code"
            value={backfillCode}
            onChange={setBackfillCode}
            error={backfillError}
            required
          />

          <div className="security-settings__form-actions">
            <button type="button" className="security-settings__cancel" onClick={() => setIsBackfillModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="security-settings__save">
              Generate Codes
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={reenrollStep !== null} onClose={closeReenrollModal} title="Replace Authenticator">
        {reenrollStep === "recovery" && (
          <form onSubmit={handleReenrollRecoverySubmit}>
            <p className="security-settings__modal-copy">
              Enter one of your unused recovery codes to authorize setting up a new authenticator.
            </p>

            <FormInput
              label="Recovery Code"
              name="reenroll_recovery_code"
              value={reenrollRecoveryCode}
              onChange={setReenrollRecoveryCode}
              error={reenrollError}
              required
            />

            <div className="security-settings__form-actions">
              <button type="button" className="security-settings__cancel" onClick={closeReenrollModal}>
                Cancel
              </button>
              <button type="submit" className="security-settings__save">
                Continue
              </button>
            </div>
          </form>
        )}

        {reenrollStep === "totp" && (
          <form onSubmit={handleReenrollConfirmSubmit}>
            {reenrollGrantToken && (
              <p className="security-settings__modal-copy">
                Authorized using your recent recovery-code sign-in — no additional recovery code needed.
              </p>
            )}
            <p className="security-settings__modal-copy">
              Scan the QR code with your new authenticator app (or enter the key manually), then enter the code
              it generates. This replaces your current authenticator and issues 4 new recovery codes.
            </p>

            {reenrollQrDataUrl && (
              <img
                className="security-settings__qr-code"
                alt="Scan with your authenticator app"
                src={reenrollQrDataUrl}
              />
            )}

            <p className="security-settings__manual-key">
              Manual entry key: <code>{reenrollSecret}</code>
            </p>

            <FormInput
              label="Authenticator Code"
              name="reenroll_code"
              value={reenrollCode}
              onChange={setReenrollCode}
              error={reenrollError}
              required
            />

            <div className="security-settings__form-actions">
              <button type="button" className="security-settings__cancel" onClick={closeReenrollModal}>
                Cancel
              </button>
              <button type="submit" className="security-settings__save">
                Replace Authenticator
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={isDisableModalOpen} onClose={() => setIsDisableModalOpen(false)} title="Turn Off Two-Factor Authentication">
        <form onSubmit={handleConfirmDisable}>
          <p className="security-settings__modal-copy">
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
            className="security-settings__link-button"
            onClick={() => {
              setDisableError("");
              setDisableCode("");
              setDisableRecoveryCode("");
              setDisableMethod(disableMethod === "totp" ? "recovery" : "totp");
            }}
          >
            {disableMethod === "totp" ? "Use a recovery code instead" : "Use my authenticator app instead"}
          </button>

          <div className="security-settings__form-actions">
            <button type="button" className="security-settings__cancel" onClick={() => setIsDisableModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="security-settings__save">
              Turn Off
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={newRecoveryCodes !== null} onClose={() => setNewRecoveryCodes(null)} title="Save Your Recovery Codes">
        {newRecoveryCodes && (
          <>
            <RecoveryCodesDisplay codes={newRecoveryCodes} />
            <div className="security-settings__form-actions">
              <button type="button" className="security-settings__save" onClick={() => setNewRecoveryCodes(null)}>
                I've saved these
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default SecuritySettings;