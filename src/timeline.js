import { truncateToWidth } from "@earendil-works/pi-tui";
import { activityPhaseForTool, activityToolPhaseLabel, groupLabel, groupLabelColor, renderBlockHeading, toolCategory } from "./format.js";

const MAX_COLLAPSED_ACTIONS = 10;

export class RecentToolSummary {
  constructor(timeline, entry) {
    this.timeline = timeline;
    this.entry = entry;
  }

  render(width) {
    return this.timeline.renderEntry(this.entry, width);
  }

  invalidate() {}
}

export class ToolTimeline {
  constructor(sectionController) {
    this.sectionController = sectionController;
    this.entriesById = new Map();
    this.detachedIds = new Set();
    this.barrierEpoch = 0;
    this.isRebuildingTranscript = false;
    this.restrictToActiveIds = true;
    this.lastGroup = undefined;
    this.activeEntries = [];
  }

  startAgent() {
    for (const entry of this.activeEntries) entry.isActive = false;
    this.detachedIds.clear();
    this.barrierEpoch += 1;
    this.restrictToActiveIds = true;
    this.lastGroup = undefined;
    this.activeEntries = [];
  }

  breakGroup() {
    this.barrierEpoch += 1;
    this.lastGroup = undefined;
  }

  rebuildFromMessages(messages, streamingMessage) {
    this.entriesById.clear();
    this.detachedIds.clear();
    this.barrierEpoch += 1;
    this.lastGroup = undefined;
    this.activeEntries = [];
    this.isRebuildingTranscript = true;
    this.restrictToActiveIds = true;

    const transcriptMessages = streamingMessage && !messages.includes(streamingMessage)
      ? [...messages, streamingMessage]
      : messages;
    const latestTurnBoundary = transcriptMessages.findLastIndex(
      (message) => message.role === "user" || message.role === "custom",
    );
    let turnEntries = latestTurnBoundary === -1 ? this.activeEntries : [];
    let isActiveTurn = latestTurnBoundary === -1;
    for (let index = 0; index < transcriptMessages.length; index += 1) {
      const message = transcriptMessages[index];
      if (message.role === "user" || message.role === "custom") {
        this.breakGroup();
        turnEntries = [];
        isActiveTurn = index === latestTurnBoundary;
        if (isActiveTurn) this.activeEntries = turnEntries;
        continue;
      }
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      const isDetached = message.content.some(
        (item) => (item.type === "text" && item.text?.trim())
          || (item.type === "thinking" && item.thinking?.trim()),
      );
      for (const item of message.content) {
        if (item.type !== "toolCall") continue;
        this.setDetached(item.id, isDetached);
        this.registerForTurn(
          item.id,
          toolCategory(item.name, item.arguments),
          activityPhaseForTool(item.name, item.arguments),
          turnEntries,
          isActiveTurn,
        );
      }
    }
  }

  finishTranscriptRebuild() {
    this.isRebuildingTranscript = false;
  }

  clearTranscript() {
    this.entriesById.clear();
    this.detachedIds.clear();
    this.barrierEpoch += 1;
    this.lastGroup = undefined;
    this.activeEntries = [];
    this.isRebuildingTranscript = false;
    this.restrictToActiveIds = true;
    this.sectionController.removeKinds(["tools"]);
  }

  setDetached(id, detached) {
    if (detached) this.detachedIds.add(id);
    else this.detachedIds.delete(id);
    const entry = this.entriesById.get(id);
    if (entry) entry.detached = detached;
  }

  registerActive(id, category, phase = "act") {
    const existing = this.entriesById.get(id);
    if (existing?.isActive) return existing;
    if (existing) this.entriesById.delete(id);
    return this.registerForTurn(id, category, phase, this.activeEntries, true);
  }

  registerForTurn(id, category, phase, turnEntries, isActive) {
    const existing = this.entriesById.get(id);
    if (existing) return existing;
    const group = this.lastGroup?.category === category
      && this.lastGroup.phase === phase
      && this.lastGroup.barrierEpoch === this.barrierEpoch
      ? this.lastGroup
      : {
        id,
        category,
        phase,
        barrierEpoch: this.barrierEpoch,
        entries: [],
        components: new Map(),
        expandedOverride: undefined,
        isGloballyExpanded: false,
      };
    if (group !== this.lastGroup) this.lastGroup = group;
    const entry = {
      id,
      group,
      state: "running",
      detached: this.detachedIds.has(id),
      firstInAgent: turnEntries.length === 0,
      isActive,
      isTracked: true,
      turnEntries,
    };
    group.entries.push(entry);
    turnEntries.push(entry);
    this.entriesById.set(id, entry);
    this.registerGroupSection(group);
    return entry;
  }

  register(id, category, phase = "act") {
    const existing = this.entriesById.get(id);
    if (existing) return existing;
    if (!this.restrictToActiveIds) return this.registerActive(id, category, phase);
    const group = {
      id: `untracked:${id}`,
      category,
      phase,
      entries: [],
      components: new Map(),
      inactive: true,
    };
    const entry = {
      id,
      group,
      state: "running",
      detached: false,
      firstInAgent: false,
      isActive: false,
      isTracked: false,
      turnEntries: [],
    };
    group.entries.push(entry);
    this.entriesById.set(id, entry);
    return entry;
  }

  registerGroupSection(group) {
    if (group.inactive) return;
    const isExpanded = () => group.entries.some((entry) => entry.workingCompact)
      ? false
      : group.expandedOverride ?? group.isGloballyExpanded;
    this.sectionController.register({
      id: `tools:${group.id}`,
      kind: "tools",
      label: `${activityToolPhaseLabel(group.phase)} · ${groupLabel(group.category)} · ${group.entries.length} action${group.entries.length === 1 ? "" : "s"}`,
      isExpanded,
      toggle: () => {
        group.expandedOverride = !isExpanded();
        if (group.expandedOverride) {
          for (const entry of group.entries) entry.workingCompact = false;
        }
        for (const setExpanded of group.components.values()) {
          setExpanded(group.expandedOverride);
        }
      },
    });
  }

  isCurrentWorkingEntry(entry) {
    if (!entry?.isActive) return false;
    const current = this.activeEntries.findLast((candidate) => {
      if (!candidate.isActive) return false;
      return candidate.component ? candidate.component.isPartial : candidate.state === "running";
    });
    return current === entry;
  }

  attachComponent(entry, component, setExpanded) {
    entry.component = component;
    entry.group.components.set(component, setExpanded);
    entry.group.isGloballyExpanded = Boolean(component.expanded);
    this.registerGroupSection(entry.group);
  }

  setGlobalExpanded(id, isExpanded) {
    const entry = this.entriesById.get(id);
    if (!entry?.isTracked) return;
    entry.group.isGloballyExpanded = isExpanded;
    entry.group.expandedOverride = undefined;
    this.registerGroupSection(entry.group);
  }

  update(entry, { state, detail, theme }) {
    entry.state = state;
    entry.detail = detail;
    entry.theme = theme;
  }

  renderEntry(entry, width) {
    if (!entry.isTracked) return [];
    const visibleEntries = entry.turnEntries.slice(-MAX_COLLAPSED_ACTIONS);
    const visibleIndex = visibleEntries.indexOf(entry);
    if (visibleIndex === -1 || !entry.detail || !entry.theme) return [];

    const lines = [];
    const previousEntry = visibleEntries[visibleIndex - 1];
    const nextEntry = visibleEntries[visibleIndex + 1];
    const isDetachedEntry = entry.detached && Boolean(previousEntry);
    const startsGroup = isDetachedEntry
      || !previousEntry
      || previousEntry.group !== entry.group;
    if (visibleIndex === 0 && !entry.detached) lines.push("\u2800");
    if (startsGroup) {
      const visibleGroupEntries = visibleEntries.filter(
        (item) => item.group === entry.group,
      );
      const states = visibleGroupEntries.map((item) => item.state);
      const state = states.includes("failed")
        ? "failed"
        : states.includes("running") ? "running" : "complete";
      const count = entry.turnEntries.length;
      const countLabel = visibleIndex === 0
        ? count > MAX_COLLAPSED_ACTIONS
          ? ` · last ${MAX_COLLAPSED_ACTIONS} of ${count}`
          : ` · ${count}`
        : "";
      lines.push(renderBlockHeading(entry.theme, {
        label: `${activityToolPhaseLabel(entry.group.phase)} · ${groupLabel(entry.group.category)}`,
        labelColor: groupLabelColor(entry.group.category),
        state,
        isExpanded: entry.group.entries.some((item) => item.workingCompact)
          ? false
          : entry.group.expandedOverride ?? entry.group.isGloballyExpanded,
        metadata: countLabel,
      }));
    }

    const connector = isDetachedEntry
      || !nextEntry
      || nextEntry.group !== entry.group
      ? "└"
      : "├";
    const detailLines = entry.detail(connector);
    lines.push(...(Array.isArray(detailLines) ? detailLines : [detailLines]));
    return lines.map((line) => truncateToWidth(line, Math.max(1, width), "…"));
  }
}
