import { readState } from "./_lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  try {
    res.status(200).json(await readState());
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "state_read_failed",
      message: error.message
    });
  }
}
