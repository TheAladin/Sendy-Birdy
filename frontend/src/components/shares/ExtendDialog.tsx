import { type FormEvent, useState } from "react";

import { type ShareSummary, useUpdateShare } from "../../api/shares";
import { useToast } from "../ui/toast";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { chosenExpiry, type ExpiryState, expiryError } from "../../lib/expiry";
import { ExpiryPicker } from "./ExpiryPicker";

/** A new expiry, counted from now; also brings an expired link back. */
export function ExtendDialog({ share, onClose }: { share: ShareSummary; onClose: () => void }) {
  const [expiry, setExpiry] = useState<ExpiryState>({ choice: "7d", customDate: "" });
  const [submitted, setSubmitted] = useState(false);
  const update = useUpdateShare();
  const toast = useToast();
  const error = expiryError(expiry);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (error) return;
    const expiresAt = chosenExpiry(expiry);
    update.mutate(
      { id: share.id, changes: { expires_at: expiresAt?.toISOString() ?? null } },
      {
        onSuccess: () => {
          toast({ tone: "success", title: "Expiry changed" });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      onSubmit={onSubmit}
      title={`Change expiry for "${share.title}"`}
      description={
        share.status === "expired" ? "The link starts working again." : "Counted from now."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      {update.error && (
        <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-400">
          {update.error.message}
        </p>
      )}
      <ExpiryPicker
        legend="Works for"
        value={expiry}
        onChange={setExpiry}
        error={submitted ? error : undefined}
      />
    </Dialog>
  );
}
