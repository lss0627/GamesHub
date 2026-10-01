export interface LicenseBroker {
  activate(
    licenseId: string,
    runId: string,
  ): Promise<{ activationRef: string }>;
  return(activationRef: string): Promise<void>;
}

export class InMemoryLicenseBroker implements LicenseBroker {
  private readonly active = new Set<string>();
  constructor(private readonly approvedLicenseIds?: ReadonlySet<string>) {}
  async activate(
    licenseId: string,
    runId: string,
  ): Promise<{ activationRef: string }> {
    if (!licenseId || !runId) throw new Error('LICENSE_REF_REQUIRED');
    if (this.approvedLicenseIds && !this.approvedLicenseIds.has(licenseId))
      throw new Error('LICENSE_UNAVAILABLE');
    const activationRef = `activation:${licenseId}:${runId}`;
    if (this.active.has(activationRef)) return { activationRef };
    this.active.add(activationRef);
    return { activationRef };
  }
  async return(activationRef: string): Promise<void> {
    this.active.delete(activationRef);
  }
  isActive(activationRef: string): boolean {
    return this.active.has(activationRef);
  }
}
