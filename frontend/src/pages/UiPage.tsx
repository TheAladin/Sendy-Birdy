import { Copy, Ellipsis, ImagePlus, Pencil, Trash2, Upload } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Logo } from "../components/brand/Logo";
import { Button, IconButton } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Badge, Card, EmptyState, Skeleton, Spinner } from "../components/ui/Display";
import { Field } from "../components/ui/Field";
import { Input, Textarea } from "../components/ui/Input";
import { Menu } from "../components/ui/Menu";
import { useToast } from "../components/ui/toast";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Development-only catalogue of every UI primitive in every state (served at /ui). */
export default function UiPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const toast = useToast();

  return (
    <main className="mx-auto grid max-w-3xl gap-12 px-6 py-12">
      <header className="flex items-center justify-between">
        <Logo />
        <Badge tone="warning">Development only</Badge>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary">
            <Upload className="size-4" aria-hidden="true" />
            Small with icon
          </Button>
          <IconButton label="Copy link" icon={<Copy className="size-4" />} />
        </div>
      </Section>

      <Section title="Form fields">
        <Card className="grid gap-5">
          <Field label="Email">
            {(control) => <Input type="email" placeholder="you@example.com" {...control} />}
          </Field>
          <Field label="Link title" hint="Clients see this at the top of the page.">
            {(control) => <Input defaultValue="Homepage redesign: round 2" {...control} />}
          </Field>
          <Field label="Password" error="That password is too short.">
            {(control) => <Input type="password" defaultValue="short" {...control} />}
          </Field>
          <Field label="Message">
            {(control) => <Textarea placeholder="A note for your client…" {...control} />}
          </Field>
          <Field label="Disabled">
            {(control) => <Input disabled defaultValue="Can't touch this" {...control} />}
          </Field>
        </Card>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Draft</Badge>
          <Badge tone="brand">New</Badge>
          <Badge tone="success">Active</Badge>
          <Badge tone="warning">Expires soon</Badge>
          <Badge tone="danger">Revoked</Badge>
        </div>
      </Section>

      <Section title="Loading">
        <Card className="grid gap-3">
          <Spinner />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="aspect-video w-full" />
        </Card>
      </Section>

      <Section title="Empty state">
        <EmptyState
          icon={<ImagePlus />}
          title="Nothing here yet"
          description="Drop screenshots, demo videos or notes here to start sharing them."
          action={<Button>Upload files</Button>}
        />
      </Section>

      <Section title="Dialog, menu and toasts">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Menu
            label="Actions for hero.png"
            icon={<Ellipsis className="size-4" />}
            align="start"
            items={[
              { label: "Rename", icon: <Pencil />, onSelect: () => toast({ title: "Rename" }) },
              { label: "Copy link", icon: <Copy />, onSelect: () => toast({ title: "Copied" }) },
              {
                label: "Delete",
                icon: <Trash2 />,
                danger: true,
                onSelect: () => toast({ title: "Deleted", tone: "error" }),
              },
            ]}
          />
          <Button
            variant="secondary"
            onClick={() =>
              toast({ title: "Link copied", description: "Paste it anywhere.", tone: "success" })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast({ title: "Upload failed", tone: "error" })}
          >
            Error toast
          </Button>
        </div>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Delete 3 items?"
          description="They'll also disappear from 2 share links. This can't be undone."
          footer={
            <>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setDialogOpen(false)}>
                Delete
              </Button>
            </>
          }
        />
      </Section>
    </main>
  );
}
