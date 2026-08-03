export default async function handler(req: any, res: any) {
  try {
    // Dynamic import to avoid bundle-time crashes
    const mod = await import("./serve.js");
    const app = mod.default || mod;
    
    if (typeof app === "function") {
      // It's an Express app — delegate to it
      return app(req, res);
    }
    res.status(200).json({ status: "ok" });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack?.slice(0, 500) });
  }
}
