-- Fairness and policies (revision brief item 18). Plain language drafts, marked for counsel.
-- Not legal advice.
--
-- Invariants:
--   * Policies are versioned and immutable once published (0018). The pages always show the
--     current version and its date.
--   * Every customer accepts the current Terms and Privacy Policy, and confirms they are 18
--     or older, at sign up and again at their first purchase. assert_policies_accepted is
--     called before an order is placed; acceptances are append only.
--   * A section headed with {buyback} is shown only while sell back is on.

create function needs_policy_acceptance(p_user uuid) returns boolean language sql stable as $$
  select not exists (select 1 from policy_acceptances where user_id = p_user and context = 'first_purchase')
      or exists (select 1 from (values ('terms'), ('privacy')) d(doc)
                 where current_policy_version(d.doc) is not null
                   and not exists (select 1 from policy_acceptances a where a.user_id = p_user and a.doc = d.doc
                                   and a.version = current_policy_version(d.doc)))
$$;

create function assert_policies_accepted(p_user uuid) returns void language plpgsql as $$
begin
  if needs_policy_acceptance(p_user) then raise exception 'policies_not_accepted'; end if;
end $$;

-- First purchase: the 18+ confirmation and acceptance of the current Terms and Privacy Policy.
create function accept_policies_at_purchase(p_user uuid) returns void language plpgsql as $$
begin
  if not exists (select 1 from users where id = p_user and age_verified_at is not null) then raise exception 'age_not_verified'; end if;
  perform accept_current_policies(p_user,
    case when exists (select 1 from policy_acceptances where user_id = p_user and context = 'first_purchase') then 'update' else 'first_purchase' end);
end $$;

insert into policy_versions (doc, version, published_at, title, body_md) values
('fairness', '2026-10-01', '2026-09-28T00:00:00Z', 'Fairness and policies', $md$
## How your pack is handled
1. You place an order.
2. At 7:00 PM Pacific the order list locks.
3. We open sealed packs on camera, in order, and match them to the list.
4. We log every card and upload your video.
5. You get an email by 9:00 PM Pacific.
6. You choose: keep your cards in your Vault or ship them.

## Our fairness promise
Every pack we sell is a factory sealed Magic: The Gathering booster. We do not open, weigh, feel, or sort packs before you buy them. At 7:00 PM Pacific the order list locks. We then open sealed packs on camera in the order they come out of the case and match them to the list in order. Nobody picks which pack goes to which order. Every opening is recorded, and yours is in your Vault. The cards are whatever Wizards of the Coast printed. We cannot change what is inside a pack. To see what a booster can contain, use the "What's in a pack" link on the Packs page.

## Credits
100 credits are worth $1 on CrackAPack. Credits can only be used here. They cannot be cashed out, sent to another person, or turned into a gift card. Credits do not expire. (TODO for counsel: confirm.)

## Selling cards back {buyback}
You can sell any card in your Vault back to us for credits. Selling is always your choice. We pay credits worth a set percentage of the card's market price: 90 percent for cards worth $2 or more, 50 percent for cards from $0.50 to $1.99, and 2 credits for cards under $0.50. Market prices come from Scryfall and update once a day. The price you see when you confirm is the price you get. Large sell backs may take a short time to process.

## Limits per set
During the test run, each customer can buy up to 6 packs of each set. A drop can set its own limit, shown on the Packs page.

## Spending limits and breaks
You can set a daily, weekly, or monthly limit on how much you spend on packs. Change it or remove it any time in Account. You can also take a break for 24 hours, 7 days, or 30 days. During a break you cannot buy packs or add credit, but you can still see your Vault and ship cards. To end a break early, email crackapack.business@gmail.com.

## Who can use CrackAPack
You must be 18 or older.

## Legal notice
CrackAPack is an unofficial retailer. It is not produced by or endorsed by Wizards of the Coast. Magic: The Gathering, card names, card images, and set symbols are property of Wizards of the Coast LLC. Card data and images via Scryfall.

## Contact
Support and problem reports go to crackapack.business@gmail.com.
$md$),

('terms', '2026-10-01', '2026-09-28T00:00:00Z', 'Terms of Service', $md$
Draft for the test run. Every clause marked TODO for counsel needs review before real customers.

## Who can use CrackAPack
You must be 18 or older and live in the United States to create an account. We ask for your date of birth at sign up and at your first purchase you confirm again that you are 18 or older. One account per person. (TODO for counsel: identity verification and any state exclusions.)

## Your account
Keep your password private. You are responsible for activity on your account. Tell us at crackapack.business@gmail.com if you think someone else has used it.

## Ordering and the 7:00 PM cutoff
When you order, you buy specific sealed packs of the set you choose. Orders placed before 7:00 PM Pacific join that night's queue; later orders join the next night's queue. At 7:00 PM Pacific the queue locks and is never edited afterward. We open packs on camera between 7:00 and 8:00 PM Pacific in the order they come out of the case and match them to the queue in order.

## Limits per set
During the test run each customer can buy up to 6 packs of each set, counting orders not yet opened. A drop may set a different limit. We may change a limit for a customer and keep a record of why.

## Credits
You buy credits by card through our checkout, handled by Stripe. 1 credit is always worth 1 cent (100 credits = $1). Credits can only be used for packs and shipping on CrackAPack. They cannot be cashed out, transferred, or exchanged for a gift card, and there are no bonus credits. Credits do not expire. (TODO for counsel: credit expiry, escheat and refunds of unused purchased credits.)

## Selling cards back
Sell back is turned off during the test run. If we turn it on, this section and the Fairness page will say how it works before you can use it. (TODO for counsel.)

## Your Vault and shipping
Cards from your packs are stored for you free in your Vault. You can ask us to ship them at any time. Shipping is free for orders of $50 or more in market value and $4.99 (499 credits) below that. Cards are yours once logged to your Vault; we hold them for you until you ask for them.

Inactivity: if your account has no activity for 12 months, we will email you twice. If you do not respond, we may ship your cards to your address at your expense or convert them to credits at our sell back rates. (TODO for counsel: confirm this policy before the first sale.)

## Refunds and cancellations
You can cancel an order for a full credit refund until the queue locks at 7:00 PM Pacific. After the lock, orders cannot be cancelled. If we cannot fulfil an order, or charged you by mistake, we refund it. (TODO for counsel: card refunds of purchased credits.)

## Sales tax
Prices are shown in credits before you pay. (TODO for counsel: sales tax collection on packs and shipping.)

## Spending limits and breaks
You can set spending limits and take breaks in Account. A break cannot be shortened from the site; email us to ask for an early end.

## Our rights
We may refuse an order or close an account for fraud, abuse, or breaking these terms. If we close an account, we refund unused purchased credits and ship or refund your Vault. (TODO for counsel.)

## Intellectual property
CrackAPack is an unofficial retailer. It is not produced by or endorsed by Wizards of the Coast. Magic: The Gathering, card names, card images, and set symbols are property of Wizards of the Coast LLC. Card data and images via Scryfall.

## Disputes
[Placeholder: whether to include an arbitration clause or class action waiver is for counsel. None applies until counsel decides.] (TODO for counsel.)

## Governing law
These terms are governed by the laws of the State of California.

## Contact
crackapack.business@gmail.com. Mailing address: [Mailing address to come].
$md$),

('privacy', '2026-10-01', '2026-09-28T00:00:00Z', 'Privacy Policy', $md$
Draft for the test run. Every clause marked TODO for counsel needs review before real customers.

## What we collect
Your email address and password (stored only as a hash). Your date of birth, stored encrypted, to confirm you are 18 or older. Your shipping address when you ask us to ship. Your orders, credits activity, spending limits and breaks. Videos of your packs being opened: these show packs and cards, and staff hands, not you.

## Payments
Payments are handled by Stripe. We never see or store your card number.

## How we use it
To run your account, open and ship your packs, send the emails you need (order confirmations, "You just cracked a pack", shipping, password resets, and reminders you ask for), keep the records the fairness promise depends on, and meet legal duties.

## Advertising measurement
We do not use advertising pixels or share data with ad networks today. If we add the Meta Pixel and server side purchase events, they will use hashed identifiers for ad measurement, and we will update this policy first. (TODO for counsel.)

## Cookies and storage
We use your browser's local storage to keep you signed in. We do not use advertising cookies.

## Sharing
We share data only with the services that run the site: Stripe (payments), Neon (database), Vercel (hosting and video storage), and Google (email). We do not sell your personal information.

## Retention
We keep order, credit and custody records as long as the law requires. Pack videos are kept for 12 months. (TODO for counsel: retention periods.)

## Your choices
You can ask for a copy of your data or ask us to delete your account by emailing crackapack.business@gmail.com. Some records, such as payment and order history, may need to be kept by law. California residents have rights under the CCPA. (TODO for counsel.)

## Children
CrackAPack is only for people 18 and older. We do not knowingly collect information from anyone under 18.

## Contact
crackapack.business@gmail.com. Mailing address: [Mailing address to come].
$md$);
