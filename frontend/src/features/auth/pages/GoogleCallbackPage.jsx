import "./GoogleCallbackPage.css";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AdminAuthShell from "../components/AdminAuthShell.jsx";
import useAuth from "../../../hooks/useAuth.js";
import useEmployeeAuth from "../../../hooks/useEmployeeAuth.js";
import routePaths from "../../../routes/routePaths.js";
import employeeRoutePaths from "../../../routes/employeeRoutePaths.js";
import { googleLogin } from "../../../services/api/authApi.js";
import { linkGoogleAccount } from "../../../services/api/settingsApi.js";
import { employeeGoogleLogin, linkEmployeeGoogleAccount } from "../../../services/api/employeeSelfApi.js";
import { consumeGoogleOAuthSession, peekGoogleOAuthPurpose } from "../../../utils/googleOAuth.js";

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

function GoogleCallbackPage() {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { login: employeeLogin } = useEmployeeAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const hasRun = useRef(false);

  // Read (not consume) the stored purpose up front, so an Employee Portal
  // attempt gets the employee theme and falls back to the employee login /
  // settings - including for failures before the session is verified.
  // The real verification still happens in consumeGoogleOAuthSession below.
  const [purposeHint] = useState(() => peekGoogleOAuthPurpose());
  const isEmployeeFlow = purposeHint === "employee-login" || purposeHint === "employee-link";
  const isEmployeeLink = purposeHint === "employee-link";

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const run = async () => {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      const googleError = searchParams.get("error");

      if (googleError) {
        setError("Google sign-in was cancelled or denied.");
        return;
      }

      if (!code || !state) {
        setError("Invalid Google sign-in response. Please try again.");
        return;
      }

      const session = consumeGoogleOAuthSession(state);
      if (!session) {
        setError("This sign-in attempt could not be verified. Please try again.");
        return;
      }

      try {
        // Employee Portal flows first - the admin code below treats any
        // purpose other than "link" as a login.
        if (session.purpose === "employee-link") {
          await linkEmployeeGoogleAccount(code, session.codeVerifier, session.nonce);
          navigate(employeeRoutePaths.SETTINGS);
          return;
        }

        if (session.purpose === "employee-login") {
          const result = await employeeGoogleLogin(code, session.codeVerifier, session.nonce);

          // Same 2-Step Verification step as password login: hand the
          // pending challenge to the employee login page to finish it.
          if (result.mfa_required) {
            navigate(employeeRoutePaths.LOGIN, { state: { mfaChallenge: result } });
            return;
          }

          const { employee_id, email } = decodeJwtPayload(result.token);
          employeeLogin(result.token, { employee_id, email });
          navigate(employeeRoutePaths.DASHBOARD);
          return;
        }

        if (session.purpose === "link") {
          await linkGoogleAccount(code, session.codeVerifier, session.nonce);
          navigate(routePaths.SETTINGS, { state: { googleLinked: true } });
          return;
        }

        const result = await googleLogin(code, session.codeVerifier, session.nonce);

        if (result.mfa_required || result.mfa_setup_required) {
          navigate(routePaths.LOGIN, { state: { mfaChallenge: result } });
          return;
        }

        const { admin_id, email } = decodeJwtPayload(result.token);
        login(result.token, {
          admin_id,
          name: result.name,
          email,
          role: result.role,
          permissions: result.permissions,
        });
        navigate(routePaths.DASHBOARD);
      } catch (err) {
        setError(err.response?.data?.message || "Something went wrong. Please try again.");
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AdminAuthShell variant={isEmployeeFlow ? "employee" : "admin"}>
      {error ? (
        <>
          <div className="admin-auth__card-header">
            <h1 className="admin-auth__card-title">
              {isEmployeeLink ? "Couldn't link Google account" : "Sign-in failed"}
            </h1>
          </div>
          <p className="admin-auth__status-message admin-auth__status-message--error">{error}</p>
          <button
            type="button"
            className="admin-auth__submit"
            onClick={() =>
              navigate(
                isEmployeeLink ? employeeRoutePaths.SETTINGS : isEmployeeFlow ? employeeRoutePaths.LOGIN : routePaths.LOGIN
              )
            }
          >
            {isEmployeeLink ? "Back to settings" : "Back to login"}
          </button>
        </>
      ) : (
        <div className="google-callback-page__loading">
          <span className="google-callback-page__spinner" />
          <p className="admin-auth__status-message" style={{ margin: 0 }}>Signing you in...</p>
        </div>
      )}
    </AdminAuthShell>
  );
}

export default GoogleCallbackPage;