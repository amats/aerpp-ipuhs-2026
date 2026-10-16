export type InformationActionResult =
  | { ok: true }
  | { ok: false; message: string; reason?: "conflict" }
