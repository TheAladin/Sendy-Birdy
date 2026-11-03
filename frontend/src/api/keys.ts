// Query keys needed by the shared query client. Kept apart from the hooks that use them, so
// the client (in every page's bundle) doesn't pull in the admin's sign-in code.
export const meQueryKey = ["me"] as const;
