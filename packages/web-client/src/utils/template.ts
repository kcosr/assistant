export function cloneTemplate(templateId: string): HTMLElement {
  const template = document.getElementById(templateId);
  if (!template || !(template instanceof HTMLTemplateElement)) {
    throw new Error(`Missing template: ${templateId}`);
  }

  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const element = fragment.firstElementChild as HTMLElement | null;
  if (!element) {
    throw new Error(`Template ${templateId} has no root element`);
  }

  return element;
}
