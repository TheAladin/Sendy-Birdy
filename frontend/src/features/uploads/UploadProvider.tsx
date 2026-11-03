import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";

import { UploadContext, useUploadLimits } from "./context";
import { UploadQueue } from "./queue";
import { xhrTransport } from "./xhrTransport";

/** Owns the upload queue. It sits in the app shell, so uploads continue across pages. */
export function UploadProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [queue] = useState(
    () =>
      new UploadQueue(xhrTransport, {
        // Refresh the library so new items appear without a reload.
        onUploaded: () => void queryClient.invalidateQueries({ queryKey: ["items"] }),
      }),
  );
  const limits = useUploadLimits();

  useEffect(() => {
    if (limits.data) queue.setLimits(limits.data);
  }, [queue, limits.data]);

  return <UploadContext value={queue}>{children}</UploadContext>;
}
