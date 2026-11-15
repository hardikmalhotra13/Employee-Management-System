import "./EmployeeListPage.css";
import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Plus, Eye, Pencil, Archive, ArchiveRestore, Download, Trash2, Send, Users, MoreHorizontal } from "lucide-react";
import routePaths from "../../../routes/routePaths.js";
import PageHeader from "../../../components/common/PageHeader.jsx";
import SearchBar from "../../../components/common/SearchBar.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import Pagination from "../../../components/common/Pagination.jsx";
import StatusBadge from "../../../components/common/StatusBadge.jsx";
import ConfirmDialog from "../../../components/common/ConfirmDialog/ConfirmDialog.jsx";
import EmployeeFilters from "../components/EmployeeFilters.jsx";
import {
  listEmployees,
  archiveEmployee,
  restoreEmployee,
  permanentlyDeleteEmployee,
  exportEmployees,
  inviteEmployee,
} from "../../../services/api/employeeApi.js";
import { listDepartments } from "../../../services/api/departmentApi.js";
import { listRoles } from "../../../services/api/roleApi.js";
import useAuth from "../../../hooks/useAuth.js";
import { hasPermission } from "../../../utils/permissions.js";

// Compact "..." row-actions menu. Presentation only - the items passed in
// carry the exact same handlers/permissions the inline buttons used.
function RowActionsMenu({ items }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="employee-list-page__menu" ref={containerRef}>
      <button
        type="button"
        className="employee-list-page__menu-trigger"
        onClick={() => setIsOpen((prev) => !prev)}
        title="More actions"
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="employee-list-page__menu-dropdown">
          {items.map(({ label, icon: Icon, onClick, variant }) => (
            <button
              key={label}
              type="button"
              className={`employee-list-page__menu-item${variant ? ` employee-list-page__menu-item--${variant}` : ""}`}
              onClick={() => {
                setIsOpen(false);
                onClick();
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 10;

function EmployeeListPage() {
  const navigate = useNavigate();
  const { admin } = useAuth();
  const canCreate = hasPermission(admin, "employees.create");
  const canUpdate = hasPermission(admin, "employees.update");
  const canArchive = hasPermission(admin, "employees.archive");
  const canRestore = hasPermission(admin, "employees.restore");
  const canPermanentlyDelete = hasPermission(admin, "employees.delete");
  const canInvite = hasPermission(admin, "employees.update");

  const [employees, setEmployees] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [departments, setDepartments] = useState([]);
  const [roles, setRoles] = useState([]);

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState(null);
  const [archiveError, setArchiveError] = useState("");

  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState(null);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  // Set by EmployeeFormPage on navigate() after a create/update, e.g.
  // "Employee created successfully" - shown once, same style as the
  // invite success message, then cleared so a refresh/back doesn't
  // redisplay it.
  const location = useLocation();
  useEffect(() => {
    if (location.state?.successMessage) {
      setInviteSuccess(location.state.successMessage);
      setTimeout(() => setInviteSuccess(""), 4000);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  const handleRestore = async (employee) => {
    try {
      await restoreEmployee(employee.employee_id);
      setArchiveError("");
      fetchEmployees();
    } catch (err) {
      setArchiveError(err.response?.data?.message || "Failed to restore employee. Please try again.");
    }
  };

  const handleInvite = async (employee) => {
    setInviteError("");
    setInviteSuccess("");

    try {
      const message = await inviteEmployee(employee.employee_id);
      setInviteSuccess(message || `Invite sent to ${employee.first_name} ${employee.last_name}`);
      setTimeout(() => setInviteSuccess(""), 4000);
    } catch (err) {
      setInviteError(err.response?.data?.message || "Failed to send invite. Please try again.");
    }
  };

  const handleConfirmPermanentDelete = async () => {
    try {
      await permanentlyDeleteEmployee(permanentDeleteTarget.employee_id);
      setPermanentDeleteTarget(null);
      setArchiveError("");
      fetchEmployees();
    } catch (err) {
      setPermanentDeleteTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to permanently delete employee. Please try again.");
    }
  };

  const columns = [
    { key: "employee_code", label: "Employee Code" },
    {
      key: "name",
      label: "Name",
      render: (row) => `${row.first_name} ${row.last_name}`,
    },
    { key: "department_name", label: "Department" },
    { key: "role_name", label: "Role" },
    { key: "shift_name", label: "Shift" },
    {
      key: "status",
      label: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "is_archived",
      label: "Archived",
      render: (row) => (row.is_archived ? <span className="employee-list-page__archived-badge">Archived</span> : null),
    },
    {
      key: "actions",
      label: "Actions",
      render: (row) => {
        if (row.is_archived) {
          const items = [
            { label: "View", icon: Eye, onClick: () => navigate(routePaths.EMPLOYEE_VIEW(row.employee_id)) },
          ];
          if (canRestore) {
            items.push({ label: "Restore", icon: ArchiveRestore, onClick: () => handleRestore(row), variant: "restore" });
          }
          if (canPermanentlyDelete) {
            items.push({
              label: "Permanently Delete",
              icon: Trash2,
              onClick: () => setPermanentDeleteTarget(row),
              variant: "danger",
            });
          }

          return <RowActionsMenu items={items} />;
        }

        const items = [
          { label: "View", icon: Eye, onClick: () => navigate(routePaths.EMPLOYEE_VIEW(row.employee_id)) },
        ];
        if (canUpdate) {
          items.push({ label: "Edit", icon: Pencil, onClick: () => navigate(routePaths.EMPLOYEE_EDIT(row.employee_id)) });
        }
        if (canInvite) {
          items.push({ label: "Invite", icon: Send, onClick: () => handleInvite(row) });
        }
        if (canArchive) {
          items.push({ label: "Archive", icon: Archive, onClick: () => setArchiveTarget(row), variant: "danger" });
        }

        return <RowActionsMenu items={items} />;
      },
    },
  ];

  useEffect(() => {
    listDepartments({ page: 1, pageSize: 100 }).then((result) => setDepartments(result.records));
    listRoles({ page: 1, pageSize: 100 }).then((result) => setRoles(result.records));
  }, []);

  const fetchEmployees = async () => {
    setIsLoading(true);
    setLoadError("");

    try {
      const result = await listEmployees({
        search,
        department_id: department,
        role_id: role,
        status,
        page,
        pageSize: PAGE_SIZE,
        include_archived: showArchived,
      });
      setEmployees(result.records);
      setTotal(result.total);
    } catch (err) {
      setLoadError("Failed to load employees. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [search, department, role, status, page, showArchived]);

  const handleExport = async () => {
    setIsExporting(true);
    setExportError("");

    try {
      await exportEmployees({
        search,
        department_id: department,
        role_id: role,
        status,
        include_archived: showArchived,
      });
    } catch (err) {
      setExportError(err.message || "Failed to export employees. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await archiveEmployee(archiveTarget.employee_id);
      setArchiveTarget(null);
      setArchiveError("");
      fetchEmployees();
    } catch (err) {
      setArchiveTarget(null);
      setArchiveError(err.response?.data?.message || "Failed to archive employee. Please try again.");
    }
  };

  const handleSearchChange = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleDepartmentChange = (value) => {
    setDepartment(value);
    setPage(1);
  };

  const handleRoleChange = (value) => {
    setRole(value);
    setPage(1);
  };

  const handleStatusChange = (value) => {
    setStatus(value);
    setPage(1);
  };

  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="employee-list-page">
      <PageHeader
        title="Employees"
        subtitle="Manage employee records across the organization"
        actions={
          canCreate && (
            <Link to={routePaths.EMPLOYEE_NEW} className="employee-list-page__add-button">
              <Plus size={16} />
              Add employee
            </Link>
          )
        }
      />

      <div className="employee-list-page__panel">
        <div className="employee-list-page__panel-row employee-list-page__panel-row--search">
          <SearchBar
            value={search}
            onChange={handleSearchChange}
            placeholder="Search by code, name, email, or phone..."
          />
          {hasPermission(admin, "employees.export") && (
            <button
              type="button"
              className="employee-list-page__export-button"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download size={15} />
              {isExporting ? "Exporting..." : "Export"}
            </button>
          )}
        </div>

        <div className="employee-list-page__panel-row employee-list-page__panel-row--filters">
          <EmployeeFilters
            departments={departments}
            roles={roles}
            department={department}
            role={role}
            status={status}
            onDepartmentChange={handleDepartmentChange}
            onRoleChange={handleRoleChange}
            onStatusChange={handleStatusChange}
          />

          <label className="employee-list-page__archived-toggle">
            <span className="employee-list-page__switch">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              <span className="employee-list-page__switch-track" />
            </span>
            Show archived
          </label>
        </div>
      </div>

      {loadError && <p className="employee-list-page__delete-error">{loadError}</p>}
      {archiveError && <p className="employee-list-page__delete-error">{archiveError}</p>}
      {exportError && <p className="employee-list-page__delete-error">{exportError}</p>}
      {inviteError && <p className="employee-list-page__delete-error">{inviteError}</p>}
      {inviteSuccess && <p className="employee-list-page__success-message">{inviteSuccess}</p>}

      <div className="employee-list-page__table-card">
        <div className="employee-list-page__table-card-header">
          <div className="employee-list-page__table-card-heading">
            <span className="employee-list-page__table-card-icon">
              <Users size={15} />
            </span>
            <div>
              <p className="employee-list-page__table-card-title">Employee directory</p>
              <p className="employee-list-page__table-card-subtitle">
                {total === 0
                  ? "No employees to show"
                  : `Showing ${rangeStart}-${rangeEnd} of ${total} employees`}
              </p>
            </div>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={employees}
          isLoading={isLoading}
          emptyMessage="No employees found"
        />
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPageChange={setPage}
      />

      <ConfirmDialog
        isOpen={archiveTarget !== null}
        title="Archive Employee"
        message={`Are you sure you want to archive ${archiveTarget?.first_name} ${archiveTarget?.last_name}? It will be hidden from the active list and can be restored later.`}
        confirmLabel="Archive"
        onConfirm={handleConfirmArchive}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        isOpen={permanentDeleteTarget !== null}
        title="Permanently Delete Employee"
        message={`Are you sure you want to permanently delete ${permanentDeleteTarget?.first_name} ${permanentDeleteTarget?.last_name}? This action cannot be undone and the record cannot be restored afterward.`}
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmPermanentDelete}
        onCancel={() => setPermanentDeleteTarget(null)}
      />
    </div>
  );
}

export default EmployeeListPage;