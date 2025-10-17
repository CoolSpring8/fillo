const registry = new Map<string, Element>();

export function registerElement(id: string, element: Element): void {
  registry.set(id, element);
}

export function getElement(id: string): Element | undefined {
  return registry.get(id);
}

export function clearRegistry(): void {
  registry.clear();
}
