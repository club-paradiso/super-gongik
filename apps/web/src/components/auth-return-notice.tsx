"use client";

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

import {
  hasAuthReturnError,
  withoutAuthReturnError,
} from "@/lib/sync/social-auth";

/*
 * GoTrue sends the browser back with ?error=… (or #error=…) when a social
 * sign-in did not finish: the user cancelled at Kakao/Google, or the provider
 * refused. The address is read once, when this module loads in the browser,
 * so nothing is set from an effect; the server snapshot is "no notice".
 */
let visible =
  typeof window !== "undefined" && hasAuthReturnError(window.location);
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function dismiss() {
  visible = false;
  for (const listener of listeners) listener();
}

export function AuthReturnNotice() {
  const show = useSyncExternalStore(
    subscribe,
    () => visible,
    () => false,
  );

  // Drop GoTrue's error parameters so a reload does not show this again.
  useEffect(() => {
    if (!show) return;
    window.history.replaceState(
      window.history.state,
      "",
      withoutAuthReturnError(window.location.href),
    );
  }, [show]);

  if (!show) return null;

  return (
    <div className="storage-notice" role="alert">
      <AlertTriangle aria-hidden="true" size={20} />
      <div>
        <strong>로그인을 마치지 못했어요.</strong>
        <p>
          이 기기의 기록은 그대로예요. 클라우드 동기화에서 다시 로그인할 수
          있어요.
        </p>
      </div>
      <button
        aria-label="알림 닫기"
        className="icon-button"
        onClick={dismiss}
        type="button"
      >
        <X aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
