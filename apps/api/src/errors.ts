/**
 * Database functions raise snake_case codes (see CLAUDE.md). This is the only place
 * those codes become HTTP statuses and customer facing messages.
 */
const CODES: Record<string, [number, string]> = {
  // auth
  unauthenticated: [401, "Sign in to continue."],
  forbidden: [403, "You don't have access to that."],
  email_in_use: [409, "An account with that email already exists. Log in instead."],
  invalid_email: [400, "Enter a valid email address."],
  weekly_limit_reached: [403, "That order would pass your weekly spending limit."],
  invalid_limit: [400, "Enter a limit above zero, or remove it."],
  invalid_limit_period: [400, "Choose a daily, weekly or monthly limit."],
  not_on_break: [409, "You're not on a break."],
  reason_required: [400, "Give a reason."],
  invalid_login: [401, "That email and password don't match."],
  too_many_attempts: [429, "Too many wrong passwords. Wait 15 minutes, or reset your password."],
  weak_password: [400, "Use at least 8 characters for your password."],
  invalid_birthdate: [400, "Enter a real date of birth."],
  terms_required: [400, "Agree to the terms to create an account."],
  reset_link_invalid: [400, "That reset link has expired or was already used. Request a new one."],
  signup_unavailable: [503, "Sign up is unavailable right now. Try again soon."],
  use_confirm_age: [400, "Confirm your date of birth."],
  email_required: [400, "Your account needs an email address."],
  invalid_role: [400, "Unknown role."],
  unknown_user: [404, "No account with that email. They need to sign in once first."],
  unknown_clip: [404, "No clip to retry for that order."],
  // ordering
  age_not_verified: [403, "Verify your age before ordering."],
  state_blocked: [403, "Orders aren't available in your state yet."],
  invalid_quantity: [400, "Choose between 1 and 6 packs."],
  product_unavailable: [409, "That set isn't available right now."],
  sold_out: [409, "That set is out of sealed stock for tonight."],
  insufficient_credits: [402, "Not enough credits."],
  no_price: [409, "That set isn't priced yet."],
  unknown_order: [404, "Order not found."],
  order_not_cancellable: [409, "That order can't be cancelled."],
  cutoff_passed: [409, "Tonight's queue is closed. Orders lock at 7pm Pacific."],
  underage: [403, "You must be 18 or older to use CrackAPack."],
  birthdate_locked: [409, "Your birthdate is already verified. Contact support to change it."],
  on_break: [403, "You're on a break. You can't buy packs or add credit until it ends."],
  daily_limit_reached: [403, "That order would pass your daily spending limit."],
  monthly_limit_reached: [403, "That order would pass your monthly spending limit."],
  invalid_break: [400, "Choose a break of 24 hours, 7 days or 30 days."],
  // staff: batch and session
  unknown_batch: [404, "Batch not found."],
  batch_already_locked: [409, "That queue is already locked."],
  cutoff_not_reached: [409, "The queue can only be locked after the 7pm cutoff."],
  batch_not_locked: [409, "Lock the queue before starting the session."],
  earlier_batch_incomplete: [409, "Finish the earlier night's session first."],
  unknown_session: [404, "Session not found."],
  session_ended: [409, "That session has ended."],
  unknown_box: [404, "Box not found."],
  box_not_sealed: [409, "That box has already been opened."],
  another_box_open_for_product: [409, "Finish the open box for this product first."],
  no_open_box_for_product: [409, "Open a sealed box for this product first."],
  queue_exhausted: [409, "Every pack in the queue has been opened."],
  queue_not_exhausted: [409, "There are still packs to open."],
  void_reason_required: [400, "Give a reason for the void."],
  stock_covers_reservations: [409, "Not enough sealed packs left to cover the queue. Receive another box."],
  // contents and notifications
  pack_not_opened: [409, "That pack hasn't been opened."],
  pack_contents_finalized: [409, "That pack's contents are already final."],
  pack_contents_empty: [409, "Log the pack's cards before approving."],
  finish_not_available: [400, "That printing doesn't come in that finish."],
  card_count_mismatch: [409, "The card count doesn't match this set's pack. Recount, or approve with a written reason."],
  pack_not_approved: [409, "That pack isn't approved yet. Edit it directly."],
  card_left_vault: [409, "That card has already left the customer's vault (shipped or sold), so it can't be changed here."],
  order_not_fully_opened: [409, "Not every pack in that order is open yet."],
  clip_not_ready: [409, "The clip isn't ready yet."],
  contents_not_finalized: [409, "Finish logging every pack in that order first."],
  order_not_notifiable: [409, "That order has already been notified."],
  // vault, buyback, shipping
  card_not_in_vault: [404, "That card isn't in your vault."],
  vault_balance_non_negative: [409, "You don't have that many copies in your vault."],
  price_missing: [409, "That card has no price yet."],
  price_stale: [409, "Prices are updating. Try again shortly."],
  buyback_disabled: [403, "Selling cards back isn't available. Keep them in your vault or ship them."],
  no_items: [400, "Choose at least one card."],
  purchased_non_negative: [409, "Not enough refundable credit."],
  // shipping
  shipment_not_pending: [409, "That shipment has already gone out."],
  tracking_required: [400, "Enter the tracking number."],
  // products
  unknown_set: [404, "That set isn't in the card database yet. Run the Scryfall import."],
  unknown_product: [404, "Product not found."],
  unknown_card: [404, "Card not found."],
  invalid_filter: [400, "That filter isn't available."],
  ladder_empty: [400, "Add at least one price tier."],
  ladder_must_start_at_one: [400, "The price ladder must start at 1 pack."],
  ladder_not_decreasing: [400, "Bigger orders can't cost more per pack."],
  ladder_price_invalid: [400, "Every tier needs a price above zero."],
  unknown_notification: [404, "Notification not found."],
  // sets, drops and videos
  set_limit_reached: [409, "That would pass your limit for this set."],
  night_set_limit_reached: [409, "Tonight's packs of this set are taken. Orders after 7:00 PM PT go into tomorrow night's rip."],
  drop_not_live: [409, "This set isn't on sale right now. See Drops for when it opens."],
  unknown_drop: [404, "Drop not found."],
  drop_overlap: [409, "Another published drop for this set overlaps that window."],
  invalid_drop_window: [400, "The end must be after the start."],
  drop_not_upcoming: [409, "Reminders are only for drops that haven't started."],
  unknown_reminder: [404, "That reminder link has expired."],
  unknown_pack: [404, "Pack not found."],
  unknown_video: [404, "This video isn't ready yet."],
  videos_unavailable: [503, "Video storage isn't set up yet."],
  video_not_started: [409, "Start the upload first."],
  video_approved: [409, "This video is already approved and sent to the customer."],
  video_type_unsupported: [400, "Use an mp4 or mov file."],
  video_missing: [409, "The upload didn't reach storage. Try again."],
  video_size_mismatch: [409, "The stored file doesn't match what was uploaded. Upload it again."],
  videos_not_ready: [409, "Every pack needs a ready video first."],
  session_master_exists: [409, "This night's session recording is already uploaded."],
  policies_not_accepted: [403, "Confirm you are 18 or older and agree to the Terms and Privacy Policy first."],
  unknown_policy: [404, "Page not found."],
  card_data_unverified: [409, "This set's card data hasn't passed its check yet, so it can't be sold. Import and check it on the Stock screen."],
  pack_photo_required: [409, "Add the set's pack photo first (Drops, Set info). Customers always see the real pack."],
  card_data_unavailable: [503, "The card data source isn't set up."],
  card_data_import_failed: [502, "The card data import failed. Try again in a few minutes."],
  no_printings: [404, "The card data source has no printings for that set."],
  // payments
  unknown_bundle: [400, "Unknown credit bundle."],
};

export class ApiError extends Error {
  constructor(public code: string, public status = CODES[code]?.[0] ?? 400) {
    super(code);
  }
}

export function toResponse(e: unknown): { status: number; body: { error: string; message: string } } {
  const err = e as { message?: string; constraint?: string; code?: string };
  const candidates = [
    e instanceof ApiError ? e.code : undefined,
    err.constraint,
    /^([a-z_]+)/.exec(err.message ?? "")?.[1],
  ];
  for (const c of candidates) {
    if (c && CODES[c]) return { status: CODES[c][0], body: { error: c, message: CODES[c][1] } };
  }
  if (e instanceof ApiError) return { status: e.status, body: { error: e.code, message: e.code } };
  if (err.code === "22P02") return { status: 400, body: { error: "invalid_input", message: "Invalid input." } };
  console.error(e);
  return { status: 500, body: { error: "internal", message: "Something went wrong." } };
}
