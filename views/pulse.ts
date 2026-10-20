// The working-dot pulse: a slow blink whose period tracks the thread's
// measured token burn, so a thread consuming 10× the tokens pulses 10× as
// fast.
//
// Rates come from the plugin's own sampler, which runs whenever bb reports
// token usage — not only while the flow tab is open — so the aggregate views
// can be the only thing on screen and still pulse honestly. The mapping and
// its clamps are pure and tested in views/model.ts (`pulsePeriodMs`).
import { useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { FLOW_CHANGED } from "../shared";
import type { rpcContract } from "../server";

/** How often the aggregate views ask for fresh rates. */
const PULSE_POLL_MS = 20_000;

export type PulseRates = ReadonlyMap<string, number>;

/**
 * Poll the plugin's burn-rate RPC while the panel is visible.
 *
 * Polling (rather than pushing every sample) keeps the channel quiet: rates
 * only need to keep up with a blink. A hidden tab stops polling, and a failed
 * poll keeps the last good rates — a blink rate that lags is honest, whereas
 * clearing the map would make every working dot fall back to the base pulse
 * and quietly misreport the roster.
 */
export function usePulseRates(): PulseRates {
  const rpc = useRpc<typeof rpcContract>();
  const [rates, setRates] = useState<PulseRates>(() => new Map());
  const inFlight = useRef(false);
  /** The live refetch, so the realtime nudge can pull fresh rates at once. */
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden || inFlight.current) return;
      inFlight.current = true;
      rpc.call("pulse", {}).then(
        (result) => {
          inFlight.current = false;
          if (cancelled) return;
          setRates(new Map(Object.entries(result.rates)));
        },
        () => {
          inFlight.current = false;
        },
      );
    };
    tickRef.current = tick;
    tick();
    const timer = setInterval(tick, PULSE_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rpc]);

  // A token-usage burst means a rate changed now: pull the fresh rates ahead
  // of the next poll, so a thread that just started burning does not blink at
  // its old pace for up to a poll interval.
  useRealtime(FLOW_CHANGED, () => {
    if (!document.hidden) tickRef.current();
  });

  return rates;
}
