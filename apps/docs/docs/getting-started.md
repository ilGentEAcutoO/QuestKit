---
sidebar_position: 2
title: Getting Started
description: Drop QuestKit into a React app or a vanilla HTML page in under a minute.
---

# Getting Started

Two paths. Pick the one that matches your host.

## 30-second React quick-start

1. **Install.**

   ```bash
   pnpm add @questkit/react @questkit/core
   ```

2. **Wrap your tree with `<QuestKitProvider>`.** The provider owns a single `QuestKitClient` for the lifetime of your app.

   ```tsx
   // src/main.tsx
   import "@questkit/react/styles.css";
   import { QuestKitProvider } from "@questkit/react";

   const token = "<JWT from your backend>"; // see /v1/auth/token

   export function App() {
     return (
       <QuestKitProvider
         config={{
           baseUrl: "https://api.questkit.jairukchan.com",
           appId: "your-app-id",
           getToken: () => token,
         }}
       >
         <YourApp />
       </QuestKitProvider>
     );
   }
   ```

3. **Drop in a widget.**

   ```tsx
   import { MissionList } from "@questkit/react";

   export function YourApp() {
     return <MissionList limit={10} />;
   }
   ```

That's it. The hook subscribes to Server-Sent Events automatically, so progress and reward updates flow into the UI in real time. See the [React Guide](./react/provider.mdx) for the full component catalogue.

## 30-second embed quick-start

Drop two tags into any HTML page. No build step.

1. **Mint a JWT on your backend** (see [POST /v1/auth/token](./api/auth.md)) and inject it as a meta tag.

2. **Add the embed script and a widget mount point.**

   ```html
   <!doctype html>
   <html>
     <head>
       <meta name="questkit-token" content="<JWT from your backend>" />
     </head>
     <body>
       <div data-questkit="MissionList" data-questkit-prop-limit="5"></div>

       <script
         src="https://play.questkit.jairukchan.com/questkit.iife.js"
         data-questkit-app-id="your-app-id"
         data-questkit-user-id="usr_demo_123"
         data-questkit-base-url="https://api.questkit.jairukchan.com"
       ></script>
     </body>
   </html>
   ```

The embed:

- Scans the DOM for `[data-questkit="<Widget>"]` elements on `DOMContentLoaded`.
- Mounts each widget inside an isolated Shadow DOM so host CSS can't leak in (and your widgets can't leak out).
- Exposes `window.QuestKit` for imperative calls (`fireEvent`, `claim`, `mount`, `unmount`, `on`, `off`).

See [Embed → Quick Start](./embed/quick-start.md) for the full whitelist of 9 widgets and every `data-questkit-*` attribute.

## What's next

- **Build out your UI** → [React components](./react/components.mdx)
- **Customise the look** → [Theming](./theming.md)
- **Wire inbound webhooks (Stripe etc.)** → [Webhooks](./webhooks/overview.md)
- **Run it on your own Cloudflare account** → [Self-Hosting](./self-hosting.md)
