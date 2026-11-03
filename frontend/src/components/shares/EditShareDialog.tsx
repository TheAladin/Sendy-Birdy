import { useShare } from "../../api/shares";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Spinner } from "../ui/Display";
import { useToast } from "../ui/toast";
import { ShareForm } from "./ShareDialog";

/** Loads the link in full (the list has no message or items), then edits it. */
export function EditShareDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const share = useShare(id);
  const toast = useToast();

  if (!share.data) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Edit link"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        {share.isError ? (
          <p role="alert" className="text-sm">
            This link couldn't be loaded.
          </p>
        ) : (
          <Spinner label="Loading link" />
        )}
      </Dialog>
    );
  }
  return (
    <ShareForm
      existing={share.data}
      initialItems={share.data.items}
      onCancel={onClose}
      onSaved={() => {
        toast({ tone: "success", title: "Link updated" });
        onClose();
      }}
    />
  );
}
