import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Pages load on demand, and the first test in a file waits for its page to be compiled. That
// takes well under a second normally, but more on a busy machine or CI runner. findBy… still
// resolves as soon as the element appears; this only raises the ceiling from 1 s.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement <dialog> yet; this mimics the parts our Dialog uses.
if (!("showModal" in HTMLDialogElement.prototype)) {
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
    close(this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
}
