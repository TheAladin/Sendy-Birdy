import { useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { api } from "../../api/client";
import { apiError } from "../../api/errors";
import type { UploadQueue } from "./queue";

export const UploadContext = createContext<UploadQueue | null>(null);

export function useUploadQueue() {
  const queue = useContext(UploadContext);
  if (!queue) throw new Error("useUploadQueue must be used inside <UploadProvider>.");
  return queue;
}

export function useUploadLimits() {
  return useQuery({
    queryKey: ["upload-limits"],
    queryFn: async () => {
      const { data, response } = await api.GET("/api/items/upload-limits");
      if (!data) throw apiError(response);
      return { maxBytes: data.max_bytes, acceptedTypes: data.accepted_types };
    },
    staleTime: Infinity,
  });
}

/** Browsers name pasted screenshots "image.png"; give them a name worth keeping. */
export function nameForUpload(file: File, now = new Date()): string {
  if (!/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file.name;
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Screenshot ${date} at ${time}.${file.name.split(".").pop()?.toLowerCase()}`;
}
