import type { ReactElement } from "react";

export interface SceneHeadingProps {
  emoji: string;
  title: string;
  description: string;
}

export function SceneHeading({
  emoji,
  title,
  description,
}: SceneHeadingProps): ReactElement {
  return (
    <header className="flex flex-col gap-2">
      <p aria-hidden="true" className="text-3xl">
        {emoji}
      </p>
      <h2 className="text-2xl font-bold leading-tight">{title}</h2>
      <p
        className="max-w-prose text-sm"
        style={{ color: "var(--color-demo-muted)" }}
      >
        {description}
      </p>
    </header>
  );
}
