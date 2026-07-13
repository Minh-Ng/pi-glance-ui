import { Spacer } from "@earendil-works/pi-tui";

// Owns Glance's transcript-level blank-line rules as one cohesive unit:
//   1. thinking-only blocks collapse their leading blank unless they follow a
//      user boundary (refreshThinking), and
//   2. a text-bearing assistant message gains exactly one trailing blank before
//      an immediately-following tool/action-group component (applyActionSeparator).
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
export class TranscriptSpacer {
  constructor({ isThinkingOnlyComponent, isTextBearingAssistant, isToolComponent }) {
    this.isThinkingOnlyComponent = isThinkingOnlyComponent;
    this.isTextBearingAssistant = isTextBearingAssistant;
    this.isToolComponent = isToolComponent;
    this.suppressLeadingSpacer = Symbol("suppress-leading-thinking-spacer");
    this.trailingSeparator = Symbol("trailing-action-separator");
    this.previousContent = Symbol("previous-transcript-content");
  }

  isSpacer(component) {
    return component instanceof Spacer || component?.constructor?.name === "Spacer";
  }

  // Suppress a thinking-only block's leading blank unless it opens a turn (i.e.
  // follows a user message or nothing). Restores the blank when suppression no
  // longer applies but was previously in effect.
  refreshThinking(component) {
    if (!component?.contentContainer?.children) return;
    const wasSuppressed = Boolean(component[this.suppressLeadingSpacer]);
    const previous = component[this.previousContent];
    const followsUserBoundary = !previous
      || previous.constructor?.name === "UserMessageComponent";
    const shouldSuppress = this.isThinkingOnlyComponent(component) && !followsUserBoundary;
    component[this.suppressLeadingSpacer] = shouldSuppress;
    const first = component.contentContainer.children[0];
    if (shouldSuppress && this.isSpacer(first)) {
      component.contentContainer.children.shift();
    } else if (
      !shouldSuppress
      && wasSuppressed
      && !this.isSpacer(first)
      && component.contentContainer.children.length > 0
    ) {
      component.contentContainer.children.unshift(new Spacer(1));
    }
  }

  // Add/remove one trailing blank between prose and a following tool group.
  applyActionSeparator(component, next) {
    const container = component?.contentContainer;
    if (!container?.children) return;
    const last = container.children[container.children.length - 1];
    const hadSeparator = Boolean(component[this.trailingSeparator]);
    const shouldSeparate = this.isTextBearingAssistant(component) && this.isToolComponent(next);
    if (shouldSeparate) {
      if (!(hadSeparator && this.isSpacer(last))) {
        container.children.push(new Spacer(1));
        component[this.trailingSeparator] = true;
      }
    } else if (hadSeparator) {
      if (this.isSpacer(last)) container.children.pop();
      component[this.trailingSeparator] = false;
    }
  }

  // Single pass: record each non-spacer child's predecessor, refresh its
  // thinking spacer, and manage the trailing separator on the predecessor.
  normalize(children = []) {
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
