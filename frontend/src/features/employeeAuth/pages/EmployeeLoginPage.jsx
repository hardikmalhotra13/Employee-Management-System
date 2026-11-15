import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Mail, LockKeyhole, ShieldCheck, KeyRound, ArrowRight, Eye, EyeOff } from "lucide-react";
import AdminAuthShell from "../../auth/components/AdminAuthShell.jsx";
import useEmployeeAuth from "../../../hooks/useEmployeeAuth.js";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import {
  login as loginApi,
  verifyMfa,
  verifyMfaRecovery,
} from "../../../services/api/employeeSelfApi.js";
import { startGoogleOAuth } from "../../../utils/googleOAuth.js";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.97v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.41 5.41 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.97A9 9 0 0 0 0 9c0 1.45.35 2.83.97 4.03l2.98-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .97 4.97l2.98 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

function EmployeeLoginPage() {
  const { login } = useEmployeeAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only used for employees who turned 2-Step Verification on themselves.
  const [pendingToken, setPendingToken] = useState("");
  const [verifyMethod, setVerifyMethod] = useState("totp"); // "totp" | "recovery"
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");

  // Google sign-in for an employee with 2-Step Verification on lands here
  // with the pending challenge (GoogleCallbackPage hands it over in router
  // state) so the same code / recovery-code step finishes the login.
  useEffect(() => {
    const challenge = location.state?.mfaChallenge;
    if (challenge?.mfa_required && challenge.pending_token) {
      setPendingToken(challenge.pending_token);
      window.history.replaceState({}, document.title);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishLogin = (token) => {
    const { employee_id, email: tokenEmail } = decodeJwtPayload(token);
    // The typed email wins as before; the token's is only the fallback for
    // the Google -> 2-Step path, where nothing was typed.
    login(token, { employee_id, email: email || tokenEmail });
    navigate(employeeRoutePaths.DASHBOARD);
  };

  const handleGoogleSignIn = () => {
    setError("");
    startGoogleOAuth("employee-login");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const result = await loginApi(email, password);

      if (result.mfa_required) {
        setPendingToken(result.pending_token);
        return;
      }

      finishLogin(result.token);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMfaSubmit = async (e) => {
    e.preventDefault();

    const useRecovery = verifyMethod === "recovery";
    if (useRecovery ? !recoveryCode.trim() : !mfaCode.trim()) {
      setError(useRecovery ? "Please enter a recovery code" : "Please enter the 6-digit code");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const result = useRecovery
        ? await verifyMfaRecovery(pendingToken, recoveryCode.trim())
        : await verifyMfa(pendingToken, mfaCode.trim());
      finishLogin(result.token);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackToLogin = () => {
    setPendingToken("");
    setVerifyMethod("totp");
    setMfaCode("");
    setRecoveryCode("");
    setPassword("");
    setError("");
  };

  if (pendingToken) {
    return (
      <AdminAuthShell variant="employee">
        <div className="admin-auth__card-header">
          <h1 className="admin-auth__card-title">2-Step Verification</h1>
          <p className="admin-auth__card-subtitle">
            {verifyMethod === "recovery"
              ? "Enter one of your unused recovery codes"
              : "Enter the 6-digit code from your authenticator app"}
          </p>
        </div>

        <form className="admin-auth__form" onSubmit={handleMfaSubmit} noValidate>
          {verifyMethod === "totp" ? (
            <div className="admin-auth__field">
              <label htmlFor="mfa-code" className="admin-auth__label">Authenticator Code</label>
              <div className="admin-auth__input-wrap">
                <ShieldCheck size={16} className="admin-auth__input-icon" />
                <input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  className="admin-auth__input"
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="admin-auth__field">
              <label htmlFor="recovery-code" className="admin-auth__label">Recovery Code</label>
              <div className="admin-auth__input-wrap">
                <KeyRound size={16} className="admin-auth__input-icon" />
                <input
                  id="recovery-code"
                  type="text"
                  placeholder="XXXXXXXX"
                  className="admin-auth__input"
                  autoFocus
                  autoCapitalize="characters"
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                />
              </div>
            </div>
          )}

          {error && <p className="admin-auth__error">{error}</p>}

          <button type="submit" className="admin-auth__submit" disabled={isSubmitting}>
            {isSubmitting ? "Verifying..." : "Verify"}
          </button>

          <button
            type="button"
            className="admin-auth__link-button"
            onClick={() => {
              setError("");
              setMfaCode("");
              setRecoveryCode("");
              setVerifyMethod(verifyMethod === "totp" ? "recovery" : "totp");
            }}
          >
            {verifyMethod === "totp" ? "Use a recovery code instead" : "Use my authenticator app instead"}
          </button>

          <button type="button" className="admin-auth__link-button" onClick={handleBackToLogin}>
            Back to sign in
          </button>
        </form>
      </AdminAuthShell>
    );
  }

  return (
    <AdminAuthShell variant="employee">
      <div className="admin-auth__card-header">
        <h1 className="admin-auth__card-title">Welcome back</h1>
        <p className="admin-auth__card-subtitle">Sign in to your employee account</p>
      </div>

      <form className="admin-auth__form" onSubmit={handleSubmit} noValidate>
        <div className="admin-auth__field">
          <label htmlFor="email" className="admin-auth__label">Email address</label>
          <div className="admin-auth__input-wrap">
            <Mail size={16} className="admin-auth__input-icon" />
            <input
              id="email"
              type="email"
              placeholder="name@company.com"
              className="admin-auth__input"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="admin-auth__field">
          <label htmlFor="password" className="admin-auth__label">Password</label>
          <div className="admin-auth__input-wrap">
            <LockKeyhole size={16} className="admin-auth__input-icon" />
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              className="admin-auth__input admin-auth__input--with-toggle"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="admin-auth__input-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && <p className="admin-auth__error">{error}</p>}

        <Link
          to={employeeRoutePaths.FORGOT_PASSWORD}
          className="admin-auth__link"
          style={{ marginTop: 0, marginBottom: 16, textAlign: "right" }}
        >
          Forgot password?
        </Link>

        <button type="submit" className="admin-auth__submit" disabled={isSubmitting}>
          {isSubmitting ? (
            "Signing in..."
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              Sign in <ArrowRight size={15} />
            </span>
          )}
        </button>

        <div className="admin-auth__divider">or</div>

        <button type="button" className="admin-auth__google-button" onClick={handleGoogleSignIn}>
          <GoogleIcon />
          Continue with Google
        </button>
      </form>

      <p className="admin-auth__footnote">
        <ShieldCheck size={13} /> Protected by multi-factor authentication
      </p>
    </AdminAuthShell>
  );
}

export default EmployeeLoginPage;