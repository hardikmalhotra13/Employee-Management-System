"""
File storage for uploaded documents, certificates and profile photos.

Routes never touch the disk or the bucket directly - they call save_file,
get_file and delete_file with a "key". The key is the same relative path that
is stored in the database (for example "employee_documents/12/<uuid>_cv.pdf"),
so database rows work with either backend.

Backends (chosen with STORAGE_BACKEND in the environment):
  local - files live under UPLOAD_FOLDER on this machine (local development).
  s3    - files live in a private S3-compatible bucket (production, e.g.
          Supabase Storage). Needed on hosts such as Render whose disk is wiped
          on every restart.

Files are never served straight from the bucket. Downloads always go through a
Flask route, which checks the caller's permissions first.

Keys are validated on every call: they must be relative, use "/" separators and
contain no empty, "." or ".." segments, so a key can never point outside the
upload folder (or bucket prefix) even if one were ever built from bad data.
"""

import io
import mimetypes
import os
import stat

from config import settings


class StorageError(OSError):
    """
    The storage backend could not save, read or delete a file. Subclasses
    OSError so the existing "except OSError" cleanup blocks in the routes also
    handle bucket failures. If it reaches the app it becomes a JSON 503
    (see the errorhandler in app.py).
    """


_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
}

class _KeyOutsideStorage(StorageError):
    """
    A key that resolves outside the upload folder (for example through a
    symlink). Kept separate from other StorageErrors on purpose: reads treat it
    as "no such file", whereas a real filesystem error must never be mistaken
    for a missing file.
    """


_MAX_KEY_LENGTH = 500

_s3_client = None


def _is_valid_key(key):
    if not isinstance(key, str) or not key or len(key) > _MAX_KEY_LENGTH:
        return False
    if "\x00" in key or "\\" in key or ":" in key or key.startswith("/"):
        return False
    return all(segment not in ("", ".", "..") for segment in key.split("/"))


def _require_valid_key(key):
    if not _is_valid_key(key):
        raise StorageError("Invalid storage key")


def get_content_type(key):
    extension = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    return _CONTENT_TYPES.get(extension) or mimetypes.guess_type(key)[0] or "application/octet-stream"


def save_file(key, file):
    """Stores an uploaded werkzeug FileStorage under the given key."""
    _require_valid_key(key)
    if settings.STORAGE_BACKEND == "s3":
        _s3_save(key, file)
    else:
        _local_save(key, file)


def get_file(key):
    """
    Returns (BytesIO, content_type) for the stored file, or None if there is
    no such file (an invalid key is treated as "no such file"). Files are small
    (10 MB document limit, 2 MB photo limit), so reading the whole file into
    memory is fine.
    """
    if not _is_valid_key(key):
        return None

    if settings.STORAGE_BACKEND == "s3":
        data = _s3_read(key)
    else:
        data = _local_read(key)

    if data is None:
        return None
    return io.BytesIO(data), get_content_type(key)


def delete_file(key):
    """Deletes the stored file. Deleting a file that does not exist is not an error."""
    _require_valid_key(key)
    if settings.STORAGE_BACKEND == "s3":
        _s3_delete(key)
    else:
        _local_delete(key)


# ---------------------------------------------------------------------
# Local disk backend
# ---------------------------------------------------------------------

def _local_path(key):
    """Full path for a key, guaranteed to be inside UPLOAD_FOLDER."""
    try:
        base = os.path.realpath(settings.UPLOAD_FOLDER)
        full_path = os.path.realpath(os.path.join(base, key))
    except (OSError, ValueError) as e:       # e.g. a relative UPLOAD_FOLDER and a deleted working directory
        raise StorageError(f"Could not resolve the storage location: {e}") from e
    try:
        inside = os.path.commonpath([base, full_path]) == base and full_path != base
    except ValueError:                       # e.g. different drives on Windows
        inside = False
    if not inside:
        raise _KeyOutsideStorage("Invalid storage key")
    return full_path


def _local_is_file(full_path):
    """
    Like os.path.isfile(), but only a genuinely absent path (or a directory or
    other non-file in its place) counts as "not a file". os.path.isfile() also
    answers False for permission and I/O errors, which would make an existing
    file look missing; here those raise StorageError instead.
    """
    try:
        return stat.S_ISREG(os.stat(full_path).st_mode)
    except (FileNotFoundError, NotADirectoryError):
        return False
    except OSError as e:                     # permission denied, I/O error, ...
        raise StorageError(f"Could not access file in storage: {e}") from e


def _local_save(key, file):
    full_path = _local_path(key)
    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        file.save(full_path)
    except OSError as e:                     # permission denied, disk full, ...
        raise StorageError(f"Could not save file to storage: {e}") from e


def _local_read(key):
    try:
        full_path = _local_path(key)
    except _KeyOutsideStorage:               # resolves outside the upload folder
        return None
    if not _local_is_file(full_path):
        return None
    try:
        with open(full_path, "rb") as stored_file:
            return stored_file.read()
    except FileNotFoundError:                # removed between the check and the read
        return None
    except OSError as e:                     # permission denied, I/O error, ...
        raise StorageError(f"Could not read file from storage: {e}") from e


def _local_delete(key):
    full_path = _local_path(key)
    try:
        if _local_is_file(full_path):
            os.remove(full_path)
    except FileNotFoundError:                # already gone: nothing to delete
        pass
    except OSError as e:                     # permission denied, I/O error, ...
        raise StorageError(f"Could not delete file from storage: {e}") from e


# ---------------------------------------------------------------------
# S3-compatible bucket backend (boto3)
# ---------------------------------------------------------------------

def _get_s3_client():
    """Builds the boto3 client once. Any problem becomes a StorageError."""
    global _s3_client
    if _s3_client is not None:
        return _s3_client

    if not (settings.S3_ENDPOINT_URL and settings.S3_BUCKET
            and settings.S3_ACCESS_KEY_ID and settings.S3_SECRET_ACCESS_KEY):
        raise StorageError("S3 storage is not configured")

    try:
        # boto3 is imported here so local development (STORAGE_BACKEND=local)
        # works without it. requirements.txt pins boto3 below 1.36 on purpose:
        # from 1.36 it sends extra checksum headers by default, which some
        # S3-compatible services reject. Re-test uploads before upgrading it.
        import boto3
        from botocore.config import Config

        _s3_client = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,
            region_name=settings.S3_REGION or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 3},
                connect_timeout=5,
                read_timeout=30,
            ),
        )
    except Exception as e:
        raise StorageError(f"S3 storage could not be initialised: {e}") from e

    return _s3_client


def _s3_save(key, file):
    client = _get_s3_client()
    try:
        client.upload_fileobj(
            file.stream, settings.S3_BUCKET, key,
            ExtraArgs={"ContentType": get_content_type(key)}
        )
    except Exception as e:
        raise StorageError(f"Could not save file to storage: {e}") from e


def _s3_read(key):
    client = _get_s3_client()
    try:
        response = client.get_object(Bucket=settings.S3_BUCKET, Key=key)
        return response["Body"].read()
    except Exception as e:
        # A missing object is "not found", anything else is a storage failure.
        # (ClientError carries the HTTP status / S3 error code.)
        details = getattr(e, "response", None)
        if isinstance(details, dict):
            status = details.get("ResponseMetadata", {}).get("HTTPStatusCode")
            code = details.get("Error", {}).get("Code", "")
            if status == 404 or code in ("NoSuchKey", "404", "NotFound"):
                return None
        raise StorageError(f"Could not read file from storage: {e}") from e


def _s3_delete(key):
    client = _get_s3_client()
    try:
        client.delete_object(Bucket=settings.S3_BUCKET, Key=key)
    except Exception as e:
        raise StorageError(f"Could not delete file from storage: {e}") from e