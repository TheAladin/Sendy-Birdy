import { Activity } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/ui/Display";

export default function ActivityPage() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Activity" description="Who opened your links, and when." />
      <EmptyState
        icon={<Activity />}
        title="No activity yet"
        description="Views and downloads of your share links will be listed here."
      />
    </div>
  );
}
