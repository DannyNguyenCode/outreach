import type { CsvImportListItem } from "@/lib/orgs/csv-import";

export function CsvImportRecentList({
  organizationSlug,
  imports,
}: {
  organizationSlug: string;
  imports: CsvImportListItem[];
}) {
  if (imports.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        No staged CSV imports yet. Preview a file, map columns, then stage a
        review snapshot.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <caption className="sr-only">Recent CSV imports</caption>
        <thead>
          <tr>
            <th scope="col" className="border px-2 py-1 text-left">
              Filename
            </th>
            <th scope="col" className="border px-2 py-1 text-left">
              Target
            </th>
            <th scope="col" className="border px-2 py-1 text-left">
              Created
            </th>
            <th scope="col" className="border px-2 py-1 text-left">
              Status
            </th>
            <th scope="col" className="border px-2 py-1 text-left">
              Rows
            </th>
            <th scope="col" className="border px-2 py-1 text-left">
              Issues
            </th>
            <th scope="col" className="border px-2 py-1 text-left">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {imports.map((item) => (
            <tr key={item.id}>
              <td className="border px-2 py-1">{item.filename}</td>
              <td className="border px-2 py-1">{item.family}</td>
              <td className="border px-2 py-1">
                {item.createdAt.toISOString().slice(0, 10)}
              </td>
              <td className="border px-2 py-1">
                {item.confirmed
                  ? "Confirmed"
                  : item.status === "NEEDS_ATTENTION"
                    ? "Needs attention"
                    : "Ready to confirm"}
              </td>
              <td className="border px-2 py-1">
                {item.validRowCount}/{item.totalRowCount}
              </td>
              <td className="border px-2 py-1">{item.issueCount}</td>
              <td className="border px-2 py-1">
                <a
                  href={`/app/orgs/${organizationSlug}/knowledge/import/${item.id}`}
                  className="underline-offset-2 hover:underline"
                >
                  Continue reviewing
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
