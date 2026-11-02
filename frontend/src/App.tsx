import { useEffect, useState } from "react";

import { fetchHealth } from "./api/health";

type ApiStatus = "checking…" | "ok" | "unreachable";

export default function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking…");

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then(() => setApiStatus("ok"))
      .catch(() => {
        // Aborted on unmount (React runs effects twice in development): not a failure.
        if (!controller.signal.aborted) setApiStatus("unreachable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Sendy Birdy</h1>
      <p>API: {apiStatus}</p>
    </main>
  );
}
