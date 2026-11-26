/** Prevent overlapping asynchronous work for the same execution within one process. */
export function createSingleFlightGuard() {
  const inFlight = new Set<string>();
  return {
    enter(id: string): boolean {
      if (inFlight.has(id)) return false;
      inFlight.add(id);
      return true;
    },
    leave(id: string): void { inFlight.delete(id); },
  };
}
