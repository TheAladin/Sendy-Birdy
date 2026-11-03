import { Link2 } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/ui/Display";

export default function SharesPage() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Shares" description="Links you've sent to clients." />
      <EmptyState
        icon={<Link2 />}
        title="No share links yet"
        description="Once you share items from your library, the links show up here."
      />
    </div>
  );
}
