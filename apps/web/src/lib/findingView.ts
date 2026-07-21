import type { AutomationModel, Finding, FindingSeverity } from '@prismshift/ir';

/** A finding's location resolved to names + ids the UI can act on. */
export interface FindingLocation {
  ownerId?: string;
  ownerName?: string;
  pageId?: string;
  pageName?: string;
  stageId?: string;
  stageName?: string;
  elementName?: string;
}

export function resolveFinding(model: AutomationModel, finding: Finding): FindingLocation {
  const { location } = finding;
  const owner =
    model.processes.find((p) => p.id === location.processId) ??
    model.objects.find((o) => o.id === location.objectId);
  if (!owner) return {};

  const resolved: FindingLocation = { ownerId: owner.id, ownerName: owner.name };
  const page = owner.pages.find((p) => p.id === location.pageId);
  if (page) {
    resolved.pageId = page.id;
    resolved.pageName = page.name;
    const stage = page.stages.find((s) => s.id === location.stageId);
    if (stage) {
      resolved.stageId = stage.id;
      resolved.stageName = stage.name;
    }
  }
  if (location.elementId !== undefined && 'appModel' in owner) {
    const element = owner.appModel?.elements.find((e) => e.id === location.elementId);
    if (element) resolved.elementName = element.name;
  }
  return resolved;
}

export const SEVERITY_ORDER: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_BADGE: Record<FindingSeverity, string> = {
  critical: 'bg-rose-600/20 text-rose-300 border-rose-500/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  info: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

export const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  B: 'text-lime-400 border-lime-500/40 bg-lime-500/10',
  C: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  D: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  E: 'text-rose-400 border-rose-500/40 bg-rose-500/10',
  F: 'text-rose-400 border-rose-500/40 bg-rose-500/10',
};
