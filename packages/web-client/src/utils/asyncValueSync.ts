export class AsyncValueSync<T> {
  private inFlight = false;
  private hasDesiredValue = false;
  private desiredValue: T | undefined;
  private hasSyncedValue = false;
  private syncedValue: T | undefined;

  constructor(
    private readonly send: (value: T) => Promise<boolean>,
    private readonly isEqual: (left: T, right: T) => boolean = Object.is,
  ) {}

  request(value: T): void {
    this.desiredValue = value;
    this.hasDesiredValue = true;
    if (this.inFlight) {
      return;
    }
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    while (this.hasDesiredValue) {
      const desiredValue = this.desiredValue as T;
      if (this.hasSyncedValue && this.isEqual(this.syncedValue as T, desiredValue)) {
        this.hasDesiredValue = false;
        return;
      }

      this.inFlight = true;
      let success = false;
      try {
        success = await this.send(desiredValue);
      } catch {
        return;
      } finally {
        this.inFlight = false;
      }

      const desiredChanged =
        this.hasDesiredValue && !this.isEqual(this.desiredValue as T, desiredValue);
      if (!success) {
        if (desiredChanged) {
          continue;
        }
        return;
      }

      this.syncedValue = desiredValue;
      this.hasSyncedValue = true;
      if (!desiredChanged) {
        this.hasDesiredValue = false;
        return;
      }
    }
  }
}
