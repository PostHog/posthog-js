import { defineApp } from "convex/server";
import posthog from "@posthog/convex/convex.config.js";

const app = defineApp();
app.use(posthog);

export default app;
