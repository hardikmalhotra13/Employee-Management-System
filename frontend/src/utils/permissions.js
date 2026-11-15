export function hasPermission(admin, permissionKey) {
  return admin?.permissions?.includes(permissionKey) ?? false;
}