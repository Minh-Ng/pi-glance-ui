import { Spacer } from "@earendil-works/pi-tui";

// Owns Glance's transcript-level blank-line rules as one cohesive unit:
//   1. Thinking blocks use either one-per-block separated spacing or dense
//      Thinking/tool clusters with outer spacing only, and
//   2. an assistant message ending in prose gains exactly one trailing blank
//      before an immediately-following tool/action-group component (applyActionSeparator).
//
// Both rules are idempotent and self-removing: state is tracked per component
// via instance-private symbols, so re-running normalize() never stacks duplicate
// blanks and clears a blank as soon as the adjacency that justified it is gone.
//
// normalize() does this in a single pass over the children (previously three:
// adjacency, thinking, separator), recording each child's predecessor inline so
// refreshThinking can consult it without a separate sweep.
//
// Component-type predicates are injected so this stays free of the assistant
// message internals (which live in the layout patch).
//
// Bookkeeping symbols are registered (Symbol.for) rather than per-instance: a
// /reload or session replacement creates a new extension generation with a
// fresh TranscriptSpacer, but the transcript components it normalizes may have
// been stamped by the previous generation. Private symbols made that state
// invisible across the handoff, so the new generation pushed a second
// separator blank before every replayed tool/action group (visible as double
// spacing after resume) and could never remove stale ones.
export class TranscriptSpacer {
  constructor({
    isThinkingOnlyComponent,
    startsWithThinkingComponent = isThinkingOnlyComponent,
    endsWithThinkingComponent = isThinkingOnlyComponent,
    isTextBearingAssistant,
    isToolComponent,
    isTransparentComponent = () => false,
    isVisiblyRenderedTool = () => false,
    getTranscriptSpacingMode = () => "separated",
  }) {
    this.isThinkingOnlyComponent = isThinkingOnlyComponent;
    this.startsWithThinkingComponent = startsWithThinkingComponent;
    this.endsWithThinkingComponent = endsWithThinkingComponent;
    this.isTextBearingAssistant = isTextBearingAssistant;
    this.isToolComponent = isToolComponent;
    this.isTransparentComponent = isTransparentComponent;
    this.isVisiblyRenderedTool = isVisiblyRenderedTool;
    this.getTranscriptSpacingMode = getTranscriptSpacingMode;
    this.suppressLeadingSpacer = Symbol.for("pi-glance-ui:suppress-leading-thinking-spacer");
    this.trailingSeparator = Symbol.for("pi-glance-ui:trailing-action-separator");
    this.previousContent = Symbol.for("pi-glance-ui:previous-transcript-content");
    this.collapsedThinkingSeparators = Symbol.for("pi-glance-ui:collapsed-thinking-separators");
  }

  isSpacer(component) {
    return component instanceof Spacer || component?.constructor?.name === "Spacer";
  }

  // Separated mode keeps one blank before every visible Thinking block unless
  // final prose already supplied that same boundary through only hidden rows.
  // Dense mode additionally removes blanks inside visible Thinking/tool clusters.
  refreshThinking(component, width) {
    const children = component?.contentContainer?.children;
    if (!Array.isArray(children)) return;
    const startsThinking = this.startsWithThinkingComponent(component);
    const dense = this.getTranscriptSpacingMode() === "dense";
    let previous = component[this.previousContent];
    let suppressLeadingSpacer = false;
    while (previous) {
      if (previous[this.trailingSeparator] === true) {
        suppressLeadingSpacer = true;
        break;
      }
      if (startsThinking && dense && this.endsWithThinkingComponent(previous)) {
        suppressLeadingSpacer = true;
        break;
      }
      if (this.isToolComponent(previous)) {
        const visible = width !== undefined && this.isVisiblyRenderedTool(previous, width);
        if (visible) {
          suppressLeadingSpacer = startsThinking && dense;
          break;
        }
        previous = previous[this.previousContent];
        continue;
      }
      if (this.isTransparentComponent(previous)) {
        previous = previous[this.previousContent];
        continue;
      }
      break;
    }
    // A prose separator before only hidden rows already owns the boundary for
    // any following assistant content. Remove the current component's native
    // leading spacer rather than mutating the earlier, already-rendered prose.
    if (!startsThinking && !suppressLeadingSpacer) return;
    component[this.suppressLeadingSpacer] = suppressLeadingSpacer;

    let leadingCount = 0;
    while (this.isSpacer(children[leadingCount])) leadingCount += 1;
    const desired = suppressLeadingSpacer ? 0 : 1;
    if (leadingCount < desired && children.length > 0) {
      children.unshift(new Spacer(1));
    } else if (leadingCount > desired) {
      children.splice(0, leadingCount - desired);
    }
  }

  // Add/remove one trailing blank between final prose and a following tool group.
  applyActionSeparator(component, next) {
    const container = component?.contentContainer;
    if (!container?.children) return;
    const last = container.children[container.children.length - 1];
    const hadSeparator = Boolean(component[this.trailingSeparator]);
    const shouldSeparate = this.isTextBearingAssistant(component) && this.isToolComponent(next);
    if (shouldSeparate) {
      // Structural guard: never stack a second blank even if ownership state
      // was stamped by a generation using the old private-symbol scheme.
      if (!this.isSpacer(last)) {
        container.children.push(new Spacer(1));
      }
      component[this.trailingSeparator] = true;
    } else if (hadSeparator) {
      if (this.isSpacer(last)) container.children.pop();
      component[this.trailingSeparator] = false;
    }
  }

  // Normalize Thinking children inside one assistant component. Dense mode
  // removes only Thinking→Thinking interior blanks; text still breaks the
  // cluster and receives one blank on either side.
  normalizeRenderedThinkingChildren(component, isThinkingChild) {
    const children = component?.contentContainer?.children;
    if (!Array.isArray(children)) return;
    const dense = this.getTranscriptSpacingMode() === "dense";
    for (let index = 0; index < children.length; index += 1) {
      if (!isThinkingChild(children[index])) continue;
      let separatorStart = index;
      while (separatorStart > 0 && this.isSpacer(children[separatorStart - 1])) {
        separatorStart -= 1;
      }
      const separatorCount = index - separatorStart;
      const previousVisible = children[separatorStart - 1];
      const desired = dense && previousVisible && isThinkingChild(previousVisible) ? 0 : 1;
      if (separatorCount < desired) {
        children.splice(index, 0, new Spacer(1));
        index += 1;
      } else if (separatorCount > desired) {
        children.splice(separatorStart, separatorCount - desired);
        index -= separatorCount - desired;
      }
    }
  }

  // Pi can provide both a transcript-level spacer and a Thinking component's
  // own leading spacer. Keep the component spacer as the single visible blank
  // and temporarily remove any transcript-level duplicates. Store removed
  // objects on the component so a later content-type change can restore them,
  // including after /reload creates a fresh TranscriptSpacer generation.
  normalizeThinkingBoundaries(children) {
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      const removed = child?.[this.collapsedThinkingSeparators];
      if (!Array.isArray(removed) || removed.length === 0) continue;
      if (
        !this.isSpacer(children[index - 1])
        && !this.isSpacer(child.contentContainer?.children?.[0])
      ) {
        children.splice(index, 0, ...removed);
        index += removed.length;
      }
      child[this.collapsedThinkingSeparators] = undefined;
    }

    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (this.isSpacer(child) || !this.startsWithThinkingComponent(child)) continue;
      if (!this.isSpacer(child.contentContainer?.children?.[0])) continue;

      let separatorStart = index;
      while (separatorStart > 0 && this.isSpacer(children[separatorStart - 1])) {
        separatorStart -= 1;
      }
      const separatorCount = index - separatorStart;
      if (separatorCount > 0) {
        child[this.collapsedThinkingSeparators] = children.splice(
          separatorStart,
          separatorCount,
        );
        index -= separatorCount;
      }
    }
  }

  // Single pass: refresh each Thinking spacer and manage the trailing
  // prose→tool separator on the predecessor.
  normalize(children = []) {
    this.normalizeThinkingBoundaries(children);
    let previous;
    for (const child of children) {
      if (this.isSpacer(child)) continue;
      child[this.previousContent] = previous;
      this.refreshThinking(child);
      if (previous) this.applyActionSeparator(previous, child);
      previous = child;
    }
    // The final component has no successor, so clear any separator left behind
    // by a tool group that is no longer there.
    if (previous) this.applyActionSeparator(previous, undefined);
  }
}
