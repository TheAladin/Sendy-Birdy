import type { ItemSummary } from "../../api/items";
import { useShares } from "../../api/shares";
import { shareState } from "../../lib/shareStatus";
import { Spinner } from "../ui/Display";

const SHOWN = 5;
const LABELS = {
  active: "active",
  expiring: "expiring soon",
  expired: "expired",
  revoked: "revoked",
};

/** Before deleting items: which links will lose them (and keep working without them). */
export function AffectedShares({ items }: { items: ItemSummary[] }) {
  const ids = items.filter((item) => item.share_count > 0).map((item) => item.id);
  const shares = useShares(ids, { enabled: ids.length > 0 });

  if (ids.length === 0) return null;
  if (!shares.data) {
    return shares.isError ? null : <Spinner label="Checking share links" />;
  }
  if (shares.data.length === 0) return null;

  const listed = shares.data.slice(0, SHOWN);
  const more = shares.data.length - listed.length;
  return (
    <div className="rounded-control bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="font-medium">
        {shares.data.length === 1 ? "This link" : `These ${shares.data.length} links`} will lose{" "}
        {items.length === 1 ? "it" : "them"}:
      </p>
      <ul className="mt-1.5 list-disc pl-5">
        {listed.map((share) => (
          <li key={share.id}>
            {share.title} <span className="opacity-80">({LABELS[shareState(share)]})</span>
          </li>
        ))}
        {more > 0 && <li>and {more} more</li>}
      </ul>
    </div>
  );
}
