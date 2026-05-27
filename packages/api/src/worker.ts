// Cloudflare Worker entry. Requires the bundled dataset: run `bun run gen` first.
import { dataset } from "./bundle.generated.js";
import { createApp } from "./app.js";

export default createApp(dataset);
