import { createApp } from "./app.js";
import { config } from "./config.js";

const { app, service } = createApp();

// Recover any runs left non-terminal by a crash or aborted process
service.recoverStuckRuns().then((recovered) => {
  if (recovered > 0) {
    console.log(`WARDEN recovered ${recovered} stuck run(s) from a previous process.`);
  }
}).catch((err) => {
  console.error("Failed to recover stuck runs:", err);
});

// Only listen when not on Vercel (serverless)
if (!config.vercel) {
  app.listen(config.port, () => {
    console.log(`WARDEN API listening on http://localhost:${config.port} (${config.environment})`);
  });
}

export default app;
