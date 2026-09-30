import type { ReservationEcho } from "@/server/sg/lane-rate";

/**
 * Side channel for gateway ids that must not enter GeneratedAssetDocument
 * or AssetGeneratorPort. The HTTP adapter remembers them on the document
 * object it returns; AssetService reads them once and stores them on the
 * fulfillment attempt. `reservation` is the generate-response echo used to
 * verify the app hold. It is not written onto the asset document.
 */
export type GatewayFulfillmentTrace = {
  gatewayJobId: string | null;
  gatewayReservationId: string | null;
  actualBilledSeconds: number | null;
  actualUsd: number | null;
  reservation?: ReservationEcho | null;
};

const traces = new WeakMap<object, GatewayFulfillmentTrace>();

export function rememberGatewayTrace(target: object, trace: GatewayFulfillmentTrace): void {
  traces.set(target, trace);
}

export function gatewayTraceFor(target: object): GatewayFulfillmentTrace | null {
  return traces.get(target) ?? null;
}
