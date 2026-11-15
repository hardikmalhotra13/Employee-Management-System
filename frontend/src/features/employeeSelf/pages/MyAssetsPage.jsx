
import "./MyAssetsPage.css";
import { useState, useEffect } from "react";
import PageHeader from "../../../components/common/PageHeader.jsx";
import DataTable from "../../../components/common/DataTable/DataTable.jsx";
import { getMyAssets } from "../../../services/api/employeeSelfApi.js";

function AssetStatusBadge({ status }) {
  const variant = {
    Available: "available",
    Assigned: "assigned",
    "Under Repair": "repair",
    Retired: "retired",
    Lost: "lost",
  }[status] || "unknown";

  return (
    <span className={`asset-status-badge asset-status-badge--${variant}`}>
      {status}
    </span>
  );
}

function MyAssetsPage() {
  const [currentAssets, setCurrentAssets] = useState([]);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setIsLoading(true);
    setLoadError("");

    getMyAssets()
      .then((data) => {
        setCurrentAssets(data?.current_assets ?? []);
        setHistory(data?.assignment_history ?? []);
      })
      .catch(() => {
        setLoadError("Failed to load your assets. Please try again.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  const currentColumns = [
    { key: "asset_tag", label: "Asset Tag" },
    { key: "type_name", label: "Type" },
    {
      key: "serial_number",
      label: "Serial Number",
      render: (row) => row.serial_number || "-",
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <AssetStatusBadge status={row.status} />,
    },
  ];

  const historyColumns = [
    { key: "asset_tag", label: "Asset Tag" },
    { key: "type_name", label: "Type" },
    { key: "assigned_date", label: "Assigned" },
    { key: "returned_date", label: "Returned" },
    {
      key: "return_condition",
      label: "Condition on Return",
      render: (row) => row.return_condition || "-",
    },
  ];

  return (
    <div className="my-assets-page">
      <PageHeader
        title="My Assets"
        subtitle="Assets currently assigned to you, and your past assignment history"
      />

      {loadError && (
        <p className="my-assets-page__error">{loadError}</p>
      )}

      <div className="my-assets-page__section">
        <h2 className="my-assets-page__section-title">
          Currently Assigned
        </h2>

        <div className="my-assets-page__table-card">
          <DataTable
            columns={currentColumns}
            rows={currentAssets}
            isLoading={isLoading}
            emptyMessage="No assets currently assigned to you"
          />
        </div>
      </div>

      <div className="my-assets-page__section">
        <h2 className="my-assets-page__section-title">
          Past Assignment History
        </h2>

        <div className="my-assets-page__table-card">
          <DataTable
            columns={historyColumns}
            rows={history}
            isLoading={isLoading}
            emptyMessage="No past asset assignments"
          />
        </div>
      </div>
    </div>
  );
}

export default MyAssetsPage;