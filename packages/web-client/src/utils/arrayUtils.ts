export function arraysEqualBy<T>(left: T[], right: T[], getKey: (value: T) => string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (getKey(left[i]!) !== getKey(right[i]!)) {
      return false;
    }
  }
  return true;
}

export function syncArrayContents<T>(target: T[], next: T[]): void {
  target.length = 0;
  target.push(...next);
}
