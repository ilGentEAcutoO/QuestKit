/**
 * ProgressBar — visual + a11y specs.
 *
 * Contract:
 *   - Renders role="progressbar" with aria-valuenow / aria-valuemin / aria-valuemax.
 *   - Fill width is value/max in percent.
 *   - Clamps value to [0, max] and treats max <= 0 as 1.
 *   - Forwards `label` as aria-label.
 *   - Applies theme primary token to the fill (via inline style).
 */
import { render, screen } from "@testing-library/react";

import { ProgressBar } from "../../src/components/ProgressBar";

describe("progressBar", () => {
  it("renders without crashing", () => {
    render(<ProgressBar value={0} max={10} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("sets aria attributes to match props", () => {
    render(<ProgressBar value={3} max={10} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
  });

  it("computes the fill width as value/max in percent", () => {
    const { container } = render(<ProgressBar value={3} max={10} />);
    const fill = container.querySelector(".qk-progressbar-fill") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe("30%");
  });

  it("clamps value to max", () => {
    const { container } = render(<ProgressBar value={50} max={10} />);
    const fill = container.querySelector(".qk-progressbar-fill") as HTMLElement;
    expect(fill.style.width).toBe("100%");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
  });

  it("clamps value to zero when negative", () => {
    const { container } = render(<ProgressBar value={-1} max={10} />);
    const fill = container.querySelector(".qk-progressbar-fill") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("guards against max <= 0", () => {
    const { container } = render(<ProgressBar value={1} max={0} />);
    const fill = container.querySelector(".qk-progressbar-fill") as HTMLElement;
    // safeMax becomes 1, value clamped to 1 → 100%.
    expect(fill.style.width).toBe("100%");
  });

  it("forwards label as aria-label", () => {
    render(<ProgressBar value={1} max={2} label="Progress here" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-label",
      "Progress here",
    );
  });

  it("applies the primary theme token to the fill", () => {
    const { container } = render(<ProgressBar value={1} max={10} />);
    const fill = container.querySelector(".qk-progressbar-fill") as HTMLElement;
    // The component exposes the theme token via the `--qk-fill` CSS custom
    // property (jsdom doesn't validate custom properties, so var()
    // references survive). The fill class then reads from it.
    expect(fill.style.getPropertyValue("--qk-fill")).toContain(
      "--color-qk-primary",
    );
  });
});
