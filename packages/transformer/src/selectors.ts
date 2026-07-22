/**
 * Selector generation (S5-4, ARCHITECTURE §7.2): App Modeller elements →
 * best-effort UiPath selectors per mode, each carrying a confidence score
 * and notes. Every generated selector lands on the migration report's
 * mandatory validation checklist — selectors are NEVER claimed verified
 * (they cannot be validated without the live application).
 */
import type { AppElement, AppMode, BusinessObjectNode, ElementAttr } from '@prismshift/ir';
import { escapeXml } from './xaml';

export interface GeneratedSelector {
  elementId: string;
  elementName: string;
  objectName: string;
  mode: AppMode;
  /** UiPath selector string; undefined when strategy is image/OCR. */
  selector?: string;
  strategy: 'selector' | 'image-ocr';
  /** 0–1, capped low for index matches and surface-only attributes. */
  confidence: number;
  notes: string[];
}

/** BP attribute name → UiPath selector attribute, per mode. */
const ATTRIBUTE_MAPS: Partial<Record<AppMode, Record<string, string>>> = {
  HTML: { tag: 'tag', id: 'id', name: 'name', title: 'title', class: 'class', innertext: 'innertext' },
  Win32: { windowtext: 'title', classname: 'cls', name: 'name', controlid: 'ctrlid' },
  UIA: { automationid: 'automationid', name: 'name', classname: 'cls', windowtext: 'title' },
  Java: { name: 'name', role: 'role', description: 'description' },
  SAP: { id: 'id', name: 'name' },
};

const TAG_FOR_MODE: Partial<Record<AppMode, string>> = {
  HTML: 'webctrl',
  Win32: 'wnd',
  UIA: 'ctrl',
  Java: 'java',
  SAP: 'sap',
};

/** Attributes that anchor an element reliably (boost confidence). */
const STRONG_ATTRIBUTES = new Set(['id', 'automationid', 'ctrlid', 'name']);

function usableAttributes(element: AppElement): { used: ElementAttr[]; notes: string[] } {
  const notes: string[] = [];
  const used: ElementAttr[] = [];
  for (const attr of element.attributes) {
    if (!attr.enabled) {
      notes.push(`Attribute "${attr.name}" is disabled in the App Modeller — skipped`);
      continue;
    }
    used.push(attr);
  }
  return { used, notes };
}

export function generateSelector(
  object: BusinessObjectNode,
  element: AppElement,
): GeneratedSelector {
  const base = {
    elementId: element.id,
    elementName: element.name,
    objectName: object.name,
    mode: element.mode,
  };

  // Citrix/Region: no attribute-based automation surface exists.
  if (element.mode === 'Citrix' || element.mode === 'Region') {
    return {
      ...base,
      strategy: 'image-ocr',
      confidence: 0.1,
      notes: [
        `${element.mode} elements have no automatable selector — use Image/OCR activities (Computer Vision recommended) and re-capture against the live application.`,
      ],
    };
  }

  const { used, notes } = usableAttributes(element);
  const attributeMap = ATTRIBUTE_MAPS[element.mode] ?? {};
  const tag = TAG_FOR_MODE[element.mode] ?? 'wnd';

  const parts: string[] = [];
  let hasStrong = false;
  let hasIndex = false;

  for (const attr of used) {
    const mapped = attributeMap[attr.name.toLowerCase()];
    if (attr.matchType === 'index') {
      parts.push(`idx='${escapeXml(attr.value)}'`);
      hasIndex = true;
      notes.push(
        `"${attr.name}" is an index/position match — brittle; re-spy with stable attributes (REL-004)`,
      );
      continue;
    }
    if (mapped === undefined) {
      notes.push(`Attribute "${attr.name}" has no ${element.mode} selector mapping — omitted`);
      continue;
    }
    if (attr.matchType === 'regex') {
      notes.push(`"${attr.name}" used a regex match — approximated as a literal, verify`);
    }
    parts.push(`${mapped}='${escapeXml(attr.value)}'`);
    if (STRONG_ATTRIBUTES.has(mapped)) hasStrong = true;
  }

  if (parts.length === 0) {
    return {
      ...base,
      strategy: 'image-ocr',
      confidence: 0.1,
      notes: [
        ...notes,
        'No usable attributes survived mapping — fall back to Image/OCR or re-spy the element.',
      ],
    };
  }

  let confidence = element.mode === 'SAP' ? 0.85 : element.mode === 'UIA' ? 0.8 : 0.7;
  if (hasStrong) confidence = Math.min(0.9, confidence + 0.15);
  if (parts.length === 1 && !hasStrong) {
    confidence = Math.min(confidence, 0.4);
    notes.push('Only one weak attribute — selector likely matches multiple elements');
  }
  if (hasIndex) {
    confidence = Math.min(confidence, 0.25);
  }

  return {
    ...base,
    selector: `<${tag} ${parts.join(' ')} />`,
    strategy: 'selector',
    confidence: Math.round(confidence * 100) / 100,
    notes,
  };
}

/** All of an object's elements, in App Modeller order. */
export function generateObjectSelectors(object: BusinessObjectNode): GeneratedSelector[] {
  return (object.appModel?.elements ?? []).map((element) => generateSelector(object, element));
}
