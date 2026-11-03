import { ImagePlus } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/ui/Display";

export default function LibraryPage() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Library" description="Your screenshots, videos and notes." />
      <EmptyState
        icon={<ImagePlus />}
        title="Your library is empty"
        description="Uploading arrives soon. Everything you upload will appear here."
      />
    </div>
  );
}
