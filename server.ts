import { createApp } from "./app.ts";
import process from "node:process";

const app = createApp();

const port = Number(process.env.PORT || 9000);
const hostname = "0.0.0.0";

Deno.serve({ port, hostname }, app.fetch);
