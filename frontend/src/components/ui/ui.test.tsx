import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { expect, test, vi } from "vitest";

import { Button, IconButton } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { Input } from "./Input";
import { Menu } from "./Menu";
import { useToast } from "./toast";
import { Toaster } from "./Toaster";

test("a loading button is busy and can't be clicked", async () => {
  const onClick = vi.fn();
  render(
    <Button loading onClick={onClick}>
      Save
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Save" });
  await userEvent.click(button);

  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(onClick).not.toHaveBeenCalled();
});

test("buttons default to type=button, so they never submit forms by accident", () => {
  render(<Button>Go</Button>);

  expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "button");
});

test("an icon button is named by its label", () => {
  render(<IconButton label="Copy link" icon={<Ellipsis />} />);

  expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
});

test("a field connects its control to the label, hint and error", () => {
  render(
    <Field label="Password" hint="At least 12 characters." error="Too short.">
      {(control) => <Input type="password" {...control} />}
    </Field>,
  );

  const input = screen.getByLabelText("Password");
  expect(input).toHaveAccessibleDescription("At least 12 characters. Too short.");
  expect(input).toBeInvalid();
});

test("a field without an error is valid and has no description", () => {
  render(<Field label="Email">{(control) => <Input {...control} />}</Field>);

  const input = screen.getByLabelText("Email");
  expect(input).toBeValid();
  expect(input).not.toHaveAttribute("aria-describedby");
});

function DialogHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="Delete item?"
        description="This can't be undone."
      />
    </>
  );
}

test("a dialog is named by its title and closes from its close button", async () => {
  const onClose = vi.fn();
  render(<DialogHarness onClose={onClose} />);

  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  const dialog = screen.getByRole("dialog", { name: "Delete item?" });
  expect(dialog).toHaveAccessibleDescription("This can't be undone.");

  await userEvent.click(screen.getByRole("button", { name: "Close" }));

  expect(dialog).not.toHaveAttribute("open");
  expect(onClose).toHaveBeenCalledOnce();
});

test("a menu is fully usable with the keyboard", async () => {
  const user = userEvent.setup();
  const rename = vi.fn();
  const remove = vi.fn();
  render(
    <Menu
      label="Actions"
      icon={<Ellipsis />}
      items={[
        { label: "Rename", onSelect: rename },
        { label: "Delete", onSelect: remove },
      ]}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Actions" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");

  await user.tab();
  await user.keyboard("{Enter}");
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();

  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.keyboard("{Enter}");
  await user.keyboard("{End}{Enter}");
  expect(remove).toHaveBeenCalledOnce();
  expect(rename).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
});

test("a menu closes when you click elsewhere", async () => {
  render(
    <>
      <Menu label="Actions" icon={<Ellipsis />} items={[{ label: "Rename", onSelect: vi.fn() }]} />
      <p>Somewhere else</p>
    </>,
  );

  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  await userEvent.click(screen.getByText("Somewhere else"));

  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

function ToastButton() {
  const toast = useToast();
  return <Button onClick={() => toast({ title: "Link copied", tone: "success" })}>Copy</Button>;
}

test("toasts appear in a live region and can be dismissed", async () => {
  render(
    <Toaster>
      <ToastButton />
    </Toaster>,
  );
  const region = screen.getByRole("region", { name: "Notifications" });
  expect(region).toHaveAttribute("aria-live", "polite");

  await userEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(screen.getByRole("status")).toHaveTextContent("Link copied");

  await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("toasts disappear on their own after a few seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    render(
      <Toaster>
        <ToastButton />
      </Toaster>,
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(5000));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("useToast outside a Toaster fails loudly", () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  expect(() => render(<ToastButton />)).toThrow("useToast must be used inside <Toaster>.");
  vi.restoreAllMocks();
});
