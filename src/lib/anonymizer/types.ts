export interface AnonymizationResult {
  anonymizedText: string;
  piiMap: Record<string, string>;
  piiCount: {
    names: number;
    emails: number;
    phones: number;
    companies: number;
    addresses: number;
  };
}
