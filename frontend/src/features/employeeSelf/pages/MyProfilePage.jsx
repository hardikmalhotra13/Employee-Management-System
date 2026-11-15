import "./MyProfilePage.css";
import { useState, useEffect, useRef } from "react";
import { Camera, Trash2, Pencil, User, Mail, Phone, MapPin, Briefcase } from "lucide-react";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import FormInput from "../../../components/common/FormInput/FormInput.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import EmployeeDocumentsSection from "../components/EmployeeDocumentsSection.jsx";
import {
  getMyProfile,
  updateMyProfile,
  uploadMyPhoto,
  removeMyPhoto,
  fetchMyPhotoObjectUrl,
} from "../../../services/api/employeeSelfApi.js";

const ALLOWED_PHOTO_EXTENSIONS = ["jpg", "jpeg", "png"];
const MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024;

function getExtension(filename) {
  return filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
}

function formatDate(value) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function getInitials(firstName, lastName) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
}

function MyProfilePage() {
  const fileInputRef = useRef(null);

  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [photoUrl, setPhotoUrl] = useState(null);
  const [isPhotoBusy, setIsPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [isRemoveConfirmOpen, setIsRemoveConfirmOpen] = useState(false);

  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [contactErrors, setContactErrors] = useState({});
  const [isSavingContact, setIsSavingContact] = useState(false);

  const loadPhoto = async (hasPhoto) => {
    if (!hasPhoto) {
      setPhotoUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    try {
      const url = await fetchMyPhotoObjectUrl();
      setPhotoUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return url;
      });
    } catch (err) {
      setPhotoUrl(null);
    }
  };

  const loadProfile = async () => {
    const data = await getMyProfile();
    setProfile(data);
    await loadPhoto(!!data.profile_photo);
    return data;
  };

  useEffect(() => {
    setIsLoading(true);
    setLoadError("");

    loadProfile()
      .catch(() => setLoadError("Could not load your profile. Please try again."))
      .finally(() => setIsLoading(false));

    return () => {
      setPhotoUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return prev;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhotoButtonClick = () => {
    setPhotoError("");
    fileInputRef.current?.click();
  };

  const handlePhotoFileChange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;

    setPhotoError("");

    if (!ALLOWED_PHOTO_EXTENSIONS.includes(getExtension(file.name))) {
      setPhotoError("Only JPG, JPEG, and PNG files are allowed");
      return;
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setPhotoError("Photo size cannot be greater than 2 MB");
      return;
    }

    setIsPhotoBusy(true);
    try {
      await uploadMyPhoto(file);
      await loadProfile();
    } catch (err) {
      setPhotoError(err.response?.data?.message || "Failed to upload photo. Please try again.");
    } finally {
      setIsPhotoBusy(false);
    }
  };

  const handleConfirmRemovePhoto = async () => {
    setIsPhotoBusy(true);
    setPhotoError("");
    try {
      await removeMyPhoto();
      await loadProfile();
    } catch (err) {
      setPhotoError(err.response?.data?.message || "Failed to remove photo. Please try again.");
    } finally {
      setIsPhotoBusy(false);
      setIsRemoveConfirmOpen(false);
    }
  };

  const handleEditClick = () => {
    setEditPhone(profile.phone || "");
    setEditAddress(profile.address || "");
    setContactErrors({});
    setIsEditingContact(true);
  };

  const handleCancelEdit = () => {
    setIsEditingContact(false);
    setContactErrors({});
  };

  const handleSaveEdit = async () => {
    const errors = {};
    const phone = editPhone.trim();
    if (!phone) {
      errors.phone = "Phone number is required";
    } else if (!/^\d{10}$/.test(phone)) {
      errors.phone = "Phone number must be exactly 10 digits";
    }

    if (Object.keys(errors).length > 0) {
      setContactErrors(errors);
      return;
    }

    setIsSavingContact(true);
    setContactErrors({});
    try {
      await updateMyProfile(phone, editAddress.trim());
      await loadProfile();
      setIsEditingContact(false);
    } catch (err) {
      const message = err.response?.data?.message || "Failed to update profile. Please try again.";
      setContactErrors({ phone: message });
    } finally {
      setIsSavingContact(false);
    }
  };

  if (isLoading) {
    return (
      <div className="my-profile-page">
        <p className="my-profile-page__state">Loading your profile...</p>
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="my-profile-page">
        <p className="my-profile-page__state">{loadError || "Profile not found"}</p>
      </div>
    );
  }

  return (
    <div className="my-profile-page">
      <div className="my-profile-page__header">
        <div className="my-profile-page__avatar-wrap">
          <div className="my-profile-page__avatar">
            {photoUrl ? (
              <img src={photoUrl} alt="Profile" className="my-profile-page__avatar-img" />
            ) : (
              <span className="my-profile-page__avatar-initials">
                {getInitials(profile.first_name, profile.last_name) || <User size={26} />}
              </span>
            )}
            <button
              type="button"
              className="my-profile-page__avatar-edit"
              onClick={handlePhotoButtonClick}
              disabled={isPhotoBusy}
              aria-label="Change photo"
            >
              <Camera size={14} />
            </button>
          </div>
          {photoUrl && (
            <button
              type="button"
              className="my-profile-page__avatar-remove"
              onClick={() => setIsRemoveConfirmOpen(true)}
              disabled={isPhotoBusy}
              aria-label="Remove photo"
            >
              <Trash2 size={13} />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png"
            className="my-profile-page__file-input"
            onChange={handlePhotoFileChange}
          />
        </div>

        <div className="my-profile-page__identity">
          <div className="my-profile-page__name-row">
            <h1 className="my-profile-page__name">
              {profile.first_name} {profile.last_name}
            </h1>
            <StatusBadge status={profile.status} />
          </div>
          <p className="my-profile-page__meta">
            {profile.employee_code}
            <span className="my-profile-page__meta-dot">•</span>
            {profile.role_name}
            <span className="my-profile-page__meta-dot">•</span>
            {profile.department_name}
          </p>
          {photoError && <p className="my-profile-page__photo-error">{photoError}</p>}
        </div>

        {!isEditingContact && (
          <button type="button" className="my-profile-page__edit-button" onClick={handleEditClick}>
            <Pencil size={14} />
            Edit Profile
          </button>
        )}
      </div>

      <div className="my-profile-page__grid">
        <div className="my-profile-page__card">
          <div className="my-profile-page__card-header">
            <span className="my-profile-page__card-icon">
              <User size={15} />
            </span>
            <div>
              <h2 className="my-profile-page__card-title">Personal Information</h2>
              <p className="my-profile-page__card-subtitle">Your basic personal details.</p>
            </div>
          </div>
          <div className="my-profile-page__field-grid">
            <div className="my-profile-page__field">
              <p className="my-profile-page__label">Full Name</p>
              <p className="my-profile-page__value">
                {profile.first_name} {profile.last_name}
              </p>
            </div>
            <div className="my-profile-page__field">
              <p className="my-profile-page__label">Date of Birth</p>
              <p className="my-profile-page__value">{formatDate(profile.date_of_birth)}</p>
            </div>
            <div className="my-profile-page__field">
              <p className="my-profile-page__label">Gender</p>
              <p className="my-profile-page__value">{profile.gender}</p>
            </div>
          </div>
        </div>

        <div className="my-profile-page__card">
          <div className="my-profile-page__card-header">
            <span className="my-profile-page__card-icon">
              <Mail size={15} />
            </span>
            <div>
              <h2 className="my-profile-page__card-title">Contact Information</h2>
              <p className="my-profile-page__card-subtitle">
                {isEditingContact
                  ? "Update your phone and address."
                  : "Your contact details. You can update your phone and address."}
              </p>
            </div>
          </div>

          <div className="my-profile-page__field-grid">
            <div className="my-profile-page__field">
              <p className="my-profile-page__label">Email Address</p>
              <p className="my-profile-page__value">{profile.email}</p>
            </div>

            {isEditingContact ? (
              <>
                <div className="my-profile-page__editable-field">
                  <FormInput
                    label="Phone Number"
                    name="phone"
                    value={editPhone}
                    onChange={setEditPhone}
                    error={contactErrors.phone}
                    required
                  />
                </div>
                <div className="my-profile-page__editable-field my-profile-page__field--full">
                  <FormInput label="Address" name="address" value={editAddress} onChange={setEditAddress} />
                </div>
              </>
            ) : (
              <>
                <div className="my-profile-page__field">
                  <p className="my-profile-page__label">
                    <Phone size={11} /> Phone Number
                  </p>
                  <p className="my-profile-page__value">{profile.phone}</p>
                </div>
                <div className="my-profile-page__field my-profile-page__field--full">
                  <p className="my-profile-page__label">
                    <MapPin size={11} /> Address
                  </p>
                  <p className="my-profile-page__value">{profile.address || "-"}</p>
                </div>
              </>
            )}
          </div>

          {isEditingContact && (
            <div className="my-profile-page__form-actions">
              <button
                type="button"
                className="my-profile-page__cancel"
                onClick={handleCancelEdit}
                disabled={isSavingContact}
              >
                Cancel
              </button>
              <button
                type="button"
                className="my-profile-page__save"
                onClick={handleSaveEdit}
                disabled={isSavingContact}
              >
                {isSavingContact ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="my-profile-page__card">
        <div className="my-profile-page__card-header">
          <span className="my-profile-page__card-icon">
            <Briefcase size={15} />
          </span>
          <div>
            <h2 className="my-profile-page__card-title">Employment Information</h2>
            <p className="my-profile-page__card-subtitle">Your employment details (managed by HR).</p>
          </div>
        </div>
        <div className="my-profile-page__field-grid my-profile-page__field-grid--employment">
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Employee Code</p>
            <p className="my-profile-page__value">{profile.employee_code}</p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Department</p>
            <p className="my-profile-page__value">{profile.department_name}</p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Role</p>
            <p className="my-profile-page__value">{profile.role_name}</p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Grade</p>
            <p className="my-profile-page__value">{profile.grade_name}</p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Shift</p>
            <p className="my-profile-page__value">{profile.shift_name}</p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Joining Date</p>
            <p className="my-profile-page__value">{formatDate(profile.joining_date)}</p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Reports To</p>
            <p className="my-profile-page__value">
              {profile.manager_first_name ? `${profile.manager_first_name} ${profile.manager_last_name}` : "-"}
            </p>
          </div>
          <div className="my-profile-page__field">
            <p className="my-profile-page__label">Employment Status</p>
            <StatusBadge status={profile.status} />
          </div>
        </div>
      </div>

      <div className="my-profile-page__card">
        <EmployeeDocumentsSection
          title="My Documents"
          subtitle="Documents you have uploaded. These are visible to HR/Admin."
          compact
        />
      </div>

      <ConfirmDialog
        isOpen={isRemoveConfirmOpen}
        title="Remove Profile Photo"
        message="Are you sure you want to remove your profile photo?"
        confirmLabel="Remove"
        onConfirm={handleConfirmRemovePhoto}
        onCancel={() => setIsRemoveConfirmOpen(false)}
      />
    </div>
  );
}

export default MyProfilePage;