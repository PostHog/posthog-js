import {
  serializeNodeWithId,
  transformAttribute,
  IGNORED_NODE,
  ignoreAttribute,
  isShadowRoot,
  needMaskingText,
  maskInputValue,
  maskAttributeValue,
  isNativeShadowDom,
  getInputType,
  toLowerCase,
  nowMs,
  getSuspensionGeneration,
  recordMutationCost,
} from '@posthog/rrweb-snapshot';
import type { observerParam, MutationBufferParam } from '../types';
import type {
  mutationRecord,
  textCursor,
  attributeCursor,
  removedNodeMutation,
  addedNodeMutation,
} from '@posthog/rrweb-types';
import {
  isBlocked,
  isAncestorRemoved,
  isIgnored,
  isSerialized,
  hasShadowRoot,
  isSerializedIframe,
  isSerializedStylesheet,
  inDom,
  getShadowHost,
  closestElementOfNode,
} from '../utils';
import dom from '@posthog/rrweb-utils';

const moveKey = (id: number, parentId: number) => `${id}@${parentId}`;

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

function getSerializedAttributeName(
  target: Element,
  localName: string,
  namespace: string | null,
): string {
  if (!namespace) return localName;
  const attribute = target.getAttributeNodeNS(namespace, localName);
  if (attribute) return attribute.name;
  // Removed attributes no longer expose their prefix, so retain standard ones.
  if (namespace === XLINK_NAMESPACE) return `xlink:${localName}`;
  if (namespace === XML_NAMESPACE) return `xml:${localName}`;
  if (namespace === XMLNS_NAMESPACE) {
    return localName === 'xmlns' ? localName : `xmlns:${localName}`;
  }
  const prefix = target.lookupPrefix(namespace);
  return prefix ? `${prefix}:${localName}` : localName;
}

/**
 * controls behaviour of a MutationObserver
 */
export default class MutationBuffer {
  private frozen = false;
  private locked = false;

  private texts: textCursor[] = [];
  private attributes: attributeCursor[] = [];
  private attributeMap = new WeakMap<Node, attributeCursor>();
  private generatedAttributes = new WeakMap<Node, Set<string>>();
  private removes: removedNodeMutation[] = [];
  // Repeated moves can queue the same root before any mirror cleanup runs.
  // Keep first-seen order without traversing an identical root again at emit.
  private mapRemoves = new Set<Node>();

  private movedMap: Record<string, true> = {};

  /**
   * the browser MutationObserver emits multiple mutations after
   * a delay for performance reasons, making tracing added nodes hard
   * in our `processMutations` callback function.
   * For example, if we append an element el_1 into body, and then append
   * another element el_2 into el_1, these two mutations may be passed to the
   * callback function together when the two operations were done.
   * Generally we need to trace child nodes of newly added nodes, but in this
   * case if we count el_2 as el_1's child node in the first mutation record,
   * then we will count el_2 again in the second mutation record which was
   * duplicated.
   * To avoid of duplicate counting added nodes, we use a Set to store
   * added nodes and its child nodes during iterate mutation records. Then
   * collect added nodes from the Set which have no duplicate copy. But
   * this also causes newly added nodes will not be serialized with id ASAP,
   * which means all the id related calculation should be lazy too.
   */
  private addedSet = new Set<Node>();
  private movedSet = new Set<Node>();
  private droppedSet = new Set<Node>();
  private removesSubTreeCache = new Set<Node>();

  private mutationCb: observerParam['mutationCb'];
  private blockClass: observerParam['blockClass'];
  private blockSelector: observerParam['blockSelector'];
  private maskTextClass: observerParam['maskTextClass'];
  private maskTextSelector: observerParam['maskTextSelector'];
  private inlineStylesheet: observerParam['inlineStylesheet'];
  private maskInputOptions: observerParam['maskInputOptions'];
  private maskTextFn: observerParam['maskTextFn'];
  private maskInputFn: observerParam['maskInputFn'];
  private maskAllElementAttributes: observerParam['maskAllElementAttributes'];
  private maskAttributeFn: observerParam['maskAttributeFn'];
  private keepIframeSrcFn: observerParam['keepIframeSrcFn'];
  private recordCanvas: observerParam['recordCanvas'];
  private canvasMaskingConfigured: observerParam['canvasMaskingConfigured'];
  private inlineImages: observerParam['inlineImages'];
  private slimDOMOptions: observerParam['slimDOMOptions'];
  private dataURLOptions: observerParam['dataURLOptions'];
  private doc: observerParam['doc'];
  private mirror: observerParam['mirror'];
  private iframeManager: observerParam['iframeManager'];
  private stylesheetManager: observerParam['stylesheetManager'];
  private shadowDomManager: observerParam['shadowDomManager'];
  private canvasManager: observerParam['canvasManager'];
  private processedNodeManager: observerParam['processedNodeManager'];
  private unattachedDoc: HTMLDocument;
  private canvasManagerReleased = false;

  public init(options: MutationBufferParam): void {
    (
      [
        'mutationCb',
        'blockClass',
        'blockSelector',
        'maskTextClass',
        'maskTextSelector',
        'inlineStylesheet',
        'maskInputOptions',
        'maskTextFn',
        'maskInputFn',
        'maskAllElementAttributes',
        'maskAttributeFn',
        'keepIframeSrcFn',
        'recordCanvas',
        'canvasMaskingConfigured',
        'inlineImages',
        'slimDOMOptions',
        'dataURLOptions',
        'doc',
        'mirror',
        'iframeManager',
        'stylesheetManager',
        'shadowDomManager',
        'canvasManager',
        'processedNodeManager',
      ] as const
    ).forEach((key) => {
      // just a type trick, the runtime result is correct
      this[key] = options[key] as never;
    });
    // Balanced by releaseCanvasManager() in reset().
    this.canvasManager.acquire();
  }

  public freeze(): void {
    this.frozen = true;
    this.canvasManager.freeze();
  }

  public unfreeze(): void {
    this.frozen = false;
    this.canvasManager.unfreeze();
    this.emit();
  }

  public isFrozen(): boolean {
    return this.frozen;
  }

  public lock(): void {
    this.locked = true;
    this.canvasManager.lock();
  }

  public unlock(): void {
    this.locked = false;
    this.canvasManager.unlock();
    this.emit();
  }

  public reset(): void {
    // Don't reset the shared shadowDomManager here — that would disconnect every shadow-root observer on the page when any single buffer is torn down.
    this.releaseCanvasManager();
  }

  // Idempotent so teardown can run twice (iframe pagehide + stop); shadow restore handlers call this directly, not reset(), per the recursion-guard unit test.
  public releaseCanvasManager(): void {
    if (this.canvasManagerReleased) {
      return;
    }
    this.canvasManagerReleased = true;
    this.canvasManager.reset();
    // Don't null `this.doc` here — a MutationObserver callback queued before
    // the observer was disconnected can still drain through `emit`, which
    // passes `this.doc` to `serializeNodeWithId`. Splicing the buffer out of
    // `mutationBuffers[]` + removing the cleanup closure from `handlers[]`
    // releases the only strong refs to the buffer; GC handles the rest.
  }

  public bufferDoc(): Document {
    return this.doc;
  }

  public destroy(): void {
    for (const node of this.mapRemoves) {
      // Consume before traversal, as shift() did, including when it throws.
      this.mapRemoves.delete(node);
      this.mirror.removeNodeFromMap(node);
    }
  }

  public processMutations = (mutations: mutationRecord[]): void => {
    mutations.forEach(this.processMutation); // adds mutations to the buffer
    this.emit(); // clears buffer if not locked/frozen
  };

  public emit = (): void => {
    if (this.frozen || this.locked) {
      return;
    }

    // Processing a burst serializes every added subtree inline, which on churn-heavy
    // pages (virtualized lists, calendars) is where the recorder's main-thread time
    // goes. Measure it so that cost is visible without a Chrome trace.
    const startedAt = nowMs();
    const startGeneration = getSuspensionGeneration();
    try {
      this.processBufferedMutations();
    } finally {
      recordMutationCost(nowMs() - startedAt, startGeneration);
    }
  };

  // Queued nodes can become blocked before emission. Check the current tree,
  // including each shadow host: closest()/parentElement do not cross that boundary.
  private isBlockedAtEmission(node: Node | null): boolean {
    const blockClass = this.blockClass;
    // Match stateful patterns from zero without writing to the configured
    // regexp, whose lastIndex may be non-writable. Keep all flags, including y.
    const stateful =
      blockClass &&
      typeof blockClass !== 'string' &&
      (blockClass.global || blockClass.sticky)
        ? new RegExp(blockClass)
        : null;
    while (node) {
      if (stateful) stateful.lastIndex = 0;
      if (isBlocked(node, stateful || blockClass, this.blockSelector, true))
        return true;
      const root = 'getRootNode' in node ? dom.getRootNode(node) : null;
      node =
        root?.nodeType === Node.DOCUMENT_FRAGMENT_NODE
          ? dom.host(root as ShadowRoot)
          : null;
    }
    return false;
  }

  private processBufferedMutations = () => {
    // delay any modification of the mirror until this function
    // so that the mirror for takeFullSnapshot doesn't get mutated while it's event is being processed

    const adds: addedNodeMutation[] = [];
    const addedIds = new Set<number>();

    // Reuse configuration and callbacks within this emission, not DOM values.
    // serializeNodeWithId does not mutate the options; needsMask stays unset so
    // each node still checks its own masking context.
    let serializationOptions:
      | Parameters<typeof serializeNodeWithId>[1]
      | undefined;

    // Drain mapRemoves before serializing adds so the mirror only holds nodes
    // that are still live. Reparent detection in record/index.ts depends on this
    // order — it resolves an `add`'s fresh id back to an element via
    // `mirror.getNode` and matches it against the iframe behind the removed
    // id. Reorder this and iframe moves will look like remove+add to that
    // path, tearing down observers on a still-live iframe.
    for (const node of this.mapRemoves) {
      this.mapRemoves.delete(node);
      this.mirror.removeNodeFromMap(node);
    }

    for (const n of this.movedSet) {
      const parent = dom.parentNode(n);
      if (
        this.removesSubTreeCache.has(parent as Node) &&
        !this.movedSet.has(parent as Node)
      ) {
        continue;
      }
      this.addedSet.add(n);
    }

    // Serialize each added tree from its root down and each row of siblings
    // from the last one back, so a node's parentId and nextId are always known
    // when it is serialized. One parent lookup, one eligibility check and one
    // parentId serve a whole row of siblings. This reorders the emitted adds
    // list; the replayer applies each add by parentId and nextId, so the
    // resulting DOM is the same.
    let n: Node | null = null;
    let parentNode: Node | null = null;
    let parentId = -1;
    let nextSibling: Node | null = null;
    let ancestorBad = false;
    const missingParents = new Set<Node>();
    const iter = this.addedSet.values();
    let curr = iter.next();
    while (this.addedSet.size) {
      if (n !== null && this.addedSet.has(dom.previousSibling(n) as Node)) {
        // Still the same row, so parentNode, parentId and ancestorBad hold.
        nextSibling = n;
        n = dom.previousSibling(n) as Node;
      } else {
        if (!this.addedSet.has(curr.value as Node)) {
          // Advance the iterator rather than reading the set again: a node the
          // row walk already served is a tombstone the iterator skips.
          curr = iter.next();
          // The loop deletes every node it visits, so the set is empty when the
          // iterator ends. Stop anyway rather than read an undefined node.
          if (curr.done) break;
        }
        n = curr.value as Node;

        for (;;) {
          parentNode = dom.parentNode(n);
          if (!this.addedSet.has(parentNode as Node)) break;
          // Climb to the top of the added tree: a child cannot be serialized
          // before its parent has a mirror id.
          n = parentNode as Node;
        }

        if (missingParents.has(parentNode as Node)) {
          parentNode = null;
        } else if (
          parentNode &&
          ((parentNode as Element).tagName === 'TEXTAREA' ||
            this.isBlockedAtEmission(parentNode))
        ) {
          // Two reasons a whole row is ineligible. TEXTAREA children never
          // enter the mirror, because genTextAreaValueMutation carries their
          // text instead. And a blocked node itself still needs a placeholder,
          // but its descendants must not be serialized from stale added or
          // moved entries queued before the node became blocked.
          parentNode = null;
        } else if (parentNode) {
          if (!inDom(parentNode)) {
            ancestorBad = true;
          } else {
            ancestorBad =
              isSelfOrAncestorInSet(this.droppedSet, parentNode) ||
              this.removesSubTreeCache.has(parentNode);

            if (ancestorBad && isSelfOrAncestorInSet(this.movedSet, n)) {
              // not bad, just moved
              ancestorBad = false;
            }
          }

          const last = dom.lastChild(parentNode);
          if (last && this.addedSet.has(last)) {
            // Jump to the end of the row instead of crawling it sibling by
            // sibling.
            n = last;
            nextSibling = null;
          } else {
            for (;;) {
              nextSibling = dom.nextSibling(n);
              if (!this.addedSet.has(nextSibling as Node)) break;
              // A node cannot be serialized before its next sibling has an id.
              n = nextSibling as Node;
            }
          }

          parentId = isShadowRoot(parentNode)
            ? this.mirror.getId(getShadowHost(n))
            : this.mirror.getId(parentNode);

          // If the node is the direct child of a shadow root, we treat the shadow host as its parent node.
          if (
            parentId === -1 &&
            parentNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
          ) {
            parentId = this.mirror.getId(dom.host(parentNode as ShadowRoot));
          }
        }
      }

      this.addedSet.delete(n); // don't re-iterate

      if (!parentNode || parentId === -1) {
        missingParents.add(n); // so added child nodes can also early-out
        continue;
      } else if (ancestorBad) {
        this.droppedSet.add(n);
        continue;
      }

      let nextId = nextSibling ? this.mirror.getId(nextSibling) : null;
      while (nextId === IGNORED_NODE) {
        // slimDOM: ignored
        nextSibling = nextSibling && dom.nextSibling(nextSibling);
        nextId = nextSibling && this.mirror.getId(nextSibling);
      }
      if (nextId === -1) {
        // The next sibling is not an added node, yet has no mirror id. Drop
        // this node rather than emit an add the replayer cannot place, and
        // restart the row so its previous siblings are not walked from here.
        n = null;
        continue;
      }
      serializationOptions ??= {
        doc: this.doc,
        mirror: this.mirror,
        blockClass: this.blockClass,
        blockSelector: this.blockSelector,
        maskTextClass: this.maskTextClass,
        maskTextSelector: this.maskTextSelector,
        skipChild: true,
        newlyAddedElement: true,
        inlineStylesheet: this.inlineStylesheet,
        maskInputOptions: this.maskInputOptions,
        maskTextFn: this.maskTextFn,
        maskInputFn: this.maskInputFn,
        maskAllElementAttributes: this.maskAllElementAttributes,
        maskAttributeFn: this.maskAttributeFn,
        slimDOMOptions: this.slimDOMOptions,
        dataURLOptions: this.dataURLOptions,
        recordCanvas: this.recordCanvas,
        canvasMaskingConfigured: this.canvasMaskingConfigured,
        inlineImages: this.inlineImages,
        onSerialize: (currentN) => {
          if (isSerializedIframe(currentN, this.mirror)) {
            this.iframeManager.addIframe(currentN as HTMLIFrameElement);
          }
          if (isSerializedStylesheet(currentN, this.mirror)) {
            this.stylesheetManager.trackLinkElement(
              currentN as HTMLLinkElement,
            );
          }
          if (
            hasShadowRoot(currentN) &&
            !isBlocked(
              currentN,
              this.blockClass,
              this.blockSelector,
              true,
            )
          ) {
            this.shadowDomManager.addShadowRoot(
              dom.shadowRoot(currentN)!,
              this.doc,
            );
          }
        },
        onIframeLoad: (iframe, childSn) => {
          this.iframeManager.attachIframe(iframe, childSn);
          this.shadowDomManager.observeAttachShadow(iframe);
        },
        onIframeListenerRegistered: (
          iframe: HTMLIFrameElement,
          disposer: () => void,
        ) => {
          this.iframeManager.registerLoadListenerDisposer(iframe, disposer);
        },
        onStylesheetLoad: (link, childSn) => {
          this.stylesheetManager.attachLinkElement(link, childSn);
        },
      };
      const sn = serializeNodeWithId(n, serializationOptions);
      if (sn) {
        adds.push({
          parentId,
          nextId,
          node: sn,
        });
        addedIds.add(sn.id);
      }
    }

    const payload = {
      texts: this.texts
        .filter((text) => !this.isBlockedAtEmission(text.node))
        .map((text) => {
          const n = text.node;
          const parent = dom.parentNode(n);
          if (parent && (parent as Element).tagName === 'TEXTAREA') {
            // the node is being ignored as it isn't in the mirror, so shift mutation to attributes on parent textarea
            this.genTextAreaValueMutation(parent as HTMLTextAreaElement);
          }
          return {
            id: this.mirror.getId(n),
            value: text.value,
          };
        })
        // no need to include them on added elements, as they have just been serialized with up to date attribubtes
        .filter((text) => !addedIds.has(text.id))
        // text mutation's id was not in the mirror map means the target node has been removed
        .filter((text) => this.mirror.has(text.id)),
      attributes: this.attributes
        .filter((attribute) => !this.isBlockedAtEmission(attribute.node))
        .map((attribute) => {
          const { attributes } = attribute;
          if (
            !this.maskAllElementAttributes &&
            !this.maskAttributeFn &&
            typeof attributes.style === 'string'
          ) {
            const diffAsStr = JSON.stringify(attribute.styleDiff);
            const unchangedAsStr = JSON.stringify(attribute._unchangedStyles);
            // check if the style diff is actually shorter than the regular string based mutation
            // (which was the whole point of #464 'compact style mutation').
            if (diffAsStr.length < attributes.style.length) {
              // also: CSSOM fails badly when var() is present on shorthand properties, so only proceed with
              // the compact style mutation if these have all been accounted for
              if (
                (diffAsStr + unchangedAsStr).split('var(').length ===
                attributes.style.split('var(').length
              ) {
                attributes.style = attribute.styleDiff;
              }
            }
          }
          // Mask after synthesis and style compaction decisions. Compact style
          // objects are disabled whenever string attribute masking is configured.
          if (this.maskAllElementAttributes || this.maskAttributeFn) {
            for (const [name, value] of Object.entries(attributes)) {
              if (typeof value === 'string' || value === null) {
                attributes[name] = maskAttributeValue({
                  element: attribute.node as Element,
                  name,
                  value,
                  maskAllElementAttributes: this.maskAllElementAttributes,
                  maskAttributeFn: this.maskAttributeFn,
                  isGenerated: this.generatedAttributes
                    .get(attribute.node)
                    ?.has(name),
                });
              }
            }
          }
          return {
            id: this.mirror.getId(attribute.node),
            attributes: attributes,
          };
        })
        // no need to include them on added elements, as they have just been serialized with up to date attribubtes
        .filter((attribute) => !addedIds.has(attribute.id))
        // attribute mutation's id was not in the mirror map means the target node has been removed
        .filter((attribute) => this.mirror.has(attribute.id)),
      removes: this.removes,
      adds,
    };

    // Reset before the empty-payload return: these collections strongly
    // reference DOM nodes, and payload holds its own references.
    this.texts = [];
    this.attributes = [];
    this.attributeMap = new WeakMap<Node, attributeCursor>();
    this.generatedAttributes = new WeakMap<Node, Set<string>>();
    this.removes = [];
    this.addedSet = new Set<Node>();
    this.movedSet = new Set<Node>();
    this.droppedSet = new Set<Node>();
    this.removesSubTreeCache = new Set<Node>();
    this.movedMap = {};

    // payload may be empty if the mutations happened in some blocked elements
    if (
      !payload.texts.length &&
      !payload.attributes.length &&
      !payload.removes.length &&
      !payload.adds.length
    ) {
      return;
    }

    this.mutationCb(payload);
  };

  public bufferBelongsToIframe = (iframeEl: HTMLIFrameElement): boolean => {
    return this.doc === iframeEl.contentDocument;
  };

  private genTextAreaValueMutation = (textarea: HTMLTextAreaElement) => {
    let item = this.attributeMap.get(textarea);
    if (!item) {
      item = {
        node: textarea,
        attributes: {},
        styleDiff: {},
        _unchangedStyles: {},
      };
      this.attributes.push(item);
      this.attributeMap.set(textarea, item);
    }
    const value = Array.from(
      dom.childNodes(textarea),
      (cn) => dom.textContent(cn) || '',
    ).join('');
    item.attributes.value = maskInputValue({
      element: textarea,
      maskInputOptions: this.maskInputOptions,
      tagName: textarea.tagName,
      type: getInputType(textarea),
      value,
      maskInputFn: this.maskInputFn,
    });
  };

  private processMutation = (m: mutationRecord) => {
    if (isIgnored(m.target, this.mirror, this.slimDOMOptions)) {
      return;
    }
    switch (m.type) {
      case 'characterData': {
        const value = dom.textContent(m.target);

        if (
          !isBlocked(m.target, this.blockClass, this.blockSelector, false) &&
          value !== m.oldValue
        ) {
          this.texts.push({
            value:
              needMaskingText(
                m.target,
                this.maskTextClass,
                this.maskTextSelector,
                true, // checkAncestors
              ) && value
                ? this.maskTextFn
                  ? this.maskTextFn(value, closestElementOfNode(m.target))
                  : value.replace(/[\S]/g, '*')
                : value,
            node: m.target,
          });
        }
        break;
      }
      case 'attributes': {
        const target = m.target as Element;
        const tagNameLower = toLowerCase(target.tagName);
        const sourceAttributeName = m.attributeName as string;
        const attributeNamespace = m.attributeNamespace ?? null;
        let attributeName = getSerializedAttributeName(
          target,
          sourceAttributeName,
          attributeNamespace,
        );
        let value = attributeNamespace
          ? target.getAttributeNS(attributeNamespace, sourceAttributeName)
          : (m.target as Element).getAttribute(sourceAttributeName);

        if (attributeName === 'value') {
          const htmlTarget = target as HTMLElement;
          const type = getInputType(htmlTarget);

          value = maskInputValue({
            element: htmlTarget,
            maskInputOptions: this.maskInputOptions,
            tagName: target.tagName,
            type,
            value,
            maskInputFn: this.maskInputFn,
          });
        }
        if (
          isBlocked(m.target, this.blockClass, this.blockSelector, false) ||
          value === m.oldValue
        ) {
          return;
        }

        let item = this.attributeMap.get(m.target);
        const isIframeSrc =
          tagNameLower === 'iframe' && attributeName === 'src';
        if (
          isIframeSrc &&
          !this.keepIframeSrcFn(value as string) &&
          (target as HTMLIFrameElement).contentDocument
        ) {
          return;
        }

        // Keep this property on inputs that used to be password inputs
        // This is used to ensure we do not unmask value when using e.g. a "Show password" type button
        if (
          attributeName === 'type' &&
          tagNameLower === 'input' &&
          (m.oldValue || '').toLowerCase() === 'password'
        ) {
          target.setAttribute('data-rr-is-password', 'true');
        }

        if (!ignoreAttribute(tagNameLower, attributeName, value)) {
          if (!item) {
            item = {
              node: m.target,
              attributes: {},
              styleDiff: {},
              _unchangedStyles: {},
            };
            this.attributes.push(item);
            this.attributeMap.set(m.target, item);
          }
          // Transform with the source name before representing an inaccessible
          // iframe's source under the final rr_src key.
          const transformedValue = transformAttribute(
            this.doc,
            tagNameLower,
            toLowerCase(attributeName),
            value,
            target,
            this.dataURLOptions,
          );
          if (isIframeSrc && !this.keepIframeSrcFn(value as string)) {
            attributeName = 'rr_src';
          }
          // overwrite attribute if the mutation was triggered in same time
          item.attributes[attributeName] = transformedValue;
          this.generatedAttributes.get(m.target)?.delete(attributeName);
          if (attributeName === 'style') {
            if (!this.unattachedDoc) {
              try {
                // avoid upsetting original document from a Content Security point of view
                this.unattachedDoc =
                  document.implementation.createHTMLDocument();
              } catch (e) {
                // fallback to more direct method
                this.unattachedDoc = this.doc;
              }
            }
            const old = this.unattachedDoc.createElement('span');
            const targetStyle = (target as HTMLElement | SVGElement).style;
            if (m.oldValue) {
              old.style.cssText = m.oldValue;
            }
            for (const pname of Array.from(targetStyle)) {
              const newValue = targetStyle.getPropertyValue(pname);
              const newPriority = targetStyle.getPropertyPriority(pname);
              if (
                newValue !== old.style.getPropertyValue(pname) ||
                newPriority !== old.style.getPropertyPriority(pname)
              ) {
                if (newPriority === '') {
                  item.styleDiff[pname] = newValue;
                } else {
                  item.styleDiff[pname] = [newValue, newPriority];
                }
              } else {
                // for checking
                item._unchangedStyles[pname] = [newValue, newPriority];
              }
            }
            for (const pname of Array.from(old.style)) {
              if (targetStyle.getPropertyValue(pname) === '') {
                // "if not set, returns the empty string"
                item.styleDiff[pname] = false; // delete
              }
            }
          } else if (attributeName === 'open' && tagNameLower === 'dialog') {
            if (target.matches('dialog:modal')) {
              item.attributes['rr_open_mode'] = 'modal';
            } else {
              item.attributes['rr_open_mode'] = 'non-modal';
            }
            let generated = this.generatedAttributes.get(m.target);
            if (!generated) {
              generated = new Set();
              this.generatedAttributes.set(m.target, generated);
            }
            generated.add('rr_open_mode');
          }
        }
        break;
      }
      case 'childList': {
        /**
         * Parent is blocked, ignore all child mutations
         */
        if (isBlocked(m.target, this.blockClass, this.blockSelector, true))
          return;

        if ((m.target as Element).tagName === 'TEXTAREA') {
          // children would be ignored in genAdds as they aren't in the mirror
          this.genTextAreaValueMutation(m.target as HTMLTextAreaElement);
          return; // any removedNodes won't have been in mirror either
        }

        m.addedNodes.forEach((n) => this.genAdds(n, m.target));
        m.removedNodes.forEach((n) => {
          const nodeId = this.mirror.getId(n);
          const parentId = isShadowRoot(m.target)
            ? this.mirror.getId(dom.host(m.target))
            : this.mirror.getId(m.target);
          if (
            isBlocked(m.target, this.blockClass, this.blockSelector, false) ||
            isIgnored(n, this.mirror, this.slimDOMOptions) ||
            !isSerialized(n, this.mirror)
          ) {
            return;
          }
          // removed node has not been serialized yet, just remove it from the Set
          if (this.addedSet.has(n)) {
            deepDelete(this.addedSet, n);
            this.droppedSet.add(n);
          } else if (this.addedSet.has(m.target) && nodeId === -1) {
            /**
             * If target was newly added and removed child node was
             * not serialized, it means the child node has been removed
             * before callback fired, so we can ignore it because
             * newly added node will be serialized without child nodes.
             * TODO: verify this
             */
          } else if (isAncestorRemoved(m.target, this.mirror)) {
            /**
             * If parent id was not in the mirror map any more, it
             * means the parent node has already been removed. So
             * the node is also removed which we do not need to track
             * and replay.
             */
          } else if (
            this.movedSet.has(n) &&
            this.movedMap[moveKey(nodeId, parentId)]
          ) {
            deepDelete(this.movedSet, n);
          } else {
            this.removes.push({
              parentId,
              id: nodeId,
              isShadow:
                isShadowRoot(m.target) && isNativeShadowDom(m.target)
                  ? true
                  : undefined,
            });
            processRemoves(n, this.removesSubTreeCache);
          }
          this.mapRemoves.add(n);
        });
        break;
      }
      default:
        break;
    }
  };

  /**
   * Make sure you check if `n`'s parent is blocked before calling this function
   * */
  private genAdds = (n: Node, target?: Node) => {
    // this node was already recorded in other buffer, ignore it
    if (this.processedNodeManager.inOtherBuffer(n, this)) return;

    // if n is added to set, there is no need to travel it and its' children again
    if (this.addedSet.has(n)) return;
    if (this.movedSet.has(n)) return;

    if (this.mirror.hasNode(n)) {
      if (isIgnored(n, this.mirror, this.slimDOMOptions)) {
        return;
      }
      this.movedSet.add(n);
      let targetId: number | null = null;
      if (target && this.mirror.hasNode(target)) {
        targetId = this.mirror.getId(target);
      }
      if (targetId && targetId !== -1) {
        this.movedMap[moveKey(this.mirror.getId(n), targetId)] = true;
      }
    } else {
      this.addedSet.add(n);
      this.droppedSet.delete(n);
    }

    // if this node is blocked `serializeNode` will turn it into a placeholder element
    // but we have to remove it's children otherwise they will be added as placeholders too
    if (!isBlocked(n, this.blockClass, this.blockSelector, false)) {
      // Text nodes cannot have children or a shadow root. Keep the blocking
      // check above: skipping it can change stateful RegExp behavior.
      if (n.nodeType === n.TEXT_NODE) return;
      // Avoid a callback per node on repeated subtree walks. Like forEach,
      // capture the initial length but read each child from the live list.
      const children = dom.childNodes(n);
      for (let i = 0, length = children.length; i < length; i++) {
        const childN = children[i];
        if (childN) this.genAdds(childN);
      }
      if (hasShadowRoot(n)) {
        const shadowChildren = dom.childNodes(dom.shadowRoot(n)!);
        for (let i = 0, length = shadowChildren.length; i < length; i++) {
          const childN = shadowChildren[i];
          if (!childN) continue;
          this.processedNodeManager.add(childN, this);
          this.genAdds(childN, n);
        }
      }
    }
  };
}

/**
 * Some utils to handle the mutation observer DOM records.
 * It should be more clear to extend the native data structure
 * like Set and Map, but currently Typescript does not support
 * that.
 */
function deepDelete(addsSet: Set<Node>, n: Node) {
  const stack = [n];

  while (stack.length) {
    const next = stack.pop()!;
    addsSet.delete(next);
    if (next.nodeType === next.TEXT_NODE) continue;
    const children = dom.childNodes(next);
    for (let i = 0, length = children.length; i < length; i++) {
      const childN = children[i];
      if (childN) stack.push(childN);
    }
  }
}

function processRemoves(n: Node, cache: Set<Node>) {
  const queue = [n];

  while (queue.length) {
    const next = queue.pop()!;
    if (cache.has(next)) continue;
    cache.add(next);
    dom.childNodes(next).forEach((n) => queue.push(n));
  }

  return;
}

function isSelfOrAncestorInSet(set: Set<Node>, n: Node): boolean {
  if (set.size === 0) return false;

  let node: Node | null = n;
  while (node) {
    if (set.has(node)) return true;
    node = dom.parentNode(node);
  }
  return false;
}
