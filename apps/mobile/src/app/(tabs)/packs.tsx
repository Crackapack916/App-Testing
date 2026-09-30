import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ExternalLink, Minus, Plus } from "../../components/icons";
import { Text } from "../../components/Text";
import { Button, ErrorText, Footer, Stage, Title } from "../../components/bits";
import { Logo } from "../../components/Logo";
import { Carousel } from "../../components/Carousel";
import { PackArt } from "../../components/PackArt";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useSession } from "../../lib/session";
import { countdownText, useServerNow } from "../../lib/clock";
import { credits, dollars, pacific } from "../../lib/format";
import { brand, colors, font, palette, radii, type } from "../../lib/theme";

type Tier = { min_qty: number; per_pack_credits: number };
type Status = "available" | "sold_out" | "night_full" | "upcoming" | "ended" | "on_break" | "unavailable";
export type Product = { product_id: string; set_code: string; set_name: string; booster_type: string; name: string; icon_svg_uri: string | null;
  wizards_info_url: string | null; pack_image_url: string | null; ladder: Tier[]; drop_id: string | null; drop_starts_at: string | null;
  drop_ends_at: string | null; drop_state: string | null; night_limit: number; left_tonight: number; max_qty: number; status: Status };
type Storefront = { products: Product[]; next_cutoff: string; batch_date: string; now: string; break_until: string | null };

const CHIPS = [1, 3, 6];
export const perPack = (ladder: Tier[], qty: number) => [...ladder].reverse().find((t) => t.min_qty <= qty)?.per_pack_credits ?? 0;

/** Packs (item 9): the dark stage, a carousel of the sets on sale, and one pinned Buy button. */
export default function Packs() {
  const { me, refresh } = useSession();
  const store = useApi<Storefront>("/storefront");
  const limits = useApi<{ suggest_limit: boolean }>(me ? "/me/limits" : null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const now = useServerNow(store.data?.now);
  const products = store.data?.products ?? [];
  const p = products[Math.min(index, products.length - 1)];
  const max = p?.max_qty ?? 0;
  useEffect(() => { setQty((q) => Math.max(1, Math.min(q, max || 1))); }, [p?.product_id, max]);

  const each = p ? perPack(p.ladder, qty) : 0;
  const total = each * qty;
  const balance = me?.credits.total ?? 0;
  const itemWidth = Math.min(230, width * 0.52);

  const buy = () => {
    if (!me) return router.push("/sign-in");
    if (balance < total) return router.push("/add-credits");
    setConfirming(true);
  };

  return (
    <Stage>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }}>
        <Title><Logo size={24} testID="packs-logo" /></Title>

        {store.data && !products.length ? (
          <View style={s.none}>
            <Text style={s.title}>Nothing on sale right now</Text>
            <Text style={s.muted}>See Drops for when the next set goes live.</Text>
            <Button kind="ghost" label="See drops" onPress={() => router.push("/drops")} />
          </View>
        ) : null}

        {products.length > 0 && (
          <>
            <View style={s.glowWrap} pointerEvents="none">
              <View style={[s.ring, { width: itemWidth * 1.3, height: itemWidth * 1.3 }]}>
                <View style={[s.ringInner, { width: itemWidth * 0.95, height: itemWidth * 0.95 }]} />
              </View>
            </View>
            <Carousel testID="pack-carousel" label="Sets on sale" onStage items={products} index={index} onIndexChange={setIndex}
              keyOf={(x) => x.product_id} labelOf={(x) => x.name} itemWidth={itemWidth} height={Math.round(itemWidth * 1.62) + 24}
              render={(x) => (
                <View style={{ alignItems: "center", paddingTop: 12 }}>
                  <PackArt setCode={x.set_code} setName={x.set_name} boosterType={x.booster_type} photo={x.pack_image_url} icon={x.icon_svg_uri} width={itemWidth} />
                </View>
              )} />
          </>
        )}

        {p && (
          <View style={s.detail} testID={`product-${p.set_code}`}>
            <Text style={s.title}>{p.name}</Text>
            <Text style={s.price}>
              <Text style={s.priceNum}>{credits(perPack(p.ladder, 1))}</Text> credits a pack
              <Text style={s.dollars}>  {dollars(perPack(p.ladder, 1))}</Text>
            </Text>

            {p.status === "available" ? (
              <>
                <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel="How many packs">
                  {CHIPS.map((n) => {
                    const on = qty === n;
                    const off = n > max;
                    return (
                      <Pressable key={n} testID={`qty-${n}`} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }} aria-checked={on} disabled={off}
                        onPress={() => { setQty(n); }} style={[s.chip, on && s.chipOn, off && { opacity: 0.35 }]}>
                        <Text style={[s.chipQty, on && { color: colors.accentInk }]}>{n} pack{n > 1 ? "s" : ""}</Text>
                        <Text style={[s.chipEach, on && { color: colors.accentInk }]}>{credits(perPack(p.ladder, n))} each</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={s.stepper}>
                  <Pressable testID="qty-minus" accessibilityRole="button" accessibilityLabel="One fewer" disabled={qty <= 1}
                    onPress={() => setQty(qty - 1)} style={[s.step, qty <= 1 && { opacity: 0.35 }]}><Minus size={18} color={colors.text} /></Pressable>
                  <Text style={s.qty} testID="qty" accessibilityLiveRegion="polite">{qty}</Text>
                  <Pressable testID="qty-plus" accessibilityRole="button" accessibilityLabel="One more" disabled={qty >= max}
                    onPress={() => setQty(qty + 1)} style={[s.step, qty >= max && { opacity: 0.35 }]}><Plus size={18} color={colors.text} /></Pressable>
                </View>
              </>
            ) : <StateNote p={p} breakUntil={store.data?.break_until ?? null} />}

            {p.status !== "on_break" && p.status !== "unavailable" ? (
              <Text style={s.muted} testID="set-limit">{p.left_tonight} of {p.night_limit} {p.set_name} packs left for tonight's rip.</Text>
            ) : null}

            {store.data && (
              <Text style={s.cutoff} testID="cutoff">
                Order by 7:00 PM PT to be in tonight's rip. <Text style={s.mono}>{countdownText(store.data.next_cutoff, now)}</Text>
              </Text>
            )}
            {p.wizards_info_url ? (
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(p.wizards_info_url!)} style={s.link} testID="whats-in-a-pack">
                <Text style={s.linkText}>What's in a pack</Text><ExternalLink size={14} color={brand.gold} />
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="link" onPress={() => router.push("/policies")} style={s.link} testID="how-it-works">
              <Text style={s.linkText}>How it works and our fairness promise</Text>
            </Pressable>
            <Text style={s.fine}>
              Your pack stays sealed until the queue locks at 7:00 PM PT. Then we open every pack in queue order and film each one.
              You can cancel for a full credit refund until 7 PM PT.
            </Text>
            <ErrorText>{store.error}</ErrorText>
          </View>
        )}
        <Footer onStage />
      </ScrollView>

      {p && p.status === "available" && (
        <LinearGradient colors={["rgba(22, 20, 28, 0)", "rgba(22, 20, 28, 0.85)"]} style={[s.pinned, { paddingBottom: 12 }]} pointerEvents="box-none">
          <Button testID="buy" label={!me ? "Log in to buy" : balance < total ? `Add credits to buy (${credits(total)})` : `Buy ${qty} · ${credits(total)} credits`}
            onPress={buy} style={{ width: "100%", maxWidth: 520 }} />
        </LinearGradient>
      )}
      {confirming && p && (
        <ConfirmSheet product={p} qty={qty} total={total} suggestLimit={!!limits.data?.suggest_limit}
          onClose={() => setConfirming(false)} onPlaced={() => { store.reload(); limits.reload(); refresh(); }} bottom={insets.bottom} />
      )}
    </Stage>
  );
}

function StateNote({ p, breakUntil }: { p: Product; breakUntil: string | null }) {
  const note: Record<Exclude<Status, "available">, { title: string; body: string; action?: { label: string; to: string } }> = {
    sold_out: { title: "Sold out", body: `There are no sealed ${p.set_name} packs left.`, action: { label: "See drops", to: "/drops" } },
    night_full: { title: "Tonight's packs are taken", body: `All ${p.night_limit} ${p.set_name} packs for tonight's rip are ordered. Orders after 7:00 PM PT go into tomorrow night's rip.` },
    upcoming: { title: "Next drop", body: p.drop_starts_at ? `Goes live ${pacific(p.drop_starts_at)} PT.` : "Coming soon.", action: { label: "See drops", to: "/drops" } },
    ended: { title: "This drop has ended", body: "See Drops for what's next.", action: { label: "See drops", to: "/drops" } },
    unavailable: { title: "Temporarily unavailable", body: `${p.set_name} can't be ordered right now. Check back soon.` },
    on_break: { title: "You're on a break", body: breakUntil ? `You can buy packs again after ${pacific(breakUntil)} PT.` : "", action: { label: "Spending settings", to: "/account" } },
  };
  const n = note[p.status as Exclude<Status, "available">];
  return (
    <View style={s.state} testID={`state-${p.status}`}>
      <Text style={s.stateTitle}>{n.title}</Text>
      <Text style={s.muted}>{n.body}</Text>
      {n.action ? <Button kind="ghost" label={n.action.label} onPress={() => router.push(n.action!.to as never)} /> : null}
    </View>
  );
}

function ConfirmSheet({ product, qty, total, suggestLimit, onClose, onPlaced, bottom }:
  { product: Product; qty: number; total: number; suggestLimit: boolean; onClose: () => void; onPlaced: () => void; bottom: number }) {
  const [askLimit, setAskLimit] = useState(suggestLimit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const { me } = useSession();
  const mustAccept = !!me?.needs_policy_acceptance;
  const [agreed, setAgreed] = useState(false);
  const place = async () => {
    setBusy(true); setError(null);
    try {
      // First purchase: the 18+ confirmation and the Terms are logged before the order.
      if (mustAccept) await api("POST", "/me/policies/accept");
      await api("POST", "/orders", { product_id: product.product_id, quantity: qty });
      setPlaced(true);
      onPlaced();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[s.sheet, { paddingBottom: 24 + bottom }]} testID="order-sheet" accessibilityViewIsModal>
        {askLimit ? (
          <View style={{ gap: 12 }} testID="limit-prompt">
            <Text style={type.h2}>Set a spending limit first?</Text>
            <Text style={type.body}>You can set a daily, weekly or monthly limit in Account. It's optional, and you can change it any time.</Text>
            <View style={s.row}>
              <Button kind="ghost" label="Not now" testID="limit-not-now" onPress={() => setAskLimit(false)} />
              <Button label="Set a limit" onPress={() => { onClose(); router.push("/account"); }} />
            </View>
          </View>
        ) : placed ? (
          <View style={{ gap: 12 }}>
            <Text style={type.h2}>You're in tonight's queue</Text>
            <Text style={type.body} testID="placed">
              {qty} {product.name}{qty > 1 ? "s" : ""}, still sealed. The queue locks at 7:00 PM PT, then we open packs in queue order and film each one.
              We'll email you when your cards and video are in your Vault.
            </Text>
            <Button label="Done" onPress={onClose} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={type.h2}>{product.name}</Text>
            <View style={s.totalRow}>
              <Text style={type.body}>{qty} pack{qty > 1 ? "s" : ""} at {credits(total / qty)} each</Text>
              <Text style={s.total} testID="total">{credits(total)} credits</Text>
            </View>
            <Text style={type.small}>Credits are used on CrackAPack packs only. Cancel before 7:00 PM PT for a full credit refund.</Text>
            {mustAccept && (
              <Pressable testID="accept-policies" accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} aria-checked={agreed} onPress={() => setAgreed(!agreed)} style={s.agree}>
                <View style={[s.box, agreed && s.boxOn]}>{agreed ? <Check size={16} color={colors.accentInk} /> : null}</View>
                <Text style={[type.body, { flex: 1 }]}>
                  I'm 18 or older and I agree to the{" "}
                  <Text style={s.inlineLink} accessibilityRole="link" onPress={() => { onClose(); router.push("/policies/terms"); }}>Terms</Text> and{" "}
                  <Text style={s.inlineLink} accessibilityRole="link" onPress={() => { onClose(); router.push("/policies/privacy"); }}>Privacy Policy</Text>.
                </Text>
              </Pressable>
            )}
            <Button testID="place-order" label="Confirm order" onPress={place} busy={busy} disabled={mustAccept && !agreed} />
            <ErrorText>{error}</ErrorText>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  none: { alignItems: "center", gap: 10, padding: 40 },
  glowWrap: { position: "absolute", top: 70, left: 0, right: 0, alignItems: "center" },
  ring: { borderRadius: 999, backgroundColor: "rgba(255, 61, 129, 0.12)", borderWidth: 1, borderColor: "rgba(255, 61, 129, 0.25)",
    alignItems: "center", justifyContent: "center" },
  ringInner: { borderRadius: 999, backgroundColor: "rgba(122, 92, 255, 0.28)" },
  detail: { gap: 12, paddingHorizontal: 16, paddingTop: 8, maxWidth: 520, width: "100%", alignSelf: "center" },
  title: { fontFamily: font.display, fontSize: 22, lineHeight: 30, color: colors.text, textAlign: "center" },
  price: { fontFamily: font.body, fontSize: 14, color: colors.muted, textAlign: "center" },
  priceNum: { fontFamily: font.bodyBold, fontSize: 21, color: colors.text },
  dollars: { fontFamily: font.bodySemi, fontSize: 14, color: brand.gold },
  muted: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: "center" },
  chips: { flexDirection: "row", gap: 8 },
  chip: { flex: 1, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radii.tile, paddingVertical: 10, alignItems: "center", backgroundColor: colors.panel },
  chipOn: { backgroundColor: brand.magenta, borderColor: brand.magenta },
  chipQty: { fontFamily: font.bodyBold, fontSize: 14, color: colors.text },
  chipEach: { fontFamily: font.body, fontSize: 12, color: colors.muted, marginTop: 1 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 24 },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center" },
  qty: { fontFamily: font.bodyBold, fontSize: 22, color: colors.text, minWidth: 30, textAlign: "center" },
  cutoff: { fontFamily: font.bodyMedium, fontSize: 13.5, color: colors.text, textAlign: "center" },
  mono: { fontFamily: font.bodyBold, color: brand.gold },
  link: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "center", minHeight: 44 },
  linkText: { fontFamily: font.bodySemi, fontSize: 13.5, color: brand.gold, textDecorationLine: "underline" },
  fine: { fontFamily: font.body, fontSize: 12, lineHeight: 18, color: colors.muted, textAlign: "center" },
  state: { gap: 8, alignItems: "center", padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: radii.panel, backgroundColor: colors.panel },
  stateTitle: { fontFamily: font.display, fontSize: 18, color: colors.text },
  pinned: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 24, alignItems: "center" },
  scrim: { flex: 1, backgroundColor: "rgba(10, 8, 16, 0.7)" },
  sheet: { backgroundColor: palette.panel, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxWidth: 560, width: "100%", alignSelf: "center",
    borderWidth: 1, borderColor: palette.line },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  agree: { flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: brand.magenta, alignItems: "center", justifyContent: "center", marginTop: 1 },
  boxOn: { backgroundColor: brand.magenta },
  inlineLink: { color: colors.link, textDecorationLine: "underline", fontFamily: font.bodySemi },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" },
  total: { fontFamily: font.bodyBold, fontSize: 20, color: brand.gold },
});
