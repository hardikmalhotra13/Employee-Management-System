import PageHeader from "../../../components/common/PageHeader.jsx";
import EmployeeDocumentsSection from "../components/EmployeeDocumentsSection.jsx";

function MyDocumentsPage() {
  return (
    <div>
      <PageHeader title="My Documents" subtitle="ID proofs, certificates, and other files on file for you" />
      <div style={{ marginTop: "20px" }}>
        <EmployeeDocumentsSection />
      </div>
    </div>
  );
}

export default MyDocumentsPage;