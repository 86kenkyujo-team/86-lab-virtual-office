import { getHealth } from "./_lib/store.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  res.status(200).json(getHealth());
}
