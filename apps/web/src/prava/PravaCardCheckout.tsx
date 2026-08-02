import { useEffect, useRef } from "react";

type Props = {
  publishableKey: string;
  sessionToken: string;
  iframeUrl: string;
  onSuccess?: () => void;
  onError?: (error: { code: string; message: string }) => void;
};

export function PravaCardCheckout({ publishableKey, sessionToken, iframeUrl, onSuccess, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let sdkRef: { destroy: () => void } | null = null;

    async function mount() {
      const { PravaSDK } = await import("@prava-sdk/core");
      if (!active || !containerRef.current) return;
      const sdk = new PravaSDK({ publishableKey });
      sdkRef = sdk;
      sdk.collectPAN({
        sessionToken,
        iframeUrl,
        container: containerRef.current,
        onSuccess: () => {
          if (active) onSuccess?.();
        },
        onError: (err) => {
          if (active) onError?.({ code: err.code, message: err.message });
        },
      });
    }

    mount().catch((err) => {
      if (active) onError?.({ code: "PRAVA_SDK_INIT_ERROR", message: err instanceof Error ? err.message : "Failed to mount Prava card form." });
    });

    return () => {
      active = false;
      sdkRef?.destroy();
    };
  }, [publishableKey, sessionToken, iframeUrl, onSuccess, onError]);

  return <div id="prava-card-form" ref={containerRef} className="prava-card-form" />;
}
