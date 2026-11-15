import "./SettingsPage.css";
import { useState } from "react";
import { User, Lock, Camera, Upload } from "lucide-react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import UserManagement from "../components/UserManagement.jsx";
import ActivityLog from "../components/ActivityLog.jsx";
import RoleManagement from "../components/RoleManagement.jsx";
import SecuritySettings from "../components/SecuritySettings.jsx";
import useAuth from "../../../hooks/useAuth.js";
import { updateProfile, changePassword } from "../../../services/api/settingsApi.js";
import { validatePasswordStrength } from "../../../utils/validators.js";
import { hasPermission } from "../../../utils/permissions.js";

function SettingsPage() {
  const { admin, token, login } = useAuth();

  const [profileData, setProfileData] = useState({
    name: admin?.name || "",
    email: admin?.email || "",
    phone: admin?.phone || "",
  });
  const [profileErrors, setProfileErrors] = useState({});
  const [profileSubmitError, setProfileSubmitError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState("");

  const [photoPreview, setPhotoPreview] = useState(null);

  const [passwordData, setPasswordData] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordSubmitError, setPasswordSubmitError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();

    const errors = {};
    if (!profileData.name.trim()) errors.name = "Name is required";
    if (!profileData.email.trim()) errors.email = "Email is required";

    setProfileErrors(errors);
    setProfileSubmitError("");
    setProfileSuccess("");

    if (Object.keys(errors).length === 0) {
      try {
        const updatedAdmin = await updateProfile({
          admin_id: admin.admin_id,
          name: profileData.name,
          email: profileData.email,
          phone: profileData.phone,
        });

        login(token, {
          admin_id: updatedAdmin.admin_id,
          name: updatedAdmin.name,
          email: updatedAdmin.email,
          role: admin.role,
          permissions: admin.permissions,
        });

        setProfileSuccess("Profile updated successfully");
      } catch (err) {
        setProfileSubmitError(
          err.response?.data?.message ||
            "Something went wrong. Please try again."
        );
      }
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();

    const errors = {};
    if (!passwordData.current_password) {
      errors.current_password = "Current password is required";
    }
    if (!passwordData.new_password) {
      errors.new_password = "New password is required";
    } else {
      const passwordError = validatePasswordStrength(passwordData.new_password);
      if (passwordError) {
        errors.new_password = passwordError;
      }
    }
    if (
      passwordData.new_password &&
      passwordData.new_password !== passwordData.confirm_password
    ) {
      errors.confirm_password = "Passwords do not match";
    }

    setPasswordErrors(errors);
    setPasswordSubmitError("");
    setPasswordSuccess("");

    if (Object.keys(errors).length === 0) {
      try {
        await changePassword({
          admin_id: admin.admin_id,
          current_password: passwordData.current_password,
          new_password: passwordData.new_password,
        });

        setPasswordData({
          current_password: "",
          new_password: "",
          confirm_password: "",
        });
        setPasswordSuccess("Password changed successfully");
      } catch (err) {
        setPasswordSubmitError(
          err.response?.data?.message ||
            "Something went wrong. Please try again."
        );
      }
    }
  };

  return (
    <div className="settings-page">
      <PageHeader
        title="Settings"
        subtitle="Manage your account, security, and administrator settings"
      />

      <div className="settings-page__grid">
        <form
          className="settings-page__section"
          onSubmit={handleProfileSubmit}
        >
          <div className="settings-page__section-heading">
            <span className="settings-page__section-icon">
              <User size={16} />
            </span>
            <h2 className="settings-page__section-title">
              Admin Profile
            </h2>
          </div>

          <div className="settings-page__identity">
            <p className="settings-page__identity-name">{admin?.name}</p>
            {admin?.role && <span className="settings-page__identity-role">{admin.role}</span>}
          </div>

          <div className="settings-page__photo-row">
            <div className="settings-page__photo-preview">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Profile"
                  className="settings-page__photo-image"
                />
              ) : (
                <span className="settings-page__photo-placeholder">
                  {profileData.name
                    ? profileData.name.charAt(0).toUpperCase()
                    : "A"}
                </span>
              )}

              <span className="settings-page__photo-badge">
                <Camera size={12} />
              </span>
            </div>

            <div>
              <p className="settings-page__photo-label">
                Profile Photo
              </p>
              <p className="settings-page__photo-hint">
                JPG, PNG up to 2MB
              </p>

              <label
                htmlFor="profile_photo"
                className="settings-page__photo-button"
              >
                <Upload size={14} />
                Change Photo
              </label>

              <input
                id="profile_photo"
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="settings-page__photo-input"
              />
            </div>
          </div>

          <FormInput
            label="Name"
            name="name"
            value={profileData.name}
            onChange={(value) =>
              setProfileData({ ...profileData, name: value })
            }
            error={profileErrors.name}
            required
          />

          <FormInput
            label="Email"
            name="email"
            type="email"
            value={profileData.email}
            onChange={(value) =>
              setProfileData({ ...profileData, email: value })
            }
            error={profileErrors.email}
            required
          />

          <FormInput
            label="Phone Number"
            name="phone"
            value={profileData.phone}
            onChange={(value) =>
              setProfileData({ ...profileData, phone: value })
            }
            error={profileErrors.phone}
          />

          {profileSuccess && (
            <p className="settings-page__feedback settings-page__feedback--success">
              {profileSuccess}
            </p>
          )}

          {profileSubmitError && (
            <p className="settings-page__feedback settings-page__feedback--error">
              {profileSubmitError}
            </p>
          )}

          <div className="settings-page__actions">
            <button type="submit" className="settings-page__save">
              Save Profile
            </button>
          </div>
        </form>

        <form
          className="settings-page__section"
          onSubmit={handlePasswordSubmit}
        >
          <div className="settings-page__section-heading">
            <span className="settings-page__section-icon">
              <Lock size={16} />
            </span>
            <h2 className="settings-page__section-title">
              Change Password
            </h2>
          </div>

          <FormInput
            label="Current Password"
            name="current_password"
            type="password"
            value={passwordData.current_password}
            onChange={(value) =>
              setPasswordData({
                ...passwordData,
                current_password: value,
              })
            }
            error={passwordErrors.current_password}
            required
          />

          <FormInput
            label="New Password"
            name="new_password"
            type="password"
            value={passwordData.new_password}
            onChange={(value) =>
              setPasswordData({
                ...passwordData,
                new_password: value,
              })
            }
            error={passwordErrors.new_password}
            required
          />

          <ul className="settings-page__password-requirements">
            <li className={passwordData.new_password.length >= 8 ? "settings-page__requirement-met" : ""}>
              At least 8 characters
            </li>
            <li className={/[A-Za-z]/.test(passwordData.new_password) ? "settings-page__requirement-met" : ""}>
              One letter (A-Z)
            </li>
            <li className={/[0-9]/.test(passwordData.new_password) ? "settings-page__requirement-met" : ""}>
              One number (0-9)
            </li>
            <li className={/[^A-Za-z0-9]/.test(passwordData.new_password) ? "settings-page__requirement-met" : ""}>
              One special character
            </li>
          </ul>

          <FormInput
            label="Confirm Password"
            name="confirm_password"
            type="password"
            value={passwordData.confirm_password}
            onChange={(value) =>
              setPasswordData({
                ...passwordData,
                confirm_password: value,
              })
            }
            error={passwordErrors.confirm_password}
            required
          />

          {passwordSuccess && (
            <p className="settings-page__feedback settings-page__feedback--success">
              {passwordSuccess}
            </p>
          )}

          {passwordSubmitError && (
            <p className="settings-page__feedback settings-page__feedback--error">
              {passwordSubmitError}
            </p>
          )}

          <div className="settings-page__actions">
            <button type="submit" className="settings-page__save">
              Change Password
            </button>
          </div>
        </form>
      </div>

      <SecuritySettings />

      {hasPermission(admin, "users.view") && <UserManagement />}
      {hasPermission(admin, "rbac.manage") && <RoleManagement />}
      {hasPermission(admin, "activity_log.view") && <ActivityLog />}
    </div>
  );
}

export default SettingsPage;