import styles from "./DataTable.module.css";

function DataTable({ columns, rows, isLoading, emptyMessage = "No records found" }) {
  if (isLoading) {
    return <div className={styles.state}>Loading...</div>;
  }

  if (rows.length === 0) {
    return <div className={styles.state}>{emptyMessage}</div>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key}>{column.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id ?? index}>
            {columns.map((column) => (
              <td key={column.key}>
                {column.render ? column.render(row) : row[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DataTable;