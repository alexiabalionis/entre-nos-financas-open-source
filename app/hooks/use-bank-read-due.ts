"use client";
/**
 * Leitura dos bancos vencidos (`banks/read-due`): ao habilitar e a cada 30 min,
 * repete até 5x e para quando checked e failed são 0. Chama `onChecked` quando
 * algum banco foi lido. Quem usa decide o que fazer (normalmente
 * `notifyBanksUpdated`, que dispara `family-banks-updated`).
 */
import { useEffect, useRef } from "react";
import { api } from "../lib/api.ts";
import { BANKS_UPDATED_EVENT } from "./use-refresh-on-return.ts";

export function notifyBanksUpdated(): void {
  window.dispatchEvent(new Event(BANKS_UPDATED_EVENT));
}

export function useBankReadDue(enabled: boolean, onChecked: () => void): void {
  const onCheckedRef = useRef(onChecked);

  useEffect(() => {
    onCheckedRef.current = onChecked;
  }, [onChecked]);

  useEffect(() => {
    if (!enabled) return;
    let ended = false;
    const read = async () => {
      for (let i = 0; i < 5 && !ended; i++) {
        const result = await api<{ checked: number; failed: number }>(
          "banks/read-due",
          {},
        ).catch(() => null);
        if (!result || (!result.checked && !result.failed)) break;
        if (result.checked && !ended) onCheckedRef.current();
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 30 * 60 * 1000);
    return () => {
      ended = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}
