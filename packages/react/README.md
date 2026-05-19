# @questkit/react

React component library and hooks for QuestKit.

> **Status:** scaffold (TASK-014). Provider + hooks land in TASK-015, components in TASK-016.

## Install

```bash
pnpm add @questkit/react @questkit/core react react-dom
```

## Usage

```tsx
import { QuestKitProvider } from "@questkit/react";
import "@questkit/react/styles.css";

function App() {
  return (
    <QuestKitProvider
      config={{
        baseUrl: "https://api.questkit.jairukchan.com",
        appId: "demo-app",
        getToken: async () => fetchMyJwt(),
      }}
    >
      <YourApp />
    </QuestKitProvider>
  );
}
```

## Theming

QuestKit ships a Tailwind v4 `@theme` block in `dist/styles.css`. The
public tokens are CSS custom properties — override them at any scope to
re-skin the widgets without touching JavaScript:

```css
:root {
  --color-qk-primary: oklch(0.65 0.22 30); /* coral */
  --color-qk-coin: oklch(0.82 0.18 95); /* gold */
}
```
