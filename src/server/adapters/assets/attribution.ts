/**
 * Execution provenance for an asset generator adapter invocation.
 * Lives outside AssetGeneratorPort so generate returns only GeneratedAssetDocument.
 */
export type AssetExecutionAttribution = {
  providerKey: string;
  capability: string;
  modelId: string | null;
  modelVersion: string | null;
};
